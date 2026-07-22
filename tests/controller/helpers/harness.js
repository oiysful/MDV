// Controller-level test harness.
//
// This layer sits between tests/unit (pure helpers) and tests/electron (full app E2E).
// It requires the real controller factories (src/renderer/*.js), wires 2-3 of them
// together over a minimal jsdom DOM + stub callbacks, and asserts that one controller's
// callback actually reaches into another controller with the right arguments.
//
// The stub wiring below mirrors the real wiring in src/renderer/app.js (lines ~25-183).
// Each test file cites the specific app.js:<line> it copies a callback signature from, so
// the harness can't silently diverge from production wiring (the "regression of the
// regression" risk called out in docs/plans/done/2026-07-20/11-controller-level-tests.md).
//
// Generalizes the small precedent in tests/unit/search.test.js:6-23
// (createSearchController driven directly on a jsdom DOM).

const { JSDOM } = require('jsdom')

// workspace.js/explorer.js read roving-tabindex index math off globalThis.MDVRoving
// (see src/renderer/roving.js) rather than importing it directly, matching how
// index.html loads it as a plain <script> before workspace.js/explorer.js. Requiring
// it here (a side-effecting module load) is the Node/CommonJS equivalent of that
// script order, so createWorkspaceController/createExplorerController don't blow up
// looking up getRovingIndex on an unset global.
require('../../../src/renderer/roving.js')

// Minimal DOM containing every element the workspace/editor/search controllers look up,
// either through getRefs() or directly via document.getElementById(...).
const DOM_TEMPLATE = `
  <div id="search-bar" style="display:none">
    <input id="search-input">
    <span id="search-count"></span>
  </div>
  <div id="tab-strip"><div id="tab-list"></div></div>
  <div id="scroll-area">
    <div id="content"></div>
    <div id="source-view">
      <div id="line-highlight"></div>
      <pre id="source-lines"></pre>
      <textarea id="source-editor"></textarea>
    </div>
  </div>
  <ul id="toc-list"></ul>
  <button id="btn-mode"><svg></svg></button>
  <button id="btn-split"></button>
`

// Builds the jsdom window and installs the globals the controllers reference bare
// (document, getComputedStyle, NodeFilter, requestAnimationFrame). Same approach as
// tests/unit/search.test.js. requestAnimationFrame is a no-op so restore/focus paths
// stay synchronous and deterministic.
function createDom() {
  const dom = new JSDOM(`<!DOCTYPE html><body>${DOM_TEMPLATE}</body>`)
  global.document = dom.window.document
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  global.NodeFilter = dom.window.NodeFilter
  global.requestAnimationFrame = () => {}
  // jsdom doesn't implement scrollIntoView (see docs/plans/done/2026-07-20/07-tab-scroll-into-view.md's
  // own test-plan note); renderTabBar() calls it unconditionally after every render.
  if (!dom.window.Element.prototype.scrollIntoView) {
    dom.window.Element.prototype.scrollIntoView = () => {}
  }
  return dom
}

// Collects the refs subset the workspace/editor/search controllers need. In the real app
// this is the single shared `$` object (window.MDVAppShell.collectAppShellRefs); here we
// build just the fields these three controllers touch.
function createRefs(dom) {
  const d = dom.window.document
  const byId = id => d.getElementById(id)
  return {
    content: byId('content'),
    sourceView: byId('source-view'),
    sourceEditor: byId('source-editor'),
    sourceLines: byId('source-lines'),
    scrollArea: byId('scroll-area'),
    tabList: byId('tab-list'),
    tabStrip: byId('tab-strip'),
    tocList: byId('toc-list'),
    btnMode: byId('btn-mode'),
    btnSplit: byId('btn-split'),
  }
}

// Records every call's arguments; forwards to impl (if given) and returns its result.
function createSpy(impl) {
  const calls = []
  const fn = (...args) => {
    calls.push(args)
    return impl ? impl(...args) : undefined
  }
  fn.calls = calls
  fn.reset = () => { calls.length = 0 }
  return fn
}

// Spies for the watcher callbacks the workspace controller receives.
// Real wiring: app.js:149-150 (watchPath/unwatchPath -> documentFlowController).
function createWatchSpies() {
  return {
    watchPath: createSpy(),
    unwatchPath: createSpy(),
  }
}

// A stubbed render() that returns a fixed imagePaths Set (so a test can assert the exact
// Set instance is forwarded) and writes a recognizable marker into refs.content so tests
// can tell a fresh render from a reused stale snapshot. Real render: app.js:195-198.
function createRenderStub(refs, imagePaths = new Set()) {
  const render = createSpy(async text => {
    refs.content.innerHTML = `RENDERED:${text}`
    return imagePaths
  })
  render.imagePaths = imagePaths
  return render
}

// In-memory storage stub for createEditorController, which reads storage.getItem at
// construction time (editor.js:96). Real wiring: app.js:120 (storage: localStorage).
function createStorageStub() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
  }
}

// Backing store for the source/split mode flags. In the real app these live inside
// editorController and workspace reaches them through getSourceMode/setSourceMode/
// getSplitMode/setSplitMode (app.js:155-158). Tests that don't need a real editor use
// this to drive the same wiring directly.
function createModeState() {
  let sourceMode = false
  let splitMode = false
  return {
    getSourceMode: () => sourceMode,
    setSourceMode: value => { sourceMode = Boolean(value) },
    getSplitMode: () => splitMode,
    setSplitMode: value => { splitMode = Boolean(value) },
  }
}

// A no-op markdown controller. The three regressions under test are about controller
// wiring, not markdown rendering, so the real markdown.js (which needs marked/hljs/
// DOMPurify globals) is stubbed out. Real wiring: app.js:25-37 / app.js:145.
function createMarkdownStub(refs) {
  return {
    hydrateFromDom: createSpy(),
    // Mirrors the real captureSnapshotHTML closely enough for wiring tests: it
    // reads the live content node so callers still snapshot whatever render wrote.
    captureSnapshotHTML: createSpy(() => (refs ? refs.content.innerHTML : '')),
    clearImageCache: createSpy(),
    clearImageCacheEntry: createSpy(),
  }
}

module.exports = {
  createDom,
  createRefs,
  createSpy,
  createWatchSpies,
  createRenderStub,
  createStorageStub,
  createModeState,
  createMarkdownStub,
}
