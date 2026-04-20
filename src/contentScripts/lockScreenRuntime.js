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
	// After CM save, refresh the decrypted view explicitly
	// (mobile may not fire joplin-noteDidUpdate reliably)
	if (res && res.type === 'saved') {
		checkAutoUnlock();
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
	if (el.closest('#unlock-btn'))  { e.preventDefault(); requestUnlock(); return; }
	if (el.closest('#edit-btn'))    { e.preventDefault(); openEditor(); return; }
	if (el.closest('#lock-btn'))    { e.preventDefault(); relock(); return; }
});

// Block keyboard editing within our container (Rich Text mode protection)
document.addEventListener('keydown', function (e) {
	var container = document.getElementById('encrypted-note-container');
	if (container && container.contains(e.target)) {
		if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
			e.preventDefault();
		}
	}
});

document.addEventListener('beforeinput', function (e) {
	var container = document.getElementById('encrypted-note-container');
	if (!container || !container.contains(e.target)) return;
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
	// Immediately restore cached view to prevent blink during DOM re-render
	if (_cachedDecryptedHtml) {
		showDecryptedView(_cachedDecryptedHtml);
	}
	checkAutoUnlock();
});

// Also check on initial script load
checkAutoUnlock();
