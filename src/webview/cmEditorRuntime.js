// CodeMirror dialog runtime — toolbar actions + hidden form sync
(function () {
	'use strict';

	var cmView = null;
	var container = document.getElementById('cm-container');
	var hiddenField = document.getElementById('cm-hidden-content');

	if (!container || !hiddenField) return;

	// Read initial content from hidden textarea
	var initial = hiddenField.value || '';

	// Initialize CodeMirror (function exposed by cmEditor.bundle.js)
	// Use polling because the bundle script may load after this script
	function tryInit() {
		if (typeof window.initCodeMirror === 'function') {
			cmView = window.initCodeMirror(container, initial, function (content) {
				// Keep hidden textarea in sync so formData picks it up
				hiddenField.value = content;
			});
		} else {
			setTimeout(tryInit, 50);
		}
	}
	tryInit();

	// Toolbar button actions
	document.addEventListener('click', function (e) {
		var btn = e.target.closest('.tb-btn');
		if (!btn || !cmView) return;
		e.preventDefault();

		var action = btn.getAttribute('data-action');
		if (!action) return;

		cmView.focus();

		switch (action) {
			case 'bold':          wrapSelection('**', '**', 'bold'); break;
			case 'italic':        wrapSelection('*', '*', 'italic'); break;
			case 'strikethrough': wrapSelection('~~', '~~', 'text'); break;
			case 'code':          wrapSelection('`', '`', 'code'); break;
			case 'codeblock':     wrapSelection('\n```\n', '\n```\n', 'code'); break;
			case 'heading':       prependLine('# '); break;
			case 'ul':            prependLine('- '); break;
			case 'ol':            prependLine('1. '); break;
			case 'checkbox':      prependLine('- [ ] '); break;
			case 'quote':         prependLine('> '); break;
			case 'link':          insertLink(); break;
			case 'hr':            insertAtCursor('\n---\n'); break;
		}
	});

	function getSelection() {
		var state = cmView.state;
		var sel = state.selection.main;
		return {
			from: sel.from,
			to: sel.to,
			text: state.doc.sliceString(sel.from, sel.to),
		};
	}

	function wrapSelection(before, after, placeholder) {
		var sel = getSelection();
		var text = sel.text || placeholder;
		var replacement = before + text + after;
		cmView.dispatch({
			changes: { from: sel.from, to: sel.to, insert: replacement },
			selection: {
				anchor: sel.from + before.length,
				head: sel.from + before.length + text.length,
			},
		});
	}

	function prependLine(prefix) {
		var state = cmView.state;
		var sel = state.selection.main;
		var line = state.doc.lineAt(sel.from);
		cmView.dispatch({
			changes: { from: line.from, to: line.from, insert: prefix },
			selection: { anchor: sel.from + prefix.length },
		});
	}

	function insertLink() {
		var sel = getSelection();
		var text = sel.text || 'text';
		var replacement = '[' + text + '](url)';
		var urlStart = sel.from + 1 + text.length + 2; // after '[text]('
		cmView.dispatch({
			changes: { from: sel.from, to: sel.to, insert: replacement },
			selection: { anchor: urlStart, head: urlStart + 3 },
		});
	}

	function insertAtCursor(text) {
		var sel = getSelection();
		cmView.dispatch({
			changes: { from: sel.from, to: sel.to, insert: text },
			selection: { anchor: sel.from + text.length },
		});
	}
})();
