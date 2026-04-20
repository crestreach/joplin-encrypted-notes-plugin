/**
 * CodeMirror 6 editor setup for the encrypted-note editor dialog.
 * Bundled into a single IIFE by esbuild → cmEditor.bundle.js
 */
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, drawSelection, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldKeymap, HighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';

// ---------------------------------------------------------------------------
// Theme that reads Joplin CSS variables
// ---------------------------------------------------------------------------
const joplinTheme = EditorView.theme({
	'&': {
		height: '100%',
		fontSize: '16px',
		outline: 'none !important',
	},
	'&.cm-focused': {
		outline: 'none !important',
	},
	'.cm-content': {
		fontFamily: 'var(--joplin-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
		padding: '12px 0 6px 0',
		caretColor: 'var(--joplin-color4, #4a9fd5)',
		webkitUserModify: 'read-write-plaintext-only',
	},
	'.cm-cursor, .cm-dropCursor': {
		borderLeftColor: 'var(--joplin-color4, #4a9fd5)',
		borderLeftWidth: '2px',
		marginLeft: '0',
		pointerEvents: 'none',
	},
	'.cm-cursorLayer': {
		pointerEvents: 'none',
		zIndex: '100',
	},
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
		backgroundColor: 'var(--joplin-selected-color, rgba(74, 159, 213, 0.3))',
	},
	'.cm-panels': {
		backgroundColor: 'var(--joplin-background-color, #fff)',
		color: 'var(--joplin-color, #333)',
	},
	'.cm-panels.cm-panels-top': {
		borderBottom: '1px solid var(--joplin-divider-color, #ddd)',
	},
	'.cm-searchMatch': {
		backgroundColor: 'rgba(255, 215, 0, 0.4)',
	},
	'.cm-searchMatch.cm-searchMatch-selected': {
		backgroundColor: 'rgba(74, 159, 213, 0.4)',
	},
	'.cm-activeLine': {
		backgroundColor: 'transparent',
	},
	'.cm-foldPlaceholder': {
		backgroundColor: 'transparent',
		border: 'none',
		color: 'var(--joplin-color-faded, #999)',
	},
	'.cm-tooltip': {
		backgroundColor: 'var(--joplin-background-color, #fff)',
		border: '1px solid var(--joplin-divider-color, #ddd)',
	},
});

// Override CM6 base theme to remove the focus outline
const noOutlineBase = EditorView.baseTheme({
	'&.cm-editor': {
		outline: 'none !important',
	},
	'&.cm-editor.cm-focused': {
		outline: 'none !important',
	},
});

// Markdown-aware syntax highlighting
const markdownHighlight = HighlightStyle.define([
	{ tag: tags.heading1, fontWeight: '700', fontSize: '1.6em' },
	{ tag: tags.heading2, fontWeight: '700', fontSize: '1.4em' },
	{ tag: tags.heading3, fontWeight: '600', fontSize: '1.2em' },
	{ tag: tags.heading4, fontWeight: '600', fontSize: '1.1em' },
	{ tag: tags.strong, fontWeight: '700' },
	{ tag: tags.emphasis, fontStyle: 'italic' },
	{ tag: tags.strikethrough, textDecoration: 'line-through' },
	{ tag: tags.link, color: 'var(--joplin-color4, #4a9fd5)', textDecoration: 'underline' },
	{ tag: tags.url, color: 'var(--joplin-color4, #4a9fd5)' },
	{ tag: tags.monospace, fontFamily: '"SF Mono","Fira Code","Cascadia Code",Consolas,monospace', backgroundColor: 'rgba(128,128,128,0.12)', borderRadius: '3px', padding: '1px 3px' },
	{ tag: tags.quote, color: 'var(--joplin-color-faded, #6b7280)', fontStyle: 'italic' },
	{ tag: tags.meta, color: 'var(--joplin-color-faded, #999)' },
]);

// ---------------------------------------------------------------------------
// Expose init function globally so the dialog HTML can call it
// ---------------------------------------------------------------------------
(window as any).initCodeMirror = function initCodeMirror(
	container: HTMLElement,
	initialContent: string,
	onUpdate?: (content: string) => void,
): EditorView {
	const state = EditorState.create({
		doc: initialContent,
		extensions: [
			history(),
			drawSelection(),
			dropCursor(),
			indentOnInput(),
			bracketMatching(),
			highlightActiveLine(),
			highlightSelectionMatches(),
			joplinTheme,
			noOutlineBase,
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			syntaxHighlighting(markdownHighlight),
			markdown(),
			keymap.of([
				...defaultKeymap,
				...historyKeymap,
				...foldKeymap,
				...searchKeymap,
				indentWithTab,
			]),
			EditorView.lineWrapping,
			...(onUpdate
				? [EditorView.updateListener.of((update) => {
					if (update.docChanged && onUpdate) {
						onUpdate(update.state.doc.toString());
					}
				})]
				: []),
		],
	});

	return new EditorView({
		state,
		parent: container,
	});
};
