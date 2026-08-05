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

  // btoa/atob are Latin1-only; TextEncoder/TextDecoder round-trip through them safely so
  // Korean (or any non-Latin1) mermaid label survives storage in an HTML attribute.
  function utf8ToBase64(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)))
  }

  function base64ToUtf8(b64) {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)))
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

  // Only the document's very first line may open a frontmatter block. marked's hr and
  // setext-heading tokenizers interact such that a bare `---` elsewhere in the body is
  // ambiguous -- it renders as <hr> or gets swallowed into a heading underline depending on
  // what precedes it. Requiring line 0 keeps this detector from ever mistaking a normal
  // mid-document <hr> for frontmatter. No closing `---` means it isn't frontmatter either;
  // the text is left untouched and falls through to marked's existing (if surprising) hr
  // and heading handling, matching current behavior for anyone not using frontmatter.
  function extractFrontmatter(text) {
    const lines = text.split('\n')
    if (lines[0]?.trim() !== '---') return { frontmatter: null, body: text }
    let closingIndex = -1
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { closingIndex = i; break }
    }
    if (closingIndex === -1) return { frontmatter: null, body: text }
    const fields = []
    for (let i = 1; i < closingIndex; i++) {
      const match = lines[i].match(/^([^:\s][^:]*):\s?(.*)$/)
      if (match) fields.push({ key: match[1].trim(), value: match[2].trim() })
    }
    const body = lines.slice(closingIndex + 1).join('\n')
    return { frontmatter: fields, body }
  }

  function renderFrontmatterCard(fields) {
    if (!fields.length) return ''
    const rows = fields.map(({ key, value }) => (
      `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`
    )).join('')
    return `<details class="frontmatter-card"><summary>메타데이터</summary><table class="frontmatter-table"><tbody>${rows}</tbody></table></details>`
  }

  function createMarkdownController({ getRefs, markedLib, hljsLib, pathUtils, api, onShowModeButton, domPurify, mermaidLib }) {
    let cachedHeadings = []
    let cachedTocLinks = []
    let prevTocLink = null
    let prevTocHref = ''
    const imageDataUrlCache = new Map()
    const purify = domPurify || globalScope.DOMPurify
    const getMermaidLib = () => mermaidLib || globalScope.mermaid

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
      // mermaid owns this block entirely -- no hljs highlighting, no copy button/gutter
      // chrome. The source goes into the element's text (what mermaid.run() reads on first
      // render) escaped as normal HTML, and separately into data-mermaid-src base64-encoded
      // (preserved across a theme-triggered re-render, since mermaid replaces the element's
      // content with an <svg>). Base64, not escapeHtml, for the attribute: DOMPurify's mXSS
      // defenses strip an attribute outright if its value contains an encoded `>` -- which an
      // escaped mermaid arrow (`A-->B`) does on essentially every real diagram. Base64's
      // alphabet never touches an HTML metacharacter, so it can't trip that heuristic.
      if (langId === 'mermaid') {
        const escaped = escapeHtml(code)
        const encoded = utf8ToBase64(code)
        return `<pre class="mermaid" data-mermaid-src="${encoded}">${escaped}</pre>`
      }
      const hl = (langId && hljsLib.getLanguage(langId))
        ? hljsLib.highlight(code, { language: langId }).value
        : hljsLib.highlightAuto(code, autoSubset.length ? autoSubset : undefined).value
      // No language means no reserved header row: the lang label is only emitted
      // when there is text to show, so an empty pill never occupies layout space.
      const langRow = langId ? `<div class="code-lang-row"><span class="code-lang">${escapeHtml(langId)}</span></div>` : ''
      const copyIcon = '<svg class="icon-copy" aria-hidden="true" width="12" height="12" viewBox="0 0 13 13" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 10.5V2.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      return `<div class="code-wrapper">${langRow}<pre><code class="hljs">${hl}</code></pre><button class="copy-btn" type="button" data-command="copyCode" data-command-element="true" aria-label="코드 복사">${copyIcon}</button></div>`
    }
    markedLib.setOptions({ renderer, breaks: true, gfm: true })

    // No-op in any environment without a global mermaid (e.g. the jsdom unit-test suite),
    // so tests never need to stub it just to exercise render().
    async function runMermaidBlocks(container) {
      const lib = getMermaidLib()
      if (!lib) return
      const nodes = Array.from(container.querySelectorAll('.mermaid:not([data-processed])'))
      if (!nodes.length) return
      try {
        await lib.run({ nodes })
      } catch {
        // mermaid.run() already renders a per-node error SVG for a syntax error in the
        // diagram itself; this only guards against a harder failure (e.g. a bug in mermaid)
        // taking the whole render down with it.
      }
    }

    // Theme toggle re-render: mermaid bakes its color choices into the SVG at draw time, so
    // switching theme requires drawing again, not a CSS swap. The element's original source
    // survives in data-mermaid-src (its text content was replaced by the first render's SVG),
    // so this resets each node back to source and re-runs it through mermaid.run().
    async function rerenderMermaidTheme(container) {
      if (!container) return
      const nodes = Array.from(container.querySelectorAll('.mermaid[data-mermaid-src]'))
      nodes.forEach(node => {
        node.removeAttribute('data-processed')
        node.textContent = base64ToUtf8(node.dataset.mermaidSrc)
      })
      await runMermaidBlocks(container)
    }

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
      const { frontmatter, body } = extractFrontmatter(text)
      const frontmatterHtml = frontmatter ? sanitizeHtml(renderFrontmatterCard(frontmatter)) : ''
      refs.content.innerHTML = frontmatterHtml + renderMarkdown(body)
      await runMermaidBlocks(refs.content)
      const imagePaths = await resolveRenderedImagePaths(docPath)
      document.title = (filename || 'untitled.md').replace(/\.(md|markdown)$/i, '')
      updateStats(body)
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
      runMermaidBlocks,
      rerenderMermaidTheme,
    }
  }

  const api = { createMarkdownController, computeStats, slugifyHeading, extractFrontmatter }
  globalScope.MDVMarkdown = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
