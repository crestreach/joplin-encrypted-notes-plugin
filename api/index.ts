// The Joplin plugin sandbox injects `joplin` as a global variable at runtime.
// We declare it here so TypeScript sees it, but produce no local assignment —
// the compiled JS will simply reference the global.

declare const joplin: any;
export default joplin;
