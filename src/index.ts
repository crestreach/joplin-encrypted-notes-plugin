import joplin from 'api';
import {
	SettingItemType,
	ToolbarButtonLocation,
	MenuItemLocation,
	ContentScriptType,
} from 'api/types';
import {
	AesOptions,
	DEFAULT_OPTIONS,
	WrongPasswordError,
	encryptData,
	decryptData,
	isEncryptedNote,
	parseEncryptedNote,
	formatEncryptedNote,
} from './encryption';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGIN_ID = 'EncryptedNotes';

const SETTINGS_SECTION = `${PLUGIN_ID}.settings`;
const SETTINGS = {
	KEY_SIZE: `${SETTINGS_SECTION}.keySize`,
	AES_MODE: `${SETTINGS_SECTION}.aesMode`,
	EDITOR_MODE: `${SETTINGS_SECTION}.editorMode`,
};

const COMMANDS = {
	ENCRYPT: `${PLUGIN_ID}.encrypt`,
	DECRYPT: `${PLUGIN_ID}.decrypt`,
	EDIT: `${PLUGIN_ID}.edit`,
	FINISH_EDIT: `${PLUGIN_ID}.finishEdit`,
	TOGGLE_LOCK: `${PLUGIN_ID}.toggleLock`,
};

const CONTENT_SCRIPT_ID = 'encryptedNotesLockScreen';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let aesOptions: AesOptions = { ...DEFAULT_OPTIONS };
let editorMode: 'codemirror' | 'native' = 'codemirror';
let editorDialogHandle: string | null = null;
let cmEditorDialogHandle: string | null = null;
let passwordDialogHandle: string | null = null;
let messageDialogHandle: string | null = null;

// Tracks temp-note → original-note mapping (native editor mode)
const tempNoteMap = new Map<string, { originalNoteId: string; password: string }>();

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

