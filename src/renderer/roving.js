(function (globalScope) {
  // Pure index math shared by the tab bar (role="tablist") and explorer tree
  // (role="tree") roving-tabindex keyboard navigation. Given the currently
  // focused index and a step (+1 / -1), returns the next index. Boundaries
  // clamp by default (ARIA APG default, less surprising); pass wrap:true to
  // cycle. Out-of-range / empty inputs collapse to a safe 0.
  function getRovingIndex(currentIndex, step, length, { wrap = false } = {}) {
    if (!Number.isFinite(length) || length <= 0) return 0
    const current = Number.isFinite(currentIndex) ? currentIndex : 0
    const next = current + step
    if (wrap) return ((next % length) + length) % length
    return Math.max(0, Math.min(length - 1, next))
  }

  const api = { getRovingIndex }
  globalScope.MDVRoving = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
