/**
 * Bundles the CodeMirror webview JS into a single IIFE file
 * that can be loaded via joplin.views.dialogs.addScript().
 */
const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
	entryPoints: [path.resolve(__dirname, '../src/webview/cmEditorSetup.ts')],
	bundle: true,
	format: 'iife',
	target: ['es2020'],
	outfile: path.resolve(__dirname, '../src/contentScripts/cmEditor.bundle.js'),
	minify: true,
	sourcemap: false,
});

console.log('CodeMirror webview bundle built successfully.');
