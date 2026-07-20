(function (globalScope) {
  // Turns the live tab list + active tab + explorer root into the minimal, disk-safe
  // session shape: absolute file paths only (renderedHTML/scroll/etc. are re-derived on
  // restore), the active tab's index within the *path-bearing* tabs, and the explorer root.
  // Unsaved (path-less) tabs are dropped — there's nothing to reopen them from.
  function buildSessionState(tabs, activeTabId, explorerRoot) {
    const pathTabs = (tabs || []).filter(tab => tab && tab.path)
    const paths = pathTabs.map(tab => tab.path)
    let activeIndex = pathTabs.findIndex(tab => tab.id === activeTabId)
    if (activeIndex < 0) activeIndex = paths.length ? 0 : -1
    return { tabs: paths, activeIndex, explorerRoot: explorerRoot || null }
  }

  // The critical safety invariant: a session with no tabs AND no explorer root must never
  // be written to disk, or a blank Cmd+N window closing would silently wipe the real saved
  // session. Guarded at every write point in the main process.
  function isEmptySession(session) {
    if (!session) return true
    const hasTabs = Array.isArray(session.tabs) && session.tabs.length > 0
    const hasRoot = Boolean(session.explorerRoot)
    return !hasTabs && !hasRoot
  }

  const api = { buildSessionState, isEmptySession }
  globalScope.MDVSessionState = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
