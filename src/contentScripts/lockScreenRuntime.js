/**
 * Runtime interaction handler for the encrypted-note lock screen.
 * Loaded as an asset via the MarkdownIt content script.
 *
 * Error feedback uses a red-border highlight + visible error text,
 * rather than the placeholder-swap/jiggle pattern.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readCsId() {
	var node = document.getElementById('encrypted-note-csid');
	return node ? node.textContent.trim() : '';
}

function setFieldError(input, msg) {
	if (input) {
		input.value = '';
		input.classList.add('field-error');
		input.focus();
	}
	var errBox = document.getElementById('unlock-error');
	if (errBox) {
		errBox.textContent = msg;
		errBox.style.display = 'block';
	}
}

function clearFieldError(input) {
	if (input) input.classList.remove('field-error');
	var errBox = document.getElementById('unlock-error');
	if (errBox) errBox.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Password stored in JS runtime (cleared on lock or note navigation)
// ---------------------------------------------------------------------------

var _storedPassword = null;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function showDecryptedView(markdown) {
	document.getElementById('lock-screen').style.display = 'none';
	var view = document.getElementById('decrypted-view');
	var body = document.getElementById('decrypted-content');
	if (view) view.style.display = 'block';
	if (body) {
		var md = window.__encryptedNotes_md;
		body.innerHTML = (md && markdown) ? md.render(markdown) : (markdown || '');
	}
}

function isDecryptedViewVisible() {
	var view = document.getElementById('decrypted-view');
	return view && view.style.display !== 'none';
}

async function submitPassword() {
	var csId = readCsId();
	if (!csId) return;

	var input = document.getElementById('unlock-password');
	var pwd = input ? input.value : '';
	if (!pwd) {
		setFieldError(input, 'Please enter a password');
		return;
	}

	var btn = document.getElementById('unlock-btn');
	var label = document.getElementById('unlock-btn-text');
	var spin = document.getElementById('unlock-spinner');

	clearFieldError(input);
	if (btn) btn.disabled = true;
	if (label) label.textContent = 'Unlocking\u2026';
	if (spin) spin.style.display = 'inline-block';

	try {
		var res = await webviewApi.postMessage(csId, { type: 'unlock', password: pwd });

		if (res && res.type === 'success') {
			_storedPassword = pwd;
			showDecryptedView(res.markdown);
		} else {
			setFieldError(input, (res && res.msg) || 'Wrong password');
		}
	} catch (_) {
		setFieldError(input, 'Something went wrong');
	}

	if (btn) btn.disabled = false;
	if (label) label.textContent = 'Unlock';
	if (spin) spin.style.display = 'none';
}

function toggleVisibility() {
	var input = document.getElementById('unlock-password');
	if (!input) return;
	input.type = input.type === 'password' ? 'text' : 'password';
	var btn = document.getElementById('toggle-password-visibility');
	if (btn) btn.title = input.type === 'password' ? 'Show password' : 'Hide password';
}

async function openEditor() {
	var csId = readCsId();
	if (!csId) return;
	var res = await webviewApi.postMessage(csId, { type: 'requestEdit', password: _storedPassword });
	// After the dialog closes, if saved, re-unlock to show fresh content
	if (res && res.type === 'saved' && _storedPassword) {
		var unlockRes = await webviewApi.postMessage(csId, { type: 'unlock', password: _storedPassword });
		if (unlockRes && unlockRes.type === 'success') {
			showDecryptedView(unlockRes.markdown);
		}
	}
}

async function relock() {
	_storedPassword = null;

	var lock = document.getElementById('lock-screen');
	var view = document.getElementById('decrypted-view');
	var body = document.getElementById('decrypted-content');
	var input = document.getElementById('unlock-password');

	if (view) view.style.display = 'none';
	if (body) body.innerHTML = '';
	if (lock) lock.style.display = 'flex';
	clearFieldError(input);
	if (input) {
		input.value = '';
		input.type = 'password';
		input.focus();
	}
}

function resetForm() {
	var input = document.getElementById('unlock-password');
	clearFieldError(input);
	if (input) { input.value = ''; input.focus(); }
}

// ---------------------------------------------------------------------------
// Clear error state as soon as the user starts typing again
// ---------------------------------------------------------------------------

document.addEventListener('input', function (e) {
	if (e.target && e.target.id === 'unlock-password') {
		clearFieldError(e.target);
	}
});

// ---------------------------------------------------------------------------
// Delegated event listeners
// ---------------------------------------------------------------------------

document.addEventListener('click', function (e) {
	var el = e.target;
	if (el.closest('#unlock-btn'))                   { e.preventDefault(); submitPassword(); return; }
	if (el.closest('#toggle-password-visibility'))   { e.preventDefault(); toggleVisibility(); return; }
	if (el.closest('#edit-btn'))                      { e.preventDefault(); openEditor(); return; }
	if (el.closest('#lock-btn'))                      { e.preventDefault(); relock(); return; }
});

document.addEventListener('keydown', function (e) {
	if (e.target.id === 'unlock-password' && e.key === 'Enter') {
		e.preventDefault();
		submitPassword();
	}
});

document.addEventListener('joplin-noteDidUpdate', function () { resetForm(); });
setTimeout(resetForm, 200);
