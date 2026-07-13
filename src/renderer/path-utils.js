(function (globalScope) {
  function isExternalUrl(value) {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith('//')
  }

  // Equivalent to Node's url.pathToFileURL for an absolute POSIX path: encode
  // each segment so spaces and reserved chars (#, ?, %, ...) survive the round
  // trip through the URL parser instead of being read as authority/query/fragment.
  function pathToFileUrl(absolutePath) {
    return `file://${absolutePath.split('/').map(encodeURIComponent).join('/')}`
  }

  function resolveLocalImagePath(src, docPath) {
    if (!src || isExternalUrl(src) || src.startsWith('#')) return null
    try {
      if (!docPath) return null
      const baseDir = docPath.replace(/[^/]+$/, '')
      // A leading `/` in a markdown image is document-root relative, which has no
      // meaning on the local filesystem — resolve it against the document dir
      // rather than the OS root. Guard `#`/`?` so they stay part of the path.
      const relative = src.replace(/^\/+/, '').replace(/[#?]/g, encodeURIComponent)
      return decodeURIComponent(new URL(relative, pathToFileUrl(baseDir)).pathname)
    } catch {
      return null
    }
  }

  const api = {
    isExternalUrl,
    resolveLocalImagePath,
    pathToFileUrl,
  }

  globalScope.MDVPathUtils = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
