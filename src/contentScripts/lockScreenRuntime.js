/**
 * Runtime interaction handler for the encrypted-note lock screen.
 * Loaded as an asset via the MarkdownIt content script.
 *
 * Password entry happens via a plugin popup dialog — this script just
 * sends messages and updates the view.
 */

// ---------------------------------------------------------------------------
// Protect lock screen from editing in Rich Text (WYSIWYG) mode.
// ---------------------------------------------------------------------------

(function protectFromEditing() {
	var container = document.getElementById('encrypted-note-container');
	if (!container) return;

	function lockContainer() {
		if (container.contentEditable !== 'false') {
			container.contentEditable = 'false';
		}
	}
	lockContainer();

	try {
		new MutationObserver(lockContainer)
			.observe(container, { attributes: true, attributeFilter: ['contenteditable'] });
	} catch (_) {}

	setInterval(lockContainer, 1000);
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readCsId() {
	var node = document.getElementById('encrypted-note-csid');
	return node ? node.textContent.trim() : '';
}

// ---------------------------------------------------------------------------
// Password stored in JS runtime (cleared on lock or note navigation)
// ---------------------------------------------------------------------------

var _storedPassword = null;
var _cachedDecryptedHtml = null;
var cmView = null;
var _plaintextMode = false;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function showDecryptedView(html) {
	_cachedDecryptedHtml = html;
	document.getElementById('lock-screen').style.display = 'none';
	var view = document.getElementById('decrypted-view');
	var body = document.getElementById('decrypted-content');
	if (view) view.style.display = 'block';
	if (body) {
		body.innerHTML = html || '';
	}
}

async function requestUnlock() {
	var csId = readCsId();
	if (!csId) return;

	var btn = document.getElementById('unlock-btn');
	var label = document.getElementById('unlock-btn-text');
	var spin = document.getElementById('unlock-spinner');

	if (btn) btn.disabled = true;
	if (label) label.textContent = 'Unlocking\u2026';
	if (spin) spin.style.display = 'inline-block';

	try {
		var res = await webviewApi.postMessage(csId, { type: 'unlock' });

		if (res && res.type === 'success') {
			_storedPassword = res.password || null;
			showDecryptedView(res.html);
		}
		// 'cancelled' or 'error' — just reset the button
	} catch (_) {
		// ignore
	}

	if (btn) btn.disabled = false;
	if (label) label.textContent = 'Unlock';
	if (spin) spin.style.display = 'none';
}

async function openEditor() {
	var csId = readCsId();
	if (!csId) return;
	var res = await webviewApi.postMessage(csId, { type: 'requestEdit', password: _storedPassword });
	if (res && res.type === 'editContent') {
		_storedPassword = res.password || _storedPassword;
		showEditorView(res.content);
	} else if (res && res.type === 'saved') {
		checkAutoUnlock();
	}
}

// ---------------------------------------------------------------------------
// Embedded editor (replaces dialog for mobile compatibility)
// ---------------------------------------------------------------------------

function showEditorView(content) {
	document.getElementById('lock-screen').style.display = 'none';
	document.getElementById('decrypted-view').style.display = 'none';
	var root = document.getElementById('encrypted-note-container');
	if (root) root.removeAttribute('contenteditable');
	var editorView = document.getElementById('editor-view');
	var container = document.getElementById('cm-editor-container');
	if (editorView) editorView.style.display = 'block';

	// Detect plaintext wrapper and strip it for editing
	var rawContent = content || '';
	var isPlain = /^\s*```plaintext\s*[\r\n]/.test(rawContent);
	if (isPlain) {
		rawContent = rawContent.replace(/^\s*```plaintext\s*[\r\n]/, '');
		rawContent = rawContent.replace(/\r?\n```\s*$/, '');
	}
	_plaintextMode = isPlain;
	updatePlaintextUI();

	if (container) {
		if (cmView) { cmView.destroy(); cmView = null; }
		container.innerHTML = '';
		initCmEditor(container, rawContent);
	}
}

function initCmEditor(container, content) {
	var initFn = _plaintextMode ? window.initCodeMirrorPlain : window.initCodeMirror;
	if (typeof initFn === 'function') {
		cmView = initFn(container, content);
		cmView.focus();
	} else {
		var attempts = 0;
		var poll = setInterval(function() {
			initFn = _plaintextMode ? window.initCodeMirrorPlain : window.initCodeMirror;
			if (typeof initFn === 'function') {
				clearInterval(poll);
				cmView = initFn(container, content);
				cmView.focus();
			} else if (++attempts > 100) {
				clearInterval(poll);
			}
		}, 50);
	}
}

function hideEditorView() {
	var editorView = document.getElementById('editor-view');
	if (editorView) editorView.style.display = 'none';
	if (cmView) { cmView.destroy(); cmView = null; }
	var root = document.getElementById('encrypted-note-container');
	if (root) root.contentEditable = 'false';
}

async function saveFromEditor() {
	if (!cmView) return;
	var content = cmView.state.doc.toString();
	// Re-wrap in ```plaintext fence if plaintext mode is active
	if (_plaintextMode) {
		content = '```plaintext\n' + content + '\n```';
	}
	var csId = readCsId();
	if (!csId) return;

	var saveBtn = document.getElementById('editor-save-btn');
	var saveText = document.getElementById('editor-save-text');
	var saveSpin = document.getElementById('editor-save-spinner');
	if (saveBtn) saveBtn.disabled = true;
	if (saveText) saveText.textContent = 'Saving\u2026';
	if (saveSpin) saveSpin.style.display = 'inline-block';

	try {
		var res = await webviewApi.postMessage(csId, {
			type: 'saveEdit',
			password: _storedPassword,
			content: content
		});
		if (res && res.type === 'saved') {
			_storedPassword = res.password || _storedPassword;
			_cachedDecryptedHtml = res.html;
			hideEditorView();
			showDecryptedView(res.html);
		}
	} catch (_) {}

	if (saveBtn) saveBtn.disabled = false;
	if (saveText) saveText.textContent = 'Save';
	if (saveSpin) saveSpin.style.display = 'none';
}

function cancelEditor() {
	hideEditorView();
	if (_cachedDecryptedHtml) {
		showDecryptedView(_cachedDecryptedHtml);
	} else {
		var lock = document.getElementById('lock-screen');
		if (lock) lock.style.display = 'flex';
	}
}

function handleToolbarAction(btn) {
	if (!cmView) return;
	var action = btn.getAttribute('data-action');
	if (!action) return;
	cmView.focus();

	switch (action) {
		case 'bold':          cmWrap('**', '**', 'bold'); break;
		case 'italic':        cmWrap('*', '*', 'italic'); break;
		case 'strikethrough': cmWrap('~~', '~~', 'text'); break;
		case 'code':          cmWrap('`', '`', 'code'); break;
		case 'codeblock':     cmWrap('\n```\n', '\n```\n', 'code'); break;
		case 'heading':       cmPrependLine('# '); break;
		case 'ul':            cmPrependLine('- '); break;
		case 'ol':            cmPrependLine('1. '); break;
		case 'checkbox':      cmPrependLine('- [ ] '); break;
		case 'quote':         cmPrependLine('> '); break;
		case 'link':          cmInsertLink(); break;
		case 'hr':            cmInsertText('\n---\n'); break;
	}
}

function cmGetSelection() {
	var state = cmView.state;
	var sel = state.selection.main;
	return { from: sel.from, to: sel.to, text: state.doc.sliceString(sel.from, sel.to) };
}

function cmWrap(before, after, placeholder) {
	var sel = cmGetSelection();
	var text = sel.text || placeholder;
	var replacement = before + text + after;
	cmView.dispatch({
		changes: { from: sel.from, to: sel.to, insert: replacement },
		selection: { anchor: sel.from + before.length, head: sel.from + before.length + text.length }
	});
}

function cmPrependLine(prefix) {
	var state = cmView.state;
	var sel = state.selection.main;
	var line = state.doc.lineAt(sel.from);
	cmView.dispatch({
		changes: { from: line.from, to: line.from, insert: prefix },
		selection: { anchor: sel.from + prefix.length }
	});
}

function cmInsertLink() {
	var sel = cmGetSelection();
	var text = sel.text || 'text';
	var replacement = '[' + text + '](url)';
	var urlStart = sel.from + 1 + text.length + 2;
	cmView.dispatch({
		changes: { from: sel.from, to: sel.to, insert: replacement },
		selection: { anchor: urlStart, head: urlStart + 3 }
	});
}

function cmInsertText(text) {
	var sel = cmGetSelection();
	cmView.dispatch({
		changes: { from: sel.from, to: sel.to, insert: text },
		selection: { anchor: sel.from + text.length }
	});
}

// ---------------------------------------------------------------------------
// Plaintext mode toggle
// ---------------------------------------------------------------------------

function updatePlaintextUI() {
	var toggleBtn = document.getElementById('plaintext-toggle-btn');
	if (toggleBtn) {
		if (_plaintextMode) {
			toggleBtn.classList.add('tf-btn-active');
		} else {
			toggleBtn.classList.remove('tf-btn-active');
		}
	}
	// Hide/show markdown formatting buttons
	var mdBtns = document.querySelectorAll('.tf-md-btn');
	for (var i = 0; i < mdBtns.length; i++) {
		mdBtns[i].style.display = _plaintextMode ? 'none' : '';
	}
}

function togglePlaintextMode() {
	if (!cmView) return;
	// Grab current content from the editor
	var content = cmView.state.doc.toString();
	_plaintextMode = !_plaintextMode;
	updatePlaintextUI();
	// Recreate the CM editor with or without markdown extensions
	var container = document.getElementById('cm-editor-container');
	if (container) {
		cmView.destroy();
		cmView = null;
		container.innerHTML = '';
		initCmEditor(container, content);
	}
}

async function relock() {
	_storedPassword = null;
	_cachedDecryptedHtml = null;

	var csId = readCsId();
	if (csId) {
		await webviewApi.postMessage(csId, { type: 'relock' });
	}

	var lock = document.getElementById('lock-screen');
	var view = document.getElementById('decrypted-view');
	var body = document.getElementById('decrypted-content');

	if (view) view.style.display = 'none';
	if (body) body.innerHTML = '';
	if (lock) lock.style.display = 'flex';
}

// ---------------------------------------------------------------------------
// Delegated event listeners
// ---------------------------------------------------------------------------

document.addEventListener('click', function (e) {
	var el = e.target;
	if (el.closest('#unlock-btn'))       { e.preventDefault(); requestUnlock(); return; }
	if (el.closest('#edit-btn'))         { e.preventDefault(); openEditor(); return; }
	if (el.closest('#lock-btn'))         { e.preventDefault(); relock(); return; }
	if (el.closest('#editor-save-btn'))  { e.preventDefault(); saveFromEditor(); return; }
	if (el.closest('#editor-cancel-btn')){ e.preventDefault(); cancelEditor(); return; }
	var tfBtn = el.closest('.tf-btn');
	if (tfBtn) {
		e.preventDefault();
		if (tfBtn.getAttribute('data-action') === 'plaintext-toggle') {
			togglePlaintextMode();
			return;
		}
		if (!_plaintextMode) handleToolbarAction(tfBtn);
		return;
	}
});

// Block keyboard editing within our container (Rich Text mode protection)
// but allow typing in the CodeMirror editor
document.addEventListener('keydown', function (e) {
	var container = document.getElementById('encrypted-note-container');
	if (container && container.contains(e.target)) {
		if (e.target && e.target.closest && e.target.closest('#cm-editor-container')) return;
		if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
			e.preventDefault();
		}
	}
});

document.addEventListener('beforeinput', function (e) {
	var container = document.getElementById('encrypted-note-container');
	if (!container || !container.contains(e.target)) return;
	if (e.target && e.target.closest && e.target.closest('#cm-editor-container')) return;
	e.preventDefault();
});

// ---------------------------------------------------------------------------
// Auto-unlock: fires after Joplin re-renders (e.g. after CodeMirror save)
// ---------------------------------------------------------------------------

async function checkAutoUnlock() {
	var csId = readCsId();
	if (!csId) return;
	try {
		var res = await webviewApi.postMessage(csId, { type: 'init' });
		if (res && res.type === 'success') {
			_storedPassword = res.password || null;
			showDecryptedView(res.html);
			return;
		}
	} catch (_) {}
	// Not unlocked — clear cache and show the lock screen
	_cachedDecryptedHtml = null;
	var lock = document.getElementById('lock-screen');
	if (lock) lock.style.display = 'flex';
}

document.addEventListener('joplin-noteDidUpdate', function () {
	// Don't interfere while the embedded editor is active
	var editorView = document.getElementById('editor-view');
	if (editorView && editorView.style.display !== 'none') return;
	// Immediately restore cached view to prevent blink during DOM re-render
	if (_cachedDecryptedHtml) {
		showDecryptedView(_cachedDecryptedHtml);
	}
	checkAutoUnlock();
});

// Also check on initial script load
checkAutoUnlock();
