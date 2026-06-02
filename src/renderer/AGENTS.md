# RENDERER KNOWLEDGE BASE

## OVERVIEW
Renderer now uses an HTML/CSS shell plus multiple plain browser scripts; `app.js` is the bootstrap layer and the main workspace flows now live in focused sibling controllers.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Toolbar / buttons | `index.html` top markup + `app-shell.js` command binding + `app-runtime.js` behavior | Search for `#toolbar`, `.btn`, `#add-menu`, `#toast`, `#welcome-guide` |
| Sidebar / tabs / explorer | `index.html` sidebar + `app-shell.js` command binding + `app-runtime.js` / `explorer.js` behavior | Left panel has TOC and explorer modes |
| Markdown rendering | `markdown.js` | Handles syntax highlight, stats, TOC, image path rewriting |
| Tab state | `workspace.js` | Dirty-state dots, drag-reorder, active-tab flow |
| Source mode | `editor.js` | Preview/source dual mode |
| Search | `search.js` | In-document search controller |
| Theme | `theme.js` | Auto/light/dark cycle and hljs stylesheet switching |
| Onboarding / empty state | `onboarding.js`, `app-runtime.js` | First-launch guide, entry affordance, toast, empty-state actions |
| Pure helpers | `path-utils.js` | URL/path helpers usable from tests |

## CONVENTIONS
- Markup/CSS still live in `index.html`, but JS is now being split into plain browser scripts loaded in order.
- DOM refs are centralized into the `$` object near script initialization.
- Static and generated controls use `data-command` attributes; `app-shell.js` binds static shell controls and delegates dynamic content commands.
- Renderer talks to the main process exclusively through `window.api`.
- Markdown preview is rendered with `marked`; code blocks are highlighted with `highlight.js`.
- Local images in markdown are rewritten to data URLs before render.
- Global custom context menu UI is renderer-managed via `#app-context-menu` rather than native menus.
- First-launch onboarding state is renderer-managed and persisted in localStorage.

## ANTI-PATTERNS
- Do not add direct filesystem assumptions; use `window.api.readFile`, `listDirectory`, `saveFile`, etc.
- Do not change tab state shape casually; many helpers depend on cached fields like `scrollTop`, `sourceScrollTop`, and `tocHTML`.
- Do not tweak rendered HTML fragments without checking empty-state duplication (`#empty` markup and `EMPTY_HTML`).
- Do not loosen CSP or add new external assets without updating the meta CSP allowlist.
- Do not add shell/Finder/browser actions directly in the renderer; route through preload/main bridges.
- Do not reintroduce inline `onclick`/drag-drop attributes or `Object.assign(window, ...)` command aliases.

## UNIQUE STYLES
- Design language mimics Claude app styling with warm light theme, dark counterpart, glassy toolbar/sidebar, and compact pills.
- Inline event handlers have been removed from command surfaces; markup now uses `data-command` attributes.
- Explorer intentionally filters to markdown files and hides dot-directories.
- Search highlighting, TOC activation, and tab switching are all manual DOM updates, not framework state.
- Explorer root header can switch between basename and full path, close the opened root, and reveal it in Finder.
- Toolbar save state is tied to tab dirty tracking; transient save feedback uses the top-right toast.
- Empty-state UX intentionally promotes the top-right open entry point and mirrors it with direct CTA buttons plus a welcome guide.
- The current refactor boundary keeps `app.js` as bootstrap/orchestration only while command/runtime behavior lives in sibling controller files.

## NOTES
- `index.html` remains the biggest renderer shell hotspot.
- The renderer global/window surface reduction is complete; future structural work is documented in `.sisyphus/plans/structural-improvement-roadmap.md`.
- Recent command-surface changes have clean error-level diagnostics; remaining diagnostics are mostly style/accessibility warnings.
- If work grows beyond a focused patch, consider splitting renderer logic before adding major new UI features.
- Print mode has custom CSS overrides; pagination fixes live in the `@media print` block.
- Smoke coverage lives in `tests/electron/smoke.test.js`; pure helper coverage currently lives in `tests/unit/*.test.js`.