joplin.plugins.register({
	onStart: async () => {
		// --- Settings ---
		await joplin.settings.registerSection(SETTINGS_SECTION, {
			label: 'Encrypted Notes',
			iconName: 'fas fa-shield-alt',
		});

		await joplin.settings.registerSettings({
			[SETTINGS.KEY_SIZE]: {
				value: 256,
				type: SettingItemType.Int,
				section: SETTINGS_SECTION,
				public: true,
				label: 'AES Key Size',
				isEnum: true,
				options: {
					128: '128-bit',
					256: '256-bit (Recommended)',
				},
			},
			[SETTINGS.AES_MODE]: {
				value: 'AES-GCM',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'AES Cipher Mode',
				isEnum: true,
				options: {
					'AES-CBC': 'CBC',
					'AES-CTR': 'CTR',
					'AES-GCM': 'GCM (Recommended)',
				},
			},
			[SETTINGS.EDITOR_MODE]: {
				value: 'codemirror',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Editor Mode',
				description: 'CodeMirror: rich markdown editor in a dialog. Native: decrypts into a temporary note so you can use Joplin\'s built-in editor (plaintext is briefly stored in Joplin\'s DB during editing).',
				isEnum: true,
				options: {
					'codemirror': 'CodeMirror (Recommended)',
					'native': 'Native Editor (Temporary Note)',
				},
			},
		});

		await updateSettings();
		await joplin.settings.onChange(updateSettings);

		// --- Content script (lock screen in viewer) ---
		await joplin.contentScripts.register(
			ContentScriptType.MarkdownItPlugin,
			CONTENT_SCRIPT_ID,
			'./contentScripts/lockScreen.js',
		);

		// Handle messages from the lock screen content script
		await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, async (message: any) => {
			if (message.type === 'unlock') {
				return handleUnlock(message.password);
			}
			if (message.type === 'requestEdit') {
				try {
					const saved = await editEncryptedNote(message.password || undefined);
					return { type: saved ? 'saved' : 'cancelled' };
				} catch (e) {
					console.error('[EncryptedNotes] editEncryptedNote failed:', e);
					return { type: 'error' };
				}
			}
			return null;
		});

		// --- Editor dialogs (created once, reused) ---
		// Simple textarea editor (fallback)
		editorDialogHandle = await joplin.views.dialogs.create(`${PLUGIN_ID}.editorDialog`);
		await joplin.views.dialogs.addScript(editorDialogHandle, 'webview/editorDialog.css');
		await joplin.views.dialogs.addScript(editorDialogHandle, 'webview/editorDialog.js');
		await joplin.views.dialogs.setFitToContent(editorDialogHandle, false);

		// CodeMirror editor dialog
		cmEditorDialogHandle = await joplin.views.dialogs.create(`${PLUGIN_ID}.cmEditorDialog`);
		await joplin.views.dialogs.addScript(cmEditorDialogHandle, 'webview/cmEditorDialog.css');
		await joplin.views.dialogs.addScript(cmEditorDialogHandle, 'webview/cmEditor.bundle.js');
		await joplin.views.dialogs.setFitToContent(cmEditorDialogHandle, false);

		// --- Commands ---
		await joplin.commands.register({
			name: COMMANDS.ENCRYPT,
			label: 'Encrypt Note',
			enabledCondition: 'oneNoteSelected',
			iconName: 'fas fa-lock',
			execute: async () => { try { await encryptCurrentNote(); } catch (e) { console.error('[EncryptedNotes] encrypt failed:', e); } },
		});

		await joplin.commands.register({
			name: COMMANDS.DECRYPT,
			label: 'Decrypt Note (Permanent)',
			enabledCondition: 'oneNoteSelected',
			iconName: 'fas fa-unlock',
			execute: async () => { try { await decryptCurrentNote(); } catch (e) { console.error('[EncryptedNotes] decrypt failed:', e); } },
		});

		await joplin.commands.register({
			name: COMMANDS.EDIT,
			label: 'Edit Encrypted Note',
			enabledCondition: 'oneNoteSelected',
			iconName: 'fas fa-edit',
			execute: async () => { try { await editEncryptedNote(); } catch (e) { console.error('[EncryptedNotes] edit failed:', e); } },
		});

		await joplin.commands.register({
			name: COMMANDS.FINISH_EDIT,
			label: 'Finish Editing & Re-encrypt',
			enabledCondition: 'oneNoteSelected',
			iconName: 'fas fa-check-circle',
			execute: async () => { try { await finishTempNoteEdit(); } catch (e) { console.error('[EncryptedNotes] finishEdit failed:', e); } },
		});

		await joplin.commands.register({
			name: COMMANDS.TOGGLE_LOCK,
			label: 'Toggle Note Encryption',
			enabledCondition: 'oneNoteSelected',
			iconName: 'fas fa-user-lock',
			execute: async () => { try { await toggleLock(); } catch (e) { console.error('[EncryptedNotes] toggleLock failed:', e); } },
		});

		// --- Toolbar & Menu ---
		await joplin.views.toolbarButtons.create(
			`${PLUGIN_ID}.toolbar`,
			COMMANDS.TOGGLE_LOCK,
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.menus.create(
			`${PLUGIN_ID}.menu`,
			'Encrypted Notes',
			[
				{ commandName: COMMANDS.TOGGLE_LOCK },
				{ commandName: COMMANDS.EDIT },
				{ commandName: COMMANDS.FINISH_EDIT },
				{ type: 'separator' as any },
				{ commandName: COMMANDS.ENCRYPT },
				{ commandName: COMMANDS.DECRYPT },
			],
			MenuItemLocation.Tools,
		);

		// --- Dialogs (created once, reused) ---
		passwordDialogHandle = await joplin.views.dialogs.create(`${PLUGIN_ID}.passwordDialog`);
		messageDialogHandle = await joplin.views.dialogs.create(`${PLUGIN_ID}.messageDialog`);

		// --- Auto re-encrypt when user navigates away from a temp note ---
		await joplin.workspace.onNoteSelectionChange(async () => {
			await autoFinishTempNotes();
		});
	},
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function updateSettings() {
	const values = await joplin.settings.values([SETTINGS.KEY_SIZE, SETTINGS.AES_MODE, SETTINGS.EDITOR_MODE]);
	aesOptions = {
		keySize: values[SETTINGS.KEY_SIZE] as AesOptions['keySize'],
		mode: values[SETTINGS.AES_MODE] as AesOptions['mode'],
	};
	editorMode = (values[SETTINGS.EDITOR_MODE] as string) === 'native' ? 'native' : 'codemirror';
}

// ---------------------------------------------------------------------------
// Toggle lock
// ---------------------------------------------------------------------------

async function toggleLock() {
	const note = await getSelectedNote();
	if (!note) return;

	if (isEncryptedNote(note.body)) {
		// Already encrypted -> decrypt permanently
		await decryptCurrentNote();
	} else {
		// Not encrypted -> encrypt
		await encryptCurrentNote();
	}
}

// ---------------------------------------------------------------------------
// Encrypt note
// ---------------------------------------------------------------------------

async function encryptCurrentNote() {
	const note = await getSelectedNote();
	if (!note) return;

	if (isEncryptedNote(note.body)) {
		await showToast('Note is already encrypted');
		return;
	}

	let errorMsg = '';
	while (true) {
		const password = await showPasswordDialog('Enter password to encrypt this note', true, errorMsg);
		if (!password) return; // user cancelled

		if (password === '__mismatch__') {
			errorMsg = 'Passwords do not match. Please try again.';
			continue;
		}

		const encrypted = await encryptData(note.body || '', password, aesOptions);
		const encryptedBody = formatEncryptedNote(encrypted, aesOptions);
		await joplin.data.put(['notes', note.id], null, { body: encryptedBody });
		await showToast('Note encrypted successfully');
		return;
	}
}

// ---------------------------------------------------------------------------
// Decrypt note (permanent)
// ---------------------------------------------------------------------------

async function decryptCurrentNote() {
	const note = await getSelectedNote();
	if (!note) return;

	if (!isEncryptedNote(note.body)) {
		await showToast('Note is not encrypted');
		return;
	}

	const parsed = parseEncryptedNote(note.body);
	if (!parsed) {
		await showToast('Invalid encrypted note format');
		return;
	}

	let errorMsg = '';
	while (true) {
		const password = await showPasswordDialog('Enter password to permanently decrypt this note', false, errorMsg);
		if (!password) return; // user cancelled

		try {
			const decrypted = await decryptData(parsed.data, password, parsed.options);
			await joplin.data.put(['notes', note.id], null, { body: decrypted });
			await showToast('Note decrypted successfully');
			return;
		} catch (err) {
			if (err instanceof WrongPasswordError) {
				errorMsg = 'Incorrect password. Please try again.';
				continue;
			}
			await showToast('Decryption failed');
			return;
		}
	}
}

// ---------------------------------------------------------------------------
// Lock screen content script handlers
// ---------------------------------------------------------------------------

async function handleUnlock(password: string) {
	const note = await getSelectedNote();
	if (!note) return { type: 'error', msg: 'No note selected' };

	const parsed = parseEncryptedNote(note.body);
	if (!parsed) return { type: 'error', msg: 'Invalid encrypted note format' };

	try {
		const decrypted = await decryptData(parsed.data, password, parsed.options);
		return { type: 'success', markdown: decrypted };
	} catch (err) {
		if (err instanceof WrongPasswordError) {
			return { type: 'error', msg: 'Incorrect password, try again' };
		}
		return { type: 'error', msg: 'Decryption failed' };
	}
}

// ---------------------------------------------------------------------------
// Edit encrypted note (dialog-based, works on mobile)
// ---------------------------------------------------------------------------

async function editEncryptedNote(suppliedPassword?: string): Promise<boolean> {
	const note = await getSelectedNote();
	if (!note) return false;

	if (!isEncryptedNote(note.body)) {
		await showToast('Note is not encrypted. Use Encrypt Note first.');
		return false;
	}

	const parsed = parseEncryptedNote(note.body);
	if (!parsed) {
		await showToast('Invalid encrypted note format');
		return false;
	}

	let password = suppliedPassword;
	if (!password) {
		password = await showPasswordDialog('Enter password to edit this note', false);
		if (!password) return false;
	}

	let decrypted: string;
	try {
		decrypted = await decryptData(parsed.data, password, parsed.options);
	} catch (err) {
		if (err instanceof WrongPasswordError) {
			await showToast('Incorrect password');
		} else {
			await showToast('Decryption failed');
		}
		return false;
	}

	if (editorMode === 'native') {
		await editViaTempNote(note, decrypted, password);
		return true;
	} else {
		return await editViaCodeMirrorDialog(note, decrypted, password);
	}
}

// ---------------------------------------------------------------------------
// Editor mode: CodeMirror dialog
// ---------------------------------------------------------------------------

async function editViaCodeMirrorDialog(
	note: any,
	decrypted: string,
	password: string,
): Promise<boolean> {
	if (!cmEditorDialogHandle) return false;

	const toolbarHtml = `<div class="cm-toolbar">
		<button class="tb-btn" data-action="bold" title="Bold"><b>B</b></button>
		<button class="tb-btn" data-action="italic" title="Italic"><i>I</i></button>
		<button class="tb-btn" data-action="strikethrough" title="Strikethrough"><s>S</s></button>
		<span class="sep"></span>
		<button class="tb-btn" data-action="heading" title="Heading"><svg viewBox="0 0 24 24"><path d="M4 4v16"/><path d="M20 4v16"/><path d="M4 12h16"/></svg></button>
		<button class="tb-btn" data-action="ul" title="Bullet list"><svg viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg></button>
		<button class="tb-btn" data-action="ol" title="Numbered list"><svg viewBox="0 0 24 24"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="2" y="8" font-size="7" fill="currentColor" stroke="none" font-weight="600">1</text><text x="2" y="14" font-size="7" fill="currentColor" stroke="none" font-weight="600">2</text><text x="2" y="20" font-size="7" fill="currentColor" stroke="none" font-weight="600">3</text></svg></button>
		<button class="tb-btn" data-action="checkbox" title="Checkbox"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg></button>
		<span class="sep"></span>
		<button class="tb-btn" data-action="code" title="Inline code"><svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></button>
		<button class="tb-btn" data-action="codeblock" title="Code block"><svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="3"/><polyline points="14 15 18 12 14 9" style="stroke-width:1.5"/><polyline points="10 9 6 12 10 15" style="stroke-width:1.5"/></svg></button>
		<button class="tb-btn" data-action="quote" title="Quote"><svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg></button>
		<span class="sep"></span>
		<button class="tb-btn" data-action="link" title="Link"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
		<button class="tb-btn" data-action="hr" title="Horizontal rule"><svg viewBox="0 0 24 24"><line x1="2" y1="12" x2="22" y2="12"/></svg></button>
	</div>`;

	// Inline script — runs fresh every time setHtml is called
	const runtimeScript = `<script>
(function() {
	var cmView = null;
	var container = document.getElementById('cm-container');
	var hiddenField = document.getElementById('cm-hidden-content');
	if (!container || !hiddenField) return;
	var initial = hiddenField.value || '';

	function tryInit() {
		if (typeof window.initCodeMirror === 'function') {
			cmView = window.initCodeMirror(container, initial, function(content) {
				hiddenField.value = content;
			});
		} else {
			setTimeout(tryInit, 50);
		}
	}
	tryInit();

	function getSelection() {
		var s = cmView.state, sel = s.selection.main;
		return { from: sel.from, to: sel.to, text: s.doc.sliceString(sel.from, sel.to) };
	}
	function wrapSel(before, after, ph) {
		var sel = getSelection(), text = sel.text || ph;
		cmView.dispatch({
			changes: { from: sel.from, to: sel.to, insert: before + text + after },
			selection: { anchor: sel.from + before.length, head: sel.from + before.length + text.length }
		});
	}
	function prependLine(prefix) {
		var s = cmView.state, sel = s.selection.main, line = s.doc.lineAt(sel.from);
		cmView.dispatch({
			changes: { from: line.from, to: line.from, insert: prefix },
			selection: { anchor: sel.from + prefix.length }
		});
	}
	function insertAt(text) {
		var sel = getSelection();
		cmView.dispatch({
			changes: { from: sel.from, to: sel.to, insert: text },
			selection: { anchor: sel.from + text.length }
		});
	}
	document.addEventListener('click', function(e) {
		var btn = e.target.closest('.tb-btn');
		if (!btn || !cmView) return;
		e.preventDefault();
		var a = btn.getAttribute('data-action');
		cmView.focus();
		if (a === 'bold') wrapSel('**','**','bold');
		else if (a === 'italic') wrapSel('*','*','italic');
		else if (a === 'strikethrough') wrapSel('~~','~~','text');
		else if (a === 'code') wrapSel('\\x60','\\x60','code');
		else if (a === 'codeblock') wrapSel('\\n\\x60\\x60\\x60\\n','\\n\\x60\\x60\\x60\\n','code');
		else if (a === 'heading') prependLine('# ');
		else if (a === 'ul') prependLine('- ');
		else if (a === 'ol') prependLine('1. ');
		else if (a === 'checkbox') prependLine('- [ ] ');
		else if (a === 'quote') prependLine('> ');
		else if (a === 'hr') insertAt('\\n---\\n');
		else if (a === 'link') {
			var sel = getSelection(), text = sel.text || 'text';
			var rep = '[' + text + '](url)';
			var us = sel.from + 1 + text.length + 2;
			cmView.dispatch({
				changes: { from: sel.from, to: sel.to, insert: rep },
				selection: { anchor: us, head: us + 3 }
			});
		}
	});
})();
<\/script>`;

	const editorHtml = `<div id="cm-editor-root">
		${toolbarHtml}
		<div id="cm-container"></div>
		<form name="editorForm">
			<textarea id="cm-hidden-content" name="content">${escapeHtml(decrypted)}</textarea>
		</form>
	</div>
	${runtimeScript}`;

	await joplin.views.dialogs.setHtml(cmEditorDialogHandle, editorHtml);
	await joplin.views.dialogs.setButtons(cmEditorDialogHandle, [
		{ id: 'ok', title: 'Save' },
		{ id: 'cancel', title: 'Cancel' },
	]);

	const result = await joplin.views.dialogs.open(cmEditorDialogHandle);
	if (result.id !== 'ok') return false;

	const newContent = result.formData?.editorForm?.content;
	if (newContent == null) return false;

	try {
		const encrypted = await encryptData(newContent, password, aesOptions);
		const encryptedBody = formatEncryptedNote(encrypted, aesOptions);
		await joplin.data.put(['notes', note.id], null, { body: encryptedBody });
		return true;
	} catch {
		await showToast('Encryption failed. Please try again.');
		return false;
	}
}

// ---------------------------------------------------------------------------
// Editor mode: Native (temporary note)
// ---------------------------------------------------------------------------

const TEMP_NOTE_PREFIX = '[EDITING ENCRYPTED] ';

async function editViaTempNote(
	note: any,
	decrypted: string,
	password: string,
) {
	// Create a temporary note with the decrypted content
	const tempNote = await joplin.data.post(['notes'], null, {
		title: TEMP_NOTE_PREFIX + (note.title || 'Untitled'),
		body: decrypted,
	});

	if (!tempNote || !tempNote.id) {
		await showToast('Failed to create temporary note');
		return;
	}

	// Store mapping in memory (password never written to disk)
	tempNoteMap.set(tempNote.id, {
		originalNoteId: note.id,
		password: password,
	});

	// Navigate to the temp note
	await joplin.commands.execute('openNote', tempNote.id);

	await showToast(
		'Editing decrypted copy. Navigate away when done — it will be re-encrypted automatically.',
	);
}

/**
 * Called on every note selection change. Checks if any temp notes in our map
 * are no longer selected, and if so, re-encrypts + deletes them.
 */
async function autoFinishTempNotes() {
	if (tempNoteMap.size === 0) return;

	const selectedIds = await joplin.workspace.selectedNoteIds();
	const selectedSet = new Set(selectedIds || []);

	for (const [tempId, meta] of tempNoteMap.entries()) {
		if (selectedSet.has(tempId)) continue; // still viewing it

		// User navigated away — finish editing
		try {
			await finishTempNoteById(tempId, meta);
		} catch (e) {
			console.error('[EncryptedNotes] autoFinishTempNotes failed for', tempId, e);
		}
	}
}

async function finishTempNoteById(
	tempNoteId: string,
	meta: { originalNoteId: string; password: string },
) {
	const { originalNoteId, password } = meta;

	// Read the latest body of the temp note
	let tempNote: any;
	try {
		tempNote = await joplin.data.get(['notes', tempNoteId], { fields: ['id', 'body'] });
	} catch {
		// Temp note already deleted or inaccessible
		tempNoteMap.delete(tempNoteId);
		return;
	}
	if (!tempNote || !tempNote.id) {
		tempNoteMap.delete(tempNoteId);
		return;
	}

	// Verify original note still exists
	let origNote: any;
	try {
		origNote = await joplin.data.get(['notes', originalNoteId], { fields: ['id'] });
	} catch {
		// Original gone — just clean up
		tempNoteMap.delete(tempNoteId);
		return;
	}
	if (!origNote || !origNote.id) {
		tempNoteMap.delete(tempNoteId);
		return;
	}

	const editedBody = tempNote.body || '';

	// Re-encrypt and save to original note
	try {
		const encrypted = await encryptData(editedBody, password, aesOptions);
		const encryptedBody = formatEncryptedNote(encrypted, aesOptions);
		await joplin.data.put(['notes', originalNoteId], null, { body: encryptedBody });
	} catch {
		console.error('[EncryptedNotes] Re-encryption failed for temp note', tempNoteId);
		tempNoteMap.delete(tempNoteId);
		return;
	}

	// Wipe and permanently delete the temporary note
	try {
		await joplin.data.put(['notes', tempNoteId], null, { body: '', title: '' });
		await joplin.data.delete(['notes', tempNoteId], { permanent: '1' });
	} catch {
		// If delete fails, at least clean map
	}
	tempNoteMap.delete(tempNoteId);
}

async function finishTempNoteEdit() {
	const note = await getSelectedNote();
	if (!note) return;

	const meta = tempNoteMap.get(note.id);
	if (!meta) {
		await showToast('This note is not a temporary editing copy (or the plugin was restarted).');
		return;
	}

	await finishTempNoteById(note.id, meta);

	// Navigate back to original note
	await joplin.commands.execute('openNote', meta.originalNoteId);
	await showToast('Changes re-encrypted and saved. Temporary note deleted.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getSelectedNote() {
	try {
		const noteIds = await joplin.workspace.selectedNoteIds();
		if (!noteIds || noteIds.length === 0) return null;
		const note = await joplin.data.get(['notes', noteIds[0]], { fields: ['id', 'body', 'title'] });
		if (!note || !note.id) return null;
		return note;
	} catch {
		return null;
	}
}


function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

async function showPasswordDialog(message: string, confirmPassword: boolean, errorMsg = ''): Promise<string | null> {
	if (!passwordDialogHandle) return null;

	// Matches the lock-screen field look exactly:
	// rounded border, background, focus ring, eye toggle inside
	const fieldCss = [
		'width:100%',
		'padding:10px 40px 10px 14px',
		'border:1.5px solid #d1d5db',
		'border-radius:8px',
		'font-size:15px',
		'background:#fff',
		'color:#1f2937',
		'outline:none',
		'box-sizing:border-box',
		'transition:border-color 0.15s',
	].join(';');
	const eyeBtnCss = [
		'position:absolute',
		'right:8px',
		'top:0',
		'bottom:0',
		'margin:auto 0',
		'background:none',
		'border:none',
		'cursor:pointer',
		'padding:4px',
		'display:flex',
		'align-items:center',
		'color:#6b7280',
	].join(';');
	const eyeIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
	const script = '<script>function _tv(b){var i=b.parentElement.querySelector("input");i.type=i.type==="password"?"text":"password";b.title=i.type==="password"?"Show password":"Hide password";}' +
		'document.querySelectorAll("input[type=password],input[type=text]").forEach(function(i){' +
		'i.addEventListener("focus",function(){i.style.borderColor="#4a9fd5";i.style.boxShadow="0 0 0 3px rgba(74,159,213,0.15)";});' +
		'i.addEventListener("blur",function(){i.style.borderColor="#d1d5db";i.style.boxShadow="none";});' +
		'});</script>';

	function field(name: string, label: string, extra = ''): string {
		return `<div style="margin-bottom:10px;${extra}">
			<label style="display:block;font-size:0.85em;margin-bottom:4px;">${label}</label>
			<div style="position:relative;">
				<input type="password" name="${name}" style="${fieldCss}" ${name === 'password' ? 'autofocus' : ''} />
				<button type="button" style="${eyeBtnCss}" title="Show password" onclick="_tv(this)">${eyeIcon}</button>
			</div>
		</div>`;
	}

	const fields = confirmPassword
		? field('password', 'Password') + field('confirmPassword', 'Confirm Password', 'margin-bottom:0;')
		: field('password', 'Password', 'margin-bottom:0;');

	const errorBanner = errorMsg
		? `<p style="color:#dc2626;font-size:0.85em;margin-bottom:10px;text-align:center;">${escapeHtml(errorMsg)}</p>`
		: '';

	const formHtml = `<div style="padding:16px;">
		<p style="margin-bottom:14px;">${escapeHtml(message)}</p>
		${errorBanner}
		<form name="passwordForm">${fields}</form>
		${script}
	</div>`;

	await joplin.views.dialogs.setHtml(passwordDialogHandle, formHtml);
	await joplin.views.dialogs.setButtons(passwordDialogHandle, [
		{ id: 'ok', title: 'OK' },
		{ id: 'cancel', title: 'Cancel' },
	]);

	const result = await joplin.views.dialogs.open(passwordDialogHandle);
	if (result.id !== 'ok') return null;

	const password = result.formData?.passwordForm?.password;
	if (!password) return null;

	if (confirmPassword) {
		const confirm = result.formData?.passwordForm?.confirmPassword;
		if (password !== confirm) {
			return '__mismatch__';
		}
	}

	return password;
}

async function showToast(message: string) {
	if (!messageDialogHandle) {
		console.info(`[EncryptedNotes] ${message}`);
		return;
	}
	await joplin.views.dialogs.setHtml(messageDialogHandle, `
		<div style="padding: 16px;">
			<p>${escapeHtml(message)}</p>
		</div>
	`);
	await joplin.views.dialogs.setButtons(messageDialogHandle, [
		{ id: 'ok', title: 'OK' },
	]);
	await joplin.views.dialogs.open(messageDialogHandle);
}
