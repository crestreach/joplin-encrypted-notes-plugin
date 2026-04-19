# Encrypted Notes — Joplin Plugin

Encrypt and decrypt individual notes with a per-note password. Notes remain encrypted on disk at all times — they are only decrypted in memory when you unlock them.

## Features

- **AES-256-GCM Encryption** — Authenticated encryption via the WebCrypto API
- **PBKDF2 Key Derivation** — 200,000 iterations with SHA-512 for strong password-based key derivation
- **Always Encrypted on Disk** — Notes are never stored in plaintext; decryption happens only in memory
- **Lock Screen** — Encrypted notes display a password prompt in the note viewer
- **Two Editor Modes** — CodeMirror markdown editor (dialog) or Joplin's native editor (temporary note)
- **Password Reuse Within Session** — After unlocking, the Edit button skips the password prompt until you lock the note again
- **Auto Re-encrypt** — In native editor mode, navigating away automatically re-encrypts and permanently deletes the temporary note
- **Retry on Error** — Wrong password or mismatched confirmation keeps the dialog open so you can retry
- **Permanent Decrypt** — Option to permanently remove encryption from a note
- **Mobile Support** — Works on both desktop and mobile Joplin apps

## How It Works

1. **Encrypt a note**: Select a note → Tools → Encrypted Notes → Toggle Note Encryption (or click the toolbar lock icon). Enter and confirm a password. The note body is encrypted and stored in a code fence.

2. **View an encrypted note**: When you open an encrypted note, the viewer shows a lock screen. Enter your password to see the rendered markdown (read-only).

3. **Edit an encrypted note**: Click "Edit" in the unlocked viewer (no password needed again), or use Tools → Encrypted Notes → Edit Encrypted Note.
   - **CodeMirror mode** (default): Opens a dialog with a markdown editor and formatting toolbar. Click Save to re-encrypt.
   - **Native mode**: Creates a temporary note with the decrypted content and opens it in Joplin's built-in editor. Navigate away when done — the plugin automatically re-encrypts and permanently deletes the temp note.

4. **Lock a note**: Click "Lock" in the unlocked viewer to return to the password prompt. The in-memory password is cleared.

5. **Permanently decrypt**: Tools → Encrypted Notes → Decrypt Note (Permanent). Enter the password and the note is restored to plaintext.

## Installation

### From File

1. Build the plugin: `npm install && npm run dist`
2. In Joplin: Tools → Options → Plugins → Install from file
3. Select the `.jpl` file from the `publish/` directory

## Settings

| Setting | Options | Default |
|---------|---------|---------|
| AES Key Size | 128-bit, 256-bit | 256-bit |
| AES Cipher Mode | CBC, CTR, GCM | GCM |
| Editor Mode | CodeMirror, Native | CodeMirror |

> **Note**: Changing cipher settings only affects newly encrypted notes. Existing encrypted notes retain the settings from when they were encrypted.

## Encrypted Note Format

Encrypted notes are stored as a markdown code fence:

````
```encrypted-note
v1|AES-256-GCM
<base64 encoded: IV + salt + ciphertext + auth tag>
```
````

## Security

- **Encryption**: AES-GCM (128 or 256 bit), AES-CBC, or AES-CTR
- **Key Derivation**: PBKDF2 with 200,000 iterations and SHA-512
- **Random Salt**: 16 bytes per encryption operation
- **Random IV**: 12 bytes (GCM) or 16 bytes (CBC/CTR) per encryption
- **Authentication**: GCM provides built-in AEAD; CBC/CTR use HMAC-SHA-512
- **No Password Storage**: Passwords are never saved to disk — only held in memory while the note is unlocked
- **Native Mode Cleanup**: Temporary notes are wiped (body and title cleared) then permanently deleted (bypassing the trash)

## Platform Support

| Platform | Supported |
|----------|-----------|
| Desktop (Windows, macOS, Linux) | ✅ |
| Mobile (Android, iOS) | ✅ |

## Important

- **No password recovery** — If you forget your password, the note cannot be recovered
- **Back up important notes** before encrypting them
- **Only note body is encrypted** — the note title, tags, and attachments are not encrypted
- **Native editor mode** briefly stores decrypted text in Joplin's database as a temporary note during editing

## Build from Source

```bash
npm install
npm run dist
```

The built plugin archive will be in `publish/`.

## License

BSD 2-Clause
