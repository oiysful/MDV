(function (globalScope) {
  function isExternalUrl(value) {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith('//')
  }

  function resolveLocalImagePath(src, docPath) {
    if (!src || isExternalUrl(src) || src.startsWith('#')) return null
    try {
      if (src.startsWith('/')) return src
      if (!docPath) return null
      const baseDir = docPath.replace(/[^/]+$/, '')
      return decodeURIComponent(new URL(src, `file://${baseDir}`).pathname)
    } catch {
      return null
    }
  }

  const api = {
    isExternalUrl,
    resolveLocalImagePath,
  }

  globalScope.MDVPathUtils = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
