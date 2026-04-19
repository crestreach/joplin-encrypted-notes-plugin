/**
 * Editor panel webview script.
 * Handles password prompt, markdown editing, and save/cancel actions.
 * Communicates with the plugin backend via webviewApi.postMessage().
 */

document.addEventListener('DOMContentLoaded', function () {
	init();
});

// Joplin reuses the webview when setHtml() is called on a visible panel,
// so DOMContentLoaded won't fire again.  Poll for an empty #app div to
// detect when the panel needs re-initialisation.
setInterval(function () {
	var app = document.getElementById('app');
	if (app && app.children.length === 0) {
		init();
	}
}, 250);

var _listenersReady = false;

function init() {
	// Event listeners only need to be added once (they survive setHtml)
	if (!_listenersReady) {
		_listenersReady = true;
		document.addEventListener('click', handleClick);
		document.addEventListener('submit', handleSubmit);
		document.addEventListener('keydown', handleKeydown);
	}

	// Request current note state from plugin
	webviewApi.postMessage({ type: 'getState' }).then(function (state) {
		if (state && state.screen === 'editor') {
			showEditor(state.content || '');
		} else {
			showPasswordScreen(state && state.message);
		}
	});
}

function handleClick(e) {
	var target = e.target.closest('[data-action]');
	if (!target) return;

	var action = target.getAttribute('data-action');

	switch (action) {
		case 'save':
			saveNote();
			break;
		case 'cancel':
			webviewApi.postMessage({ type: 'cancel' });
			break;
		case 'togglePassword':
			togglePasswordVisibility();
			break;
	}
}

function handleSubmit(e) {
	e.preventDefault();
	var form = e.target.closest('#password-form');
	if (form) {
		submitPassword();
	}
}

function handleKeydown(e) {
	// Ctrl/Cmd + S to save
	if ((e.ctrlKey || e.metaKey) && e.key === 's') {
		e.preventDefault();
		var editor = document.getElementById('markdown-editor');
		if (editor && editor.offsetParent !== null) {
			saveNote();
		}
	}
}

// --- Password screen ---

function showPasswordScreen(message) {
	document.getElementById('app').innerHTML = '\
		<div class="password-screen">\
			<div class="lock-icon">\
				<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"\
					stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">\
					<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>\
					<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>\
				</svg>\
			</div>\
			<h2>Edit Encrypted Note</h2>\
			<p>Enter your password to decrypt and edit</p>\
			<form id="password-form" class="password-form" onsubmit="return false;">\
				<div class="input-group">\
					<input type="password" id="editor-password" placeholder="Password"\
						autocomplete="off" autofocus />\
				</div>\
				<div id="password-error" class="error"></div>\
				<div class="actions">\
					<button type="button" class="btn" data-action="cancel">Cancel</button>\
					<button type="submit" class="btn btn-primary" id="submit-password-btn">Unlock &amp; Edit</button>\
				</div>\
			</form>\
		</div>';

	if (message) {
		var errorEl = document.getElementById('password-error');
		errorEl.textContent = message;
		errorEl.style.display = 'block';
	}

	var input = document.getElementById('editor-password');
	if (input) input.focus();
}

async function submitPassword() {
	var input = document.getElementById('editor-password');
	var password = input ? input.value : '';
	if (!password) return;

	var btn = document.getElementById('submit-password-btn');
	btn.disabled = true;
	btn.textContent = 'Decrypting...';

	var response = await webviewApi.postMessage({
		type: 'submitPassword',
		password: password,
	});

	if (response && response.type === 'success') {
		showEditor(response.content);
	} else {
		btn.disabled = false;
		btn.textContent = 'Unlock & Edit';
		var errorEl = document.getElementById('password-error');
		errorEl.textContent = (response && response.msg) || 'Incorrect password';
		errorEl.style.display = 'block';
		input.value = '';
		input.focus();
	}
}

// --- Editor screen ---

