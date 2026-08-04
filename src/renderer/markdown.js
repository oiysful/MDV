(function (globalScope) {
  function computeStats(text) {
    if (!text || !text.trim()) return { words: 0, minutes: 0 }
    const words = text.trim().split(/\s+/).filter(Boolean).length
    const minutes = Math.max(1, Math.round(words / 200))
    return { words, minutes }
  }

  const AUTO_DETECT_LANGUAGES = [
    'javascript', 'typescript', 'python', 'java', 'json', 'bash',
    'xml', 'css', 'sql', 'yaml', 'go', 'rust', 'c', 'cpp',
  ]
  const IMAGE_CACHE_LIMIT = 100

  // Turns heading text into a GitHub-Flavored-Markdown-style anchor slug, so that a
  // `[텍스트](#헤더-슬러그)` link written by hand (the convention this repo's own docs
  // already use — see docs/plans/README.md) actually resolves to a rendered heading.
  // Rules, matching GitHub: lowercase, drop everything that isn't a letter, number,
  // space, `-` or `_` (so punctuation vanishes), collapse whitespace runs to a single
  // `-`, trim leading/trailing `-`. \p{L}/\p{N} keep non-ASCII (Korean) intact rather
  // than stripping it. `seen` is an optional Map<slug, count> for duplicate-heading
  // disambiguation: the 2nd "Notes" becomes `notes-1`, the 3rd `notes-2`, as GitHub
  // does. Callers pass a fresh Map per document; omitting it disables dedup.
  function slugifyHeading(text, seen) {
    const slug = String(text == null ? '' : text)
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!slug || !seen) return slug
    const count = seen.get(slug) || 0
    seen.set(slug, count + 1)
    return count ? `${slug}-${count}` : slug
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => (
      ch === '&' ? '&amp;'
        : ch === '<' ? '&lt;'
          : ch === '>' ? '&gt;'
            : ch === '"' ? '&quot;'
              : '&#39;'
    ))
  }

  function createMarkdownController({ getRefs, markedLib, hljsLib, pathUtils, api, onShowModeButton, domPurify }) {
    let cachedHeadings = []
    let cachedTocLinks = []
    let prevTocLink = null
    let prevTocHref = ''
    const imageDataUrlCache = new Map()
    const purify = domPurify || globalScope.DOMPurify

    // hljs.highlightAuto over every language is slow; restrict auto-detection to
    // a common subset, filtered to the languages this build actually registers.
    const autoSubset = AUTO_DETECT_LANGUAGES.filter(
      lang => typeof hljsLib.getLanguage === 'function' && hljsLib.getLanguage(lang)
    )

    // The rendered HTML comes from untrusted markdown; sanitize before it ever
    // touches innerHTML. Falls back to full escaping if DOMPurify is missing so
    // a misconfigured load degrades to inert text rather than executing scripts.
    function sanitizeHtml(html) {
      if (purify && typeof purify.sanitize === 'function') {
        return purify.sanitize(html)
      }
      return escapeHtml(html)
    }

    function cacheImageDataUrl(key, dataUrl) {
      if (imageDataUrlCache.size >= IMAGE_CACHE_LIMIT && !imageDataUrlCache.has(key)) {
        const oldest = imageDataUrlCache.keys().next().value
        if (oldest !== undefined) imageDataUrlCache.delete(oldest)
      }
      imageDataUrlCache.set(key, dataUrl)
    }

    // The cache is keyed by path only, so a changed image on disk keeps serving its
    // old data URL until this is called. Callers clear it around events that mean
    // "images referenced here may be stale": an external file change, or a fresh save.
    function clearImageCache() {
      imageDataUrlCache.clear()
    }

    function clearImageCacheEntry(localPath) {
      imageDataUrlCache.delete(localPath)
    }

    function renderMarkdown(text) {
      return sanitizeHtml(markedLib.parse(text))
    }

    const renderer = new markedLib.Renderer()
    renderer.code = (code, lang) => {
      const langId = lang ? lang.split(/[\s{]/)[0] : ''
      const hl = (langId && hljsLib.getLanguage(langId))
        ? hljsLib.highlight(code, { language: langId }).value
        : hljsLib.highlightAuto(code, autoSubset.length ? autoSubset : undefined).value
      return `<div class="code-wrapper"><div class="code-meta"><span class="code-lang">${escapeHtml(langId)}</span><button class="copy-btn" type="button" data-command="copyCode" data-command-element="true" title="코드 복사" aria-label="코드 복사">복사</button></div><pre><code class="hljs">${hl}</code></pre></div>`
    }
    markedLib.setOptions({ renderer, breaks: true, gfm: true })

    async function resolveRenderedImagePaths(docPath) {
      const refs = getRefs()
      const images = Array.from(refs.content.querySelectorAll('img[src]'))
      const resolvedPaths = new Set()
      await Promise.all(images.map(async img => {
        const rawSrc = img.getAttribute('src')
        // A leading-slash src yields both an absolute and a document-relative
        // candidate; take whichever actually exists on disk.
        const candidates = pathUtils.resolveLocalImageCandidates(rawSrc, docPath)
        try {
          for (const localPath of candidates) {
            let dataUrl = imageDataUrlCache.get(localPath)
            if (!dataUrl) {
              const res = await api.readImageDataUrl(localPath)
              if (!res.ok || !res.data_url) continue
              dataUrl = res.data_url
              cacheImageDataUrl(localPath, dataUrl)
            }
            img.src = dataUrl
            // Record which local file this base64 came from, independent of the
            // payload itself, so snapshots can strip the base64 and rehydrate later.
            img.dataset.mdvLocalPath = localPath
            resolvedPaths.add(localPath)
            return
          }
        } catch (e) {
          console.error('이미지 오류:', e)
        }
      }))
      return resolvedPaths
    }

    function updateStats(text) {
      const refs = getRefs()
      const { words, minutes } = computeStats(text)
      if (!words) {
        refs.stats.classList.add('empty')
        refs.sWords.textContent = ''
        refs.sTime.textContent = ''
        return
      }
      refs.stats.classList.remove('empty')
      refs.sWords.textContent = `${words.toLocaleString()} 단어`
      refs.sTime.textContent = `약 ${minutes}분`
    }

    function buildToc() {
      const refs = getRefs()
      const headings = document.querySelectorAll('#content h1,#content h2,#content h3')
      const list = refs.tocList
      list.innerHTML = ''
      // Per-document dedup counter; a fresh Map each build so reopening the same
      // document doesn't keep incrementing suffixes across renders.
      const slugCounts = new Map()
      headings.forEach((heading, index) => {
        // A heading made entirely of punctuation slugifies to '', which would leave it
        // unaddressable and break refreshTocActive's `#${id}` href matching — fall back
        // to the old positional id for those.
        const slug = slugifyHeading(heading.textContent, slugCounts) || `h${index}`
        heading.id = slug
        const li = document.createElement('li')
        li.className = heading.tagName.toLowerCase()
        const anchor = document.createElement('a')
        anchor.href = `#${slug}`
        anchor.textContent = heading.textContent
        anchor.onclick = event => {
          event.preventDefault()
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        li.appendChild(anchor)
        list.appendChild(li)
      })
      // top is cached relative to #scroll-area, the container refreshTocActive's
      // scrollTop argument is measured against — not offsetTop's own document.body
      // reference frame. Both are currently unpositioned (static), so this
      // subtraction is a valid coordinate-frame conversion; see plan doc #2.
      cachedHeadings = Array.from(headings).map(heading => ({ el: heading, id: heading.id, top: heading.offsetTop - refs.scrollArea.offsetTop }))
      cachedTocLinks = Array.from(list.querySelectorAll('a')).map(anchor => ({ el: anchor, href: anchor.getAttribute('href') }))
      prevTocLink = null
      prevTocHref = ''
    }

    async function render(text, filename, docPath) {
      const refs = getRefs()
      refs.content.innerHTML = renderMarkdown(text)
      const imagePaths = await resolveRenderedImagePaths(docPath)
      document.title = (filename || 'untitled.md').replace(/\.(md|markdown)$/i, '')
      updateStats(text)
      buildToc()
      if (onShowModeButton) onShowModeButton()
      return imagePaths
    }

    // Snapshot for tab.renderedHTML. Cloning + attribute removal (rather than a
    // regex over the string) means a `data:` URI that happens to appear as text
    // inside a code block is never mistaken for an <img src> and mangled. Local
    // images keep their data-mdv-local-path so rehydration can refill src from the
    // shared imageDataUrlCache instead of baking the base64 into every tab's copy.
    function captureSnapshotHTML() {
      const refs = getRefs()
      const clone = refs.content.cloneNode(true)
      clone.querySelectorAll('img[data-mdv-local-path]').forEach(img => {
        img.removeAttribute('src')
      })
      return clone.innerHTML
    }

    // Bumped on every hydrate/rehydrate. A cache-miss fallback below is async, so
    // if the user switches tabs again before it resolves this version no longer
    // matches and the stale fetch becomes a no-op — mirrors workspace.js's
    // restoreRenderVersion guard, kept here since this controller owns the DOM write.
    let rehydrateVersion = 0

    // After a stripped snapshot is inserted, refill each local image's src. Warm
    // cache hits are synchronous (no broken-image frame); LRU-evicted paths fall
    // back to the same async IPC path resolveRenderedImagePaths uses.
    function rehydrateSnapshotImages() {
      const refs = getRefs()
      const version = ++rehydrateVersion
      const pending = Array.from(refs.content.querySelectorAll('img[data-mdv-local-path]:not([src])'))
      pending.forEach(img => {
        const localPath = img.dataset.mdvLocalPath
        if (!localPath) return
        const cached = imageDataUrlCache.get(localPath)
        if (cached) {
          img.src = cached
          return
        }
        void (async () => {
          try {
            const res = await api.readImageDataUrl(localPath)
            if (!res.ok || !res.data_url) return
            // Warm the shared cache regardless of whether this tab is still active,
            // so the next hydrate of any tab embedding this path hits synchronously.
            cacheImageDataUrl(localPath, res.data_url)
            // Guard the DOM write: a newer hydrate (tab switch) bumps the version,
            // and the previewDirty/split re-render replaces innerHTML on the same
            // tab without bumping it, which detaches this node — contains() catches
            // that. Either way we must not write into the wrong/stale DOM.
            if (version !== rehydrateVersion) return
            if (!refs.content.contains(img)) return
            img.src = res.data_url
          } catch (e) {
            console.error('이미지 오류:', e)
          }
        })()
      })
    }

    function hydrateFromDom(contentNode, tocNode, text) {
      const refs = getRefs()
      refs.content.innerHTML = contentNode || ''
      refs.tocList.innerHTML = tocNode || ''
      rehydrateSnapshotImages()
      updateStats(text)
      cachedHeadings = Array.from(refs.content.querySelectorAll('h1,h2,h3')).map(heading => ({ el: heading, id: heading.id, top: heading.offsetTop - refs.scrollArea.offsetTop }))
      cachedTocLinks = Array.from(refs.tocList.querySelectorAll('a')).map(anchor => ({ el: anchor, href: anchor.getAttribute('href') }))
      prevTocLink = null
      prevTocHref = ''
    }

    function resetEmptyStats() {
      const refs = getRefs()
      refs.stats.classList.add('empty')
      refs.sWords.textContent = ''
      refs.sTime.textContent = ''
      refs.tocList.innerHTML = ''
      cachedHeadings = []
      cachedTocLinks = []
      prevTocLink = null
      prevTocHref = ''
    }

    function refreshTocActive(scrollTop) {
      if (!cachedHeadings.length) return
      let lo = 0
      let hi = cachedHeadings.length - 1
      let current = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (cachedHeadings[mid].top - 24 <= scrollTop) {
          current = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      const newHref = current >= 0 ? `#${cachedHeadings[current].id}` : ''
      if (newHref !== prevTocHref) {
        if (prevTocLink) prevTocLink.classList.remove('active')
        const link = cachedTocLinks.find(item => item.href === newHref)
        if (link) link.el.classList.add('active')
        prevTocLink = link ? link.el : null
        prevTocHref = newHref
      }
    }

    function refreshHeadingOffsets() {
      const refs = getRefs()
      cachedHeadings.forEach(heading => {
        heading.top = heading.el.offsetTop - refs.scrollArea.offsetTop
      })
    }

    return {
      render,
      renderMarkdown,
      hydrateFromDom,
      captureSnapshotHTML,
      rehydrateSnapshotImages,
      resetEmptyStats,
      refreshTocActive,
      refreshHeadingOffsets,
      clearImageCache,
      clearImageCacheEntry,
    }
  }

  const api = { createMarkdownController, computeStats, slugifyHeading }
  globalScope.MDVMarkdown = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
