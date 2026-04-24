/**
 * MarkdownIt content script that detects encrypted notes and renders
 * a lock screen with password prompt. Interactivity is handled by
 * lockScreenRuntime.js loaded via assets().
 */

export default function (context: any) {
	const contentScriptId = context.contentScriptId;

	return {
		plugin: function (markdownIt: any, _options: any) {
			const defaultFence =
				markdownIt.renderer.rules.fence ||
				function (tokens: any, idx: number, options: any, env: any, self: any) {
					return self.renderToken(tokens, idx, options);
				};

			markdownIt.renderer.rules.fence = function (
				tokens: any,
				idx: number,
				options: any,
				env: any,
				self: any,
			) {
				const token = tokens[idx];
				const info = (token.info || '').trim();

				if (info === 'encrypted-note') {
					return renderLockScreen(contentScriptId);
				}

				return defaultFence(tokens, idx, options, env, self);
			};
		},

		assets: function () {
			return [
				{ name: 'cmEditor.bundle.js' },
				{ name: 'lockScreenRuntime.js' },
				{ name: 'lockScreenView.css' },
			];
		},
	};
}

function renderLockScreen(contentScriptId: string): string {
	const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	return '<div id="encrypted-note-container" contenteditable="false" data-nonce="' + nonce + '">'
		+ '<div id="encrypted-note-csid" class="encrypted-note-meta">' + contentScriptId + '</div>'
		+ '<div id="lock-screen" class="encrypted-screen" style="display:none;">'
		+ '  <div class="lock-icon">'
		+ '    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
		+ '      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
		+ '      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>'
		+ '      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>'
		+ '    </svg>'
		+ '  </div>'
		+ '  <h2 class="lock-title">This note is encrypted</h2>'
		+ '  <p class="lock-subtitle">Click the button below to unlock</p>'
		+ '  <div class="lock-actions">'
		+ '    <button type="button" id="unlock-btn" class="primary-btn">'
		+ '      <span id="unlock-btn-text">Unlock</span>'
		+ '      <span id="unlock-spinner" class="spinner" style="display:none;"></span>'
		+ '    </button>'
		+ '  </div>'
		+ '</div>'
		+ '<div id="decrypted-view" class="encrypted-screen" style="display:none;">'
		+ '  <div class="decrypted-toolbar">'
		+ '    <span class="decrypted-badge">'
		+ '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"'
		+ '        stroke="currentColor" stroke-width="2" stroke-linecap="round"'
		+ '        stroke-linejoin="round">'
		+ '        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>'
		+ '        <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>'
		+ '      </svg>'
		+ '      Unlocked'
		+ '    </span>'
		+ '    <button id="edit-btn" class="toolbar-btn" title="Edit this note">'
		+ '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"'
		+ '        stroke="currentColor" stroke-width="2" stroke-linecap="round"'
		+ '        stroke-linejoin="round">'
		+ '        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>'
		+ '        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>'
		+ '      </svg>'
		+ '      Edit'
		+ '    </button>'
		+ '    <button id="lock-btn" class="toolbar-btn" title="Lock this note">'
		+ '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"'
		+ '        stroke="currentColor" stroke-width="2" stroke-linecap="round"'
		+ '        stroke-linejoin="round">'
		+ '        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>'
		+ '        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>'
		+ '      </svg>'
		+ '      Lock'
		+ '    </button>'
		+ '  </div>'
		+ '  <div id="decrypted-content" class="decrypted-content"></div>'
		+ '</div>'
		+ '<div id="editor-view" class="encrypted-screen" style="display:none;">'
		+ '  <div class="editor-action-bar">'
		+ '    <button id="editor-cancel-btn" class="toolbar-btn">Cancel</button>'
		+ '    <span class="editor-label">Editing</span>'
		+ '    <button id="editor-save-btn" class="primary-btn editor-save-btn">'
		+ '      <span id="editor-save-text">Save</span>'
		+ '      <span id="editor-save-spinner" class="spinner" style="display:none;"></span>'
		+ '    </button>'
		+ '  </div>'
		+ '  <div class="editor-formatting">'
		+ '    <button id="plaintext-toggle-btn" class="tf-btn" data-action="plaintext-toggle" title="Toggle Plaintext / Markdown">Aa</button>'
		+ '    <span class="tf-sep"></span>'
		+ '    <button class="tf-btn tf-md-btn" data-action="bold" title="Bold"><b>B</b></button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="italic" title="Italic"><i>I</i></button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="strikethrough" title="Strikethrough"><s>S</s></button>'
		+ '    <span class="tf-sep tf-md-btn"></span>'
		+ '    <button class="tf-btn tf-md-btn" data-action="heading" title="Heading">H</button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="ul" title="Bullet list">&bull;</button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="ol" title="Numbered list">1.</button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="checkbox" title="Checkbox">&#9745;</button>'
		+ '    <span class="tf-sep tf-md-btn"></span>'
		+ '    <button class="tf-btn tf-md-btn" data-action="code" title="Inline code">&lt;/&gt;</button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="codeblock" title="Code block">```</button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="quote" title="Quote">&ldquo;</button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="link" title="Link">&#128279;</button>'
		+ '    <button class="tf-btn tf-md-btn" data-action="hr" title="Horizontal rule">&mdash;</button>'
		+ '  </div>'
		+ '  <div id="cm-editor-container"></div>'
		+ '</div>'
		+ '</div>';
}
