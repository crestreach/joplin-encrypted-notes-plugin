/**
 * AES encryption/decryption via the WebCrypto API.
 *
 * Binary wire format (v1):
 *   [IV (12/16 bytes)] [salt (16 bytes)] [ciphertext] [auth tag (GCM:16 / HMAC:32)]
 *
 * Key derivation: PBKDF2 with SHA-512, 200 000 iterations.
 * Authentication: GCM provides built-in AEAD; CBC/CTR get an HMAC-SHA-512
 * tag appended over (IV ‖ salt ‖ ciphertext).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AesOptions {
	keySize: 128 | 256;
	mode: 'AES-GCM' | 'AES-CBC' | 'AES-CTR';
}

export const DEFAULT_OPTIONS: AesOptions = { keySize: 256, mode: 'AES-GCM' };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KDF_ROUNDS    = 200_000;
const KDF_HASH      = 'SHA-512';
const HMAC_HASH     = 'SHA-512';
const SALT_BYTES    = 16;
const GCM_IV_BYTES  = 12;
const CBC_IV_BYTES  = 16;
const GCM_AUTH_BYTES = 16;   // 128-bit GCM tag
const HMAC_BYTES     = 64;   // SHA-512 produces 64 bytes

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class WrongPasswordError extends Error {
	constructor(message = 'The supplied password is incorrect') {
		super(message);
		this.name = 'WrongPasswordError';
	}
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

export async function encryptData(
	plaintext: string,
	password: string,
	opts: AesOptions = DEFAULT_OPTIONS,
): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const ivLen = opts.mode === 'AES-GCM' ? GCM_IV_BYTES : CBC_IV_BYTES;
	const iv = crypto.getRandomValues(new Uint8Array(ivLen));

	const aesKey = await buildAesKey(password, salt, opts);
	const encoded = new TextEncoder().encode(plaintext);

	let cipher: Uint8Array;
	let authTag: Uint8Array;

	if (opts.mode === 'AES-GCM') {
		const raw = new Uint8Array(
			await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv), tagLength: 128 }, aesKey, ab(encoded)),
		);
		// WebCrypto appends the tag at the end of the output
		cipher  = raw.subarray(0, raw.length - GCM_AUTH_BYTES);
		authTag = raw.subarray(raw.length - GCM_AUTH_BYTES);
	} else {
		const params = opts.mode === 'AES-CTR'
			? { name: 'AES-CTR', counter: ab(iv), length: 64 }
			: { name: 'AES-CBC', iv: ab(iv) };
		cipher = new Uint8Array(await crypto.subtle.encrypt(params, aesKey, ab(encoded)));
		authTag = new Uint8Array(
			await crypto.subtle.sign('HMAC', await buildHmacKey(password, salt), ab(join(iv, salt, cipher))),
		);
	}

	// Wire format: IV | salt | ciphertext | tag
	return toBase64(join(iv, salt, cipher, authTag));
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

export async function decryptData(
	blob: string,
	password: string,
	opts: AesOptions = DEFAULT_OPTIONS,
): Promise<string> {
	const buf  = fromBase64(blob);
	const ivLen = opts.mode === 'AES-GCM' ? GCM_IV_BYTES : CBC_IV_BYTES;
	const tagLen = opts.mode === 'AES-GCM' ? GCM_AUTH_BYTES : HMAC_BYTES;

	if (buf.length < ivLen + SALT_BYTES + tagLen + 1) throw new WrongPasswordError();

	const iv      = buf.subarray(0, ivLen);
	const salt    = buf.subarray(ivLen, ivLen + SALT_BYTES);
	const cipher  = buf.subarray(ivLen + SALT_BYTES, buf.length - tagLen);
	const authTag = buf.subarray(buf.length - tagLen);

	const aesKey = await buildAesKey(password, salt, opts);

	if (opts.mode === 'AES-GCM') {
		// Re-attach the GCM tag so WebCrypto can verify + decrypt in one step
		const combined = join(cipher, authTag);
		try {
			const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(iv), tagLength: 128 }, aesKey, ab(combined));
			return new TextDecoder().decode(raw);
		} catch {
			throw new WrongPasswordError();
		}
	}

	// CBC / CTR: verify HMAC first
	const ok = await crypto.subtle.verify(
		'HMAC',
		await buildHmacKey(password, salt),
		ab(authTag),
		ab(join(iv, salt, cipher)),
	);
	if (!ok) throw new WrongPasswordError();

	const params = opts.mode === 'AES-CTR'
		? { name: 'AES-CTR', counter: ab(iv), length: 64 }
		: { name: 'AES-CBC', iv: ab(iv) };
	return new TextDecoder().decode(await crypto.subtle.decrypt(params, aesKey, ab(cipher)));
}

// ---------------------------------------------------------------------------
// Encrypted-note format helpers
// ---------------------------------------------------------------------------

const FENCE_OPEN  = '```encrypted-note';
const FENCE_CLOSE = '```';

export function isEncryptedNote(body: string): boolean {
	return !!body && body.trimStart().startsWith(FENCE_OPEN);
}

export interface ParsedEncryptedNote {
	version: number;
	options: AesOptions;
	data: string;
}

export function parseEncryptedNote(body: string): ParsedEncryptedNote | null {
	const t = body.trim();
	if (!t.startsWith(FENCE_OPEN)) return null;
	const closePos = t.lastIndexOf(FENCE_CLOSE);
	if (closePos <= FENCE_OPEN.length) return null;

	const lines = t
		.slice(FENCE_OPEN.length, closePos)
		.split('\n')
		.map(l => l.trim())
		.filter(Boolean);

	if (lines.length < 2) return null;

	const [ver, spec] = lines[0].split('|');
	const version = Number(ver.replace('v', ''));
	if (!Number.isFinite(version)) return null;

	// spec looks like "AES-256-GCM"
	const parts = spec.split('-');
	if (parts.length < 3) return null;

	const keySize = Number(parts[1]) as 128 | 256;
	const mode = `AES-${parts[2]}` as AesOptions['mode'];

	if (keySize !== 128 && keySize !== 256) return null;
	if (!['AES-GCM', 'AES-CBC', 'AES-CTR'].includes(mode)) return null;

	return { version, options: { keySize, mode }, data: lines.slice(1).join('') };
}

export function formatEncryptedNote(data: string, opts: AesOptions = DEFAULT_OPTIONS): string {
	const label = `v1|AES-${opts.keySize}-${opts.mode.replace('AES-', '')}`;
	return `${FENCE_OPEN}\n${label}\n${data}\n${FENCE_CLOSE}`;
}

// ---------------------------------------------------------------------------
// Key derivation (PBKDF2 → CryptoKey directly via deriveKey)
// ---------------------------------------------------------------------------

async function importPasswordKey(password: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey', 'deriveBits'],
	);
}

async function buildAesKey(password: string, salt: Uint8Array, opts: AesOptions): Promise<CryptoKey> {
	const base = await importPasswordKey(password);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: ab(salt), iterations: KDF_ROUNDS, hash: KDF_HASH },
		base,
		{ name: opts.mode, length: opts.keySize },
		false,
		['encrypt', 'decrypt'],
	);
}

async function buildHmacKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const base = await importPasswordKey(password);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: ab(salt), iterations: KDF_ROUNDS, hash: KDF_HASH },
		base,
		{ name: 'HMAC', hash: HMAC_HASH, length: 512 },
		false,
		['sign', 'verify'],
	);
}

// ---------------------------------------------------------------------------
// Buffer helpers
// ---------------------------------------------------------------------------

/** Safely extract an ArrayBuffer from a Uint8Array, handling subarray views. */
function ab(u: Uint8Array): ArrayBuffer {
	if (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength) {
		return u.buffer as ArrayBuffer;
	}
	// subarray() shares the underlying buffer — must copy the relevant slice
	return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function join(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let pos = 0;
	for (const p of parts) { out.set(p, pos); pos += p.length; }
	return out;
}

function toBase64(bytes: Uint8Array): string {
	// Works in both Node-like and browser contexts
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

function fromBase64(str: string): Uint8Array {
	const bin = atob(str);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
