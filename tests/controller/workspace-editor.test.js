// Controller-level test: image-watcher wiring between editor and workspace.
//
// Regression (docs/plans/done/2026-07-20/README.md "2026-07-16 재검토 결과" #4, cause 1):
// editor.js#toggleSource()/#toggleSplitView() dropped the imagePaths returned by render()
// and never called workspaceController.syncTabImageWatches(), so images first seen after a
// source->preview switch were left unwatched. The pure helpers all pass while this wiring
// is missing; only driving editor + workspace together catches it.

const test = require('node:test')
const assert = require('node:assert/strict')

const { createWorkspaceController } = require('../../src/renderer/workspace.js')
const { createEditorController } = require('../../src/renderer/editor.js')
const {
  createDom,
  createRefs,
  createSpy,
  createWatchSpies,
  createRenderStub,
  createStorageStub,
  createMarkdownStub,
} = require('./helpers/harness.js')

// Wires a real workspace + editor controller together the way app.js does, then wraps
// workspaceController.syncTabImageWatches with a spy. Because the editor's syncTabImageWatches
// callback (app.js:116) looks the method up on workspaceController at call time, the spy
// captures the editor->workspace boundary call but NOT workspace's own internal closure calls.
function makeHarness() {
  const dom = createDom()
  const refs = createRefs(dom)
  const getRefs = () => refs
  const markdownController = createMarkdownStub(refs)
  const { watchPath, unwatchPath } = createWatchSpies()
  const imagePaths = new Set(['/img/hero.png'])
  const render = createRenderStub(refs, imagePaths)
  const storage = createStorageStub()

  let markdown = ''
  let editorController
  let workspaceController

  workspaceController = createWorkspaceController({
    getRefs,
    markdownController,
    render,
    applySourceMode: () => editorController.applySourceMode(), // app.js:147
    showEmptyState: () => {},
    watchPath, // app.js:149
    unwatchPath, // app.js:150
    updateToolbarActions: () => {},
    updateEntryAffordance: () => {},
    maybeShowWelcomeGuide: () => {},
    showAppContextMenu: () => {},
    getSourceMode: () => editorController.getSourceMode(), // app.js:155
    setSourceMode: value => editorController.setSourceMode(value), // app.js:156
    getSplitMode: () => editorController.getSplitMode(), // app.js:157
    setSplitMode: value => editorController.setSplitMode(value), // app.js:158
    setMarkdown: value => { markdown = value },
    confirmClose: () => true,
    openNewWindow: () => {},
    reportDirtyState: () => {},
    closeSearch: () => {},
  })

  editorController = createEditorController({
    getRefs,
    getMarkdown: () => markdown, // app.js:112
    setMarkdown: value => { markdown = value }, // app.js:113
    getActiveTab: () => workspaceController.getActiveTab(), // app.js:114
    rerenderTabBar: () => workspaceController.renderTabBar(), // app.js:115
    // mirrors app.js:116 exactly, so the test's stub wiring can't drift from production
    syncTabImageWatches: (tab, imgPaths) => { if (workspaceController) workspaceController.syncTabImageWatches(tab, imgPaths) },
    onSourceInput: () => {}, // app.js:117
    render, // app.js:118
    closeSearch: () => {}, // app.js:119 (runtimeController.closeSearch())
    storage, // app.js:120
  })

  // Wrap the real method so we observe the editor->workspace boundary call.
  const realSync = workspaceController.syncTabImageWatches
  const syncSpy = createSpy((tab, paths) => realSync(tab, paths))
  workspaceController.syncTabImageWatches = syncSpy

  return { refs, workspaceController, editorController, render, syncSpy, imagePaths }
}

test('toggleSource (source->preview) forwards render() imagePaths to workspace.syncTabImageWatches', async () => {
  const { refs, workspaceController, editorController, syncSpy, imagePaths } = makeHarness()

  await workspaceController.createTab({ filename: 'a.md', path: '/docs/a.md', content: '# original' })

  // Enter source mode (preview -> source: no render on this leg).
  await editorController.toggleSource()
  assert.equal(editorController.getSourceMode(), true)

  const tab = workspaceController.getActiveTab()
  // Edit the raw text so toggleSource takes the "edited !== markdown" render branch.
  refs.sourceEditor.value = '# edited ![](img.png)'

  syncSpy.reset()
  // Source -> preview: editor.js:245-255 renders and must sync image watches (editor.js:253).
  await editorController.toggleSource()

  assert.equal(syncSpy.calls.length, 1, 'syncTabImageWatches should be called exactly once')
  assert.equal(syncSpy.calls[0][0], tab, 'called with the active tab')
  assert.equal(syncSpy.calls[0][1], imagePaths, 'called with the exact Set render() returned')
})

test('toggleSplitView (source->split) forwards render() imagePaths to workspace.syncTabImageWatches', async () => {
  const { refs, workspaceController, editorController, syncSpy, imagePaths } = makeHarness()

  await workspaceController.createTab({ filename: 'b.md', path: '/docs/b.md', content: '# original' })

  await editorController.toggleSource()
  assert.equal(editorController.getSourceMode(), true)

  const tab = workspaceController.getActiveTab()
  refs.sourceEditor.value = '# edited ![](img.png)'

  syncSpy.reset()
  // Source -> split: editor.js:282-289 renders and must sync image watches (editor.js:289).
  await editorController.toggleSplitView()

  assert.equal(syncSpy.calls.length, 1, 'syncTabImageWatches should be called exactly once')
  assert.equal(syncSpy.calls[0][0], tab, 'called with the active tab')
  assert.equal(syncSpy.calls[0][1], imagePaths, 'called with the exact Set render() returned')
})
