// Editor dialog JavaScript — markdown toolbar + keyboard shortcuts
(function() {
	'use strict';

	var ta = document.getElementById('editor-textarea');
	var statusLine = document.getElementById('status-line');
	var statusCol = document.getElementById('status-col');
	if (!ta) return;

	// Update cursor position in status bar
	function updateStatus() {
		var val = ta.value;
		var pos = ta.selectionStart;
		var before = val.substring(0, pos);
		var lines = before.split('\n');
		var line = lines.length;
		var col = lines[lines.length - 1].length + 1;
		if (statusLine) statusLine.textContent = 'Ln ' + line;
		if (statusCol) statusCol.textContent = 'Col ' + col;
	}

	ta.addEventListener('click', updateStatus);
	ta.addEventListener('keyup', updateStatus);
	ta.addEventListener('input', updateStatus);

	// Tab key inserts a tab character
	ta.addEventListener('keydown', function(e) {
		if (e.key === 'Tab') {
			e.preventDefault();
			insertText('\t');
		}
	});

	// Toolbar button actions
	document.addEventListener('click', function(e) {
		var btn = e.target.closest('.tb-btn');
		if (!btn) return;
		e.preventDefault();

		var action = btn.getAttribute('data-action');
		if (!action) return;

		ta.focus();

		switch (action) {
			case 'bold':      wrapSelection('**', '**'); break;
			case 'italic':    wrapSelection('*', '*'); break;
			case 'strikethrough': wrapSelection('~~', '~~'); break;
			case 'code':      wrapSelection('`', '`'); break;
			case 'codeblock': wrapSelection('\n```\n', '\n```\n'); break;
			case 'heading':   prependLine('# '); break;
			case 'ul':        prependLine('- '); break;
			case 'ol':        prependLine('1. '); break;
			case 'checkbox':  prependLine('- [ ] '); break;
			case 'quote':     prependLine('> '); break;
			case 'link':      insertLink(); break;
			case 'hr':        insertText('\n---\n'); break;
		}

		updateStatus();
	});

	function insertText(text) {
		var start = ta.selectionStart;
		var end = ta.selectionEnd;
		var val = ta.value;
		ta.value = val.substring(0, start) + text + val.substring(end);
		ta.selectionStart = ta.selectionEnd = start + text.length;
	}

	function wrapSelection(before, after) {
		var start = ta.selectionStart;
		var end = ta.selectionEnd;
		var val = ta.value;
		var selected = val.substring(start, end);

		if (selected.length === 0) {
			// No selection — insert placeholder
			var placeholder = before === '`' ? 'code' : before === '**' ? 'bold' : before === '*' ? 'italic' : 'text';
			ta.value = val.substring(0, start) + before + placeholder + after + val.substring(end);
			ta.selectionStart = start + before.length;
			ta.selectionEnd = start + before.length + placeholder.length;
		} else {
			ta.value = val.substring(0, start) + before + selected + after + val.substring(end);
			ta.selectionStart = start + before.length;
			ta.selectionEnd = start + before.length + selected.length;
		}
	}

	function prependLine(prefix) {
		var start = ta.selectionStart;
		var val = ta.value;
		// Find start of current line
		var lineStart = val.lastIndexOf('\n', start - 1) + 1;
		ta.value = val.substring(0, lineStart) + prefix + val.substring(lineStart);
		ta.selectionStart = ta.selectionEnd = start + prefix.length;
	}

	function insertLink() {
		var start = ta.selectionStart;
		var end = ta.selectionEnd;
		var val = ta.value;
		var selected = val.substring(start, end);

		if (selected.length === 0) {
			ta.value = val.substring(0, start) + '[text](url)' + val.substring(end);
			ta.selectionStart = start + 1;
			ta.selectionEnd = start + 5;
		} else {
			ta.value = val.substring(0, start) + '[' + selected + '](url)' + val.substring(end);
			ta.selectionStart = start + selected.length + 3;
			ta.selectionEnd = start + selected.length + 6;
		}
	}

	// Initial status
	updateStatus();
})();
