# RENDERER KNOWLEDGE BASE

## OVERVIEW
Renderer now uses an HTML/CSS shell plus multiple plain browser scripts; `app.js` still orchestrates the highest-coupling workspace flows.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Toolbar / buttons | `index.html` top markup + `app.js` globals | Search for `#toolbar`, `.btn`, `#add-menu`, `#toast`, `#welcome-guide` |
| Sidebar / tabs / explorer | `index.html` sidebar + `app.js` workspace flows | Left panel has TOC and explorer modes |
| Markdown rendering | `markdown.js` | Handles syntax highlight, stats, TOC, image path rewriting |
| Tab state | `app.js` | Dirty-state dots, drag-reorder, active-tab flow |
| Source mode | `app.js` | Preview/source dual mode |
| Search | `search.js` | In-document search controller |
| Theme | `theme.js` | Auto/light/dark cycle and hljs stylesheet switching |
| Onboarding / empty state | `onboarding.js` | First-launch guide, entry affordance, explorer header helpers |
| Pure helpers | `path-utils.js` | URL/path helpers usable from tests |

## CONVENTIONS
- Markup/CSS still live in `index.html`, but JS is now being split into plain browser scripts loaded in order.
- DOM refs are centralized into the `$` object near script initialization.
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

## UNIQUE STYLES
- Design language mimics Claude app styling with warm light theme, dark counterpart, glassy toolbar/sidebar, and compact pills.
- Inline event handlers are used in markup (`onclick="..."`) alongside script-defined functions.
- Explorer intentionally filters to markdown files and hides dot-directories.
- Search highlighting, TOC activation, and tab switching are all manual DOM updates, not framework state.
- Explorer root header can switch between basename and full path, close the opened root, and reveal it in Finder.
- Toolbar save state is tied to tab dirty tracking; transient save feedback uses the top-right toast.
- Empty-state UX intentionally promotes the top-right open entry point and mirrors it with direct CTA buttons plus a welcome guide.
- The current refactor boundary keeps `app.js` as the orchestrator while low-risk controllers/helpers move into sibling files.

## NOTES
- `index.html` is the biggest hotspot in the repo (~1600 lines).
- `app.js` remains the main hotspot for future extractions: tabs, save/watch flow, source mode, and keyboard wiring are still there.
- Existing diagnostics include many accessibility warnings on buttons/SVGs and several iterable-callback-return errors.
- If work grows beyond a focused patch, consider splitting renderer logic before adding major new UI features.
- Print mode has custom CSS overrides; pagination fixes live in the `@media print` block.
- Smoke coverage lives in `tests/electron/smoke.test.js`; pure helper coverage currently lives in `tests/unit/*.test.js`.
