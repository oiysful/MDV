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

  // `%` that is not part of a valid %XX escape would make decodeURIComponent throw,
  // which silently dropped image filenames like `50%.png`.
  function escapeBarePercent(value) {
    return value.replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
  }

  function toFsPath(relative, baseDir) {
    const guarded = escapeBarePercent(relative).replace(/[#?]/g, encodeURIComponent)
    return decodeURIComponent(new URL(guarded, pathToFileUrl(baseDir)).pathname)
  }

  // A leading `/` is ambiguous in a local markdown file: it may be a real absolute
  // filesystem path (`/Users/me/pic.png`) or a document-root-relative one (`/img.png`)
  // that only makes sense relative to the document. Both readings are legitimate, and
  // no pure function can tell them apart — so return the candidates in priority order
  // and let the caller probe the filesystem.
  function resolveLocalImageCandidates(src, docPath) {
    if (!src || isExternalUrl(src) || src.startsWith('#') || !docPath) return []
    try {
      const baseDir = docPath.replace(/[^/]+$/, '')
      if (src.startsWith('/')) {
        const literal = decodeURIComponent(pathToFileUrl(escapeBarePercent(src)).slice('file://'.length))
        const docRelative = toFsPath(src.replace(/^\/+/, ''), baseDir)
        return literal === docRelative ? [literal] : [literal, docRelative]
      }
      return [toFsPath(src, baseDir)]
    } catch {
      return []
    }
  }

  // Resolve a clicked link's href to a single absolute filesystem path so the main
  // process can just stat/read it. Unlike images (resolveLocalImageCandidates), a
  // link has one intended target, so a leading `/` is read as a genuine absolute
  // path — no document-root-relative fallback. Returns null for anything that is not
  // a resolvable local path: external URLs, in-page anchors, or a relative link in an
  // unsaved (path-less) document, which the caller surfaces as a clear message.
  function resolveLocalPath(target, docPath) {
    if (!target || isExternalUrl(target) || target.startsWith('#')) return null
    try {
      if (target.startsWith('/')) {
        return decodeURIComponent(pathToFileUrl(escapeBarePercent(target)).slice('file://'.length))
      }
      if (!docPath) return null
      const baseDir = docPath.replace(/[^/]+$/, '')
      return toFsPath(target, baseDir)
    } catch {
      return null
    }
  }


  const api = {
    isExternalUrl,
    resolveLocalImageCandidates,
    resolveLocalPath,
    pathToFileUrl,
  }

  globalScope.MDVPathUtils = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
