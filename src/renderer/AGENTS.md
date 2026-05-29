# RENDERER KNOWLEDGE BASE

## OVERVIEW
Single-file renderer app: markup, design tokens, UI layout, and client-side behavior all live in `index.html`.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Toolbar / buttons | top HTML + toolbar CSS | Search for `#toolbar`, `.btn`, `#add-menu`, `#toast` |
| Sidebar / tabs / explorer | `#sidebar` section + `switchTab`, `renderTabBar`, `loadDir` | Left panel has TOC and explorer modes |
| Markdown rendering | `marked.Renderer`, `render(...)` | Handles syntax highlight + image path rewriting |
| Tab state | `tabs`, `activeTabId`, save/restore helpers | Dirty-state dots and drag-reorder live here |
| Source mode | `toggleSource`, `applySourceMode`, editor DOM refs | Preview/source dual mode |
| Search | `toggleSearch`, `runSearch`, `highlightCurrent` | Search state is DOM-driven |
| Theme | CSS custom properties + `applyTheme`, `toggleTheme` | Auto/light/dark cycle stored in `localStorage` |

## CONVENTIONS
- This file is intentionally monolithic; HTML, CSS, and JS are interleaved.
- DOM refs are centralized into the `$` object near script initialization.
- Renderer talks to the main process exclusively through `window.api`.
- Markdown preview is rendered with `marked`; code blocks are highlighted with `highlight.js`.
- Local images in markdown are rewritten to data URLs before render.
- Global custom context menu UI is renderer-managed via `#app-context-menu` rather than native menus.

## ANTI-PATTERNS
- Do not add direct filesystem assumptions; use `window.api.readFile`, `listDirectory`, `saveFile`, etc.
- Do not change tab state shape casually; many helpers depend on cached fields like `scrollTop`, `sourceScrollTop`, and `tocHTML`.
- Do not tweak rendered HTML fragments without checking empty-state duplication (`#empty` markup and `EMPTY_HTML`).
- Do not loosen CSP or add new external assets without updating the meta CSP allowlist.
- Do not add shell/Finder/browser actions directly in the renderer; route through preload/main bridges.

## UNIQUE STYLES
- Design language mimics Claude app styling with warm light theme, dark counterpart, glassy toolbar/sidebar, and compact pills.
- Inline event handlers are used in markup (`onclick="..."`) alongside script-defined functions.
- Explorer intentionally filters to markdown files and hides dot-directories.
- Search highlighting, TOC activation, and tab switching are all manual DOM updates, not framework state.
- Explorer root header can switch between basename and full path, close the opened root, and reveal it in Finder.
- Toolbar save state is tied to tab dirty tracking; transient save feedback uses the top-right toast.

## NOTES
- `index.html` is the biggest hotspot in the repo (~1600 lines).
- Existing diagnostics include many accessibility warnings on buttons/SVGs and several iterable-callback-return errors.
- If work grows beyond a focused patch, consider splitting renderer logic before adding major new UI features.
- Print mode has custom CSS overrides; pagination fixes live in the `@media print` block.