function showEditor(content) {
	var charCount = content.length;
	var wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
	var lineCount = content.split('\n').length;

	document.getElementById('app').innerHTML = '\
		<div class="editor-container">\
			<div class="editor-toolbar">\
				<span class="badge">\
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none"\
						stroke="currentColor" stroke-width="2" stroke-linecap="round"\
						stroke-linejoin="round">\
						<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>\
						<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>\
					</svg>\
					Editing Encrypted Note\
				</span>\
				<span class="spacer"></span>\
				<button class="btn" data-action="cancel">Cancel</button>\
				<button class="btn btn-primary" data-action="save">\
					<span class="toolbar-btn-icon">\
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none"\
							stroke="currentColor" stroke-width="2" stroke-linecap="round"\
							stroke-linejoin="round">\
							<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>\
							<polyline points="17 21 17 13 7 13 7 21"></polyline>\
							<polyline points="7 3 7 8 15 8"></polyline>\
						</svg>\
						Save &amp; Lock\
					</span>\
				</button>\
			</div>\
			<div class="editor-area">\
				<textarea id="markdown-editor" placeholder="Start writing..."></textarea>\
			</div>\
			<div class="status-bar">\
				<span class="status-item" id="status-words">' + wordCount + ' words</span>\
				<span class="status-item" id="status-chars">' + charCount + ' chars</span>\
				<span class="status-item" id="status-lines">' + lineCount + ' lines</span>\
			</div>\
		</div>\
		<div id="toast" class="toast"></div>';

	var editor = document.getElementById('markdown-editor');
	editor.value = content;
	editor.focus();

	// Update status bar on input
	editor.addEventListener('input', function () {
		var text = editor.value;
		var wc = text.trim() ? text.trim().split(/\s+/).length : 0;
		document.getElementById('status-words').textContent = wc + ' words';
		document.getElementById('status-chars').textContent = text.length + ' chars';
		document.getElementById('status-lines').textContent = text.split('\n').length + ' lines';
	});

	// Tab key inserts a tab character
	editor.addEventListener('keydown', function (e) {
		if (e.key === 'Tab') {
			e.preventDefault();
			var start = editor.selectionStart;
			var end = editor.selectionEnd;
			editor.value = editor.value.substring(0, start) + '\t' + editor.value.substring(end);
			editor.selectionStart = editor.selectionEnd = start + 1;
		}
	});
}

async function saveNote() {
	var editor = document.getElementById('markdown-editor');
	if (!editor) return;

	var saveBtn = document.querySelector('[data-action="save"]');
	if (saveBtn) {
		saveBtn.disabled = true;
		saveBtn.textContent = 'Saving...';
	}

	var response = await webviewApi.postMessage({
		type: 'save',
		content: editor.value,
	});

	if (response && response.type === 'success') {
		showToast('Note saved and encrypted', 'success');
		// Brief delay then close panel
		setTimeout(function () {
			webviewApi.postMessage({ type: 'done' });
		}, 800);
	} else {
		showToast((response && response.msg) || 'Save failed', 'error');
		if (saveBtn) {
			saveBtn.disabled = false;
			saveBtn.innerHTML = '<span class="toolbar-btn-icon">' +
				'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
				'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
				'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>' +
				'<polyline points="17 21 17 13 7 13 7 21"></polyline>' +
				'<polyline points="7 3 7 8 15 8"></polyline>' +
				'</svg> Save &amp; Lock</span>';
		}
	}
}

function showToast(message, type) {
	var toast = document.getElementById('toast');
	if (!toast) return;
	toast.textContent = message;
	toast.className = 'toast ' + type + ' show';
	setTimeout(function () {
		toast.className = 'toast';
	}, 2500);
}

function togglePasswordVisibility() {
	var input = document.getElementById('editor-password');
	if (input) {
		input.type = input.type === 'password' ? 'text' : 'password';
	}
}
