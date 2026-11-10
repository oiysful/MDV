# Security Audit Report

Date: 2026-11-10 (full audit before the 1.5.0 release, plan 34)
Score: 96/100
Project: Electron (main + preload + renderer), Node.js, GitHub Actions, Homebrew cask distribution
Previous: 92/100 (2026-10-13) · 91/100 (2026-10-12) · 96/100 (2026-09-17, re-audit) · 87/100 (2026-09-17) · 94/100 (2026-08-10) · 96/100 (2026-08-06)
Baseline: `8d0093b` (last full audit) → `fa8f94d` (develop today), plus open PR #63 (Electron 44.10.2)

> Nothing here is carried over from the 2026-10-13 report (`git show 6b6b8e7:security-report.md`) or
> from `memory-security.md` without being re-checked. Every row in *What's Secure* comes from a command
> run today. One row of the previous report was wrong; see "Correction" below.

---

## Scope

MDV is an offline-first desktop markdown viewer with no server, no database, no accounts and no
sessions. Its attack surface is still this: **it renders untrusted `.md` files and resolves the file
paths they name.** Changes since `8d0093b`:

| Area | Change since `8d0093b` |
|---|---|
| Main process, preload | **None** (`git diff 8d0093b HEAD -- src/main.js src/preload.js` is empty) |
| Renderer, security | L1 fix: content commands need a per-window trust token (PR #53). Author HTML loses `style`/`class`, except an image's size (#53, #55). The 10-13 report reviewed both as fixes, not as an audit; this audit re-tests them |
| Renderer, parser | **marked 9.1.6 → 18.2.0** (PR #60). The HTML escaping moved from marked's tokenizers into its renderers (v15). MDV's `renderer.code`/`renderer.blockquote` were ported to token objects. The tilde override now owns `~~` |
| Renderer, diagrams | **mermaid 11.17.2 → 12.3.0** (PR #61, ELK layout, bundled DOMPurify 3.4.17, KaTeX 0.18.11). New `data-mdv-rendered` drawn mark, which only tests read |
| Renderer, other | TOC highlight re-derivation (#56), split-view reading position (#57), comment-only fix (#62) |
| Packaging | L2 fix: `build.electronFuses` turns three fuses off and re-signs ad hoc (PR #54). **No release has shipped it yet**; v1.4.0 users still run the old fuses |
| Dependencies | DOMPurify ^3.4.17, Electron 44.9.3, undici, fast-uri (PR #59). marked 18.2.0 was installed ahead of the 3-day cooldown on Ian's instruction. Electron 44.10.2 is in PR #63, green and not yet merged |
| CI | Node 22 → 26 in all three build workflows (PR #58). `claude-review.yml` unchanged |

Category 22 (AI/LLM) applies because of the review bot. Eight categories remain N/A: Auth, JWT,
Database, Docker, Protocols, DNS/Email, Mobile and Serverless.

The skill's two "AI blind spot" checks were looked at on purpose:
- **Rate limiting:** there is still no public endpoint. The only network call is the outbound update
  check (10 s timeout, 1 MB cap, once per 24 h; `main.js:101`, `:149`, unchanged).
- **Session fixation:** there are no sessions, logins or privilege levels.

---

## Critical Issues

None.

## High Issues

None.

## Medium Issues

None.

## Low Issues

None. Both 2026-10-13 lows are closed in the code. They were re-tested today rather than taken from the
fix notes:
- **L1** (forged copy button, author styling): see the "XSS" and "Content commands" rows below.
- **L2** (default fuses): the config is in `package.json` and pinned by `tests/unit/packaging.test.js`.
  **It reaches users only with the next release.** RELEASING.md step 7 reads the fuses on the released
  app, because the release build is the first place CI runs the flip and the re-sign.

---

## Info / Accepted

### R1 — one very large lazy blockquote stalls the renderer (accepted 2026-11-10)

This is a parser-time availability issue in stock marked 18. It is not code execution.
- Input: `'> a\nb\n'` repeated, one blockquote held together by lazy continuation lines.
- Cost grows quadratically: `marked.lexer` took 47/177/1082/4575 ms at ×8000/16000/32000/64000.
- Today it took **14.4 s at 750 KB**.
- MDV has no document size cap, so a crafted file this large freezes the window for that long.

**Why accepted, not scored.** It replaces a worse one. marked 9.1.6, shipped in every MDV release so
far, has unmatched emphasis (#4099), which needed 30.7 s for 64 KB of `'**a '`. That is fixed upstream
in 18.1.3 and measured at milliseconds.
- R1 needs about 10× the input for the same stall.
- Closing the window ends the stall.
- Earlier audits recorded #4099 as Info for the same reasons.

Ian accepted R1, together with two rendering differences, when he approved PR #60. Plan 24's
part B (a parse-time cap, for example parsing in a Worker) is the fix if a real document ever hits it.
It is now an entry under `accepted_risks` in `memory-security.md`.

### The cooldown guards version choice, not lockfile installs

`.npmrc` `min-release-age=3` applies when npm *chooses* a version (`npm install`, `update`,
`audit fix`). Measured today: `npm ci` with the committed `.npmrc` installed marked 18.2.0, published
11-09T23:05Z, without complaint. So a too-new version that reaches `package-lock.json` is installed by
CI and the release build with no further check.

That happened once, on purpose. Ian chose to take marked 18.2.0 early. It is recorded in
`memory-security.md` with a re-check after 2026-11-12 23:05Z: still published, and the same integrity.

*Optional hardening:* a CI step that fails when any locked version is younger than 3 days. The bypass
would then have to be visible in the PR, not only in the commit message.

### npm now holds back install scripts

During today's Electron bump, npm reported `install-scripts` for approval and did not run Electron's
`postinstall`, so the binary was not downloaded. Running `node node_modules/electron/install.js`
restored it. CI downloads it in its own step (`ci-electron.yml:68+`).

This narrows the supply-chain surface, which is good. It is noted here so a missing binary is not
mistaken for corruption.

### Build-only advisory: minimatch GHSA-g3hv-75wg-m249 (moderate)

The advisory was published 2026-10-30. It reaches the tree through `electron-builder › app-builder-lib
› @electron/universal`: one root, 6 moderate entries. `npm audit --omit=dev` reports **0**. Nothing
ships in the app. The CI gate ignores moderates.

### mermaid 12 output does not pass through MDV's DOMPurify, by design

`mermaid.run()` writes its SVG straight into the node. This was re-tested today in a hidden Electron 44
window with 12.3.0, `securityLevel: 'strict'`, and six hostile labels:
- HTML with `onerror` and `onmouseover` in flowchart, sequence, class and mindmap labels;
- `click A "javascript:…"`;
- `click A call alert(1)`.

Result: **no `on*` attributes, no `javascript:` URL, no script ran** (a `mouseover` was dispatched on
every node). An `<img>` tag survives in a flowchart or mindmap label, but stripped of handlers. The
CSP's `img-src 'self' data:` keeps it from fetching anything remote. mermaid 11 behaved the same way.

The bundle's own DOMPurify is now 3.4.17 and its KaTeX 0.18.11, so the two notes that "ride with
mermaid 12" are closed. The bundled ELK, elkjs 0.12.1 (`EPL-2.0 OR GPL-3.0-or-later`), is a production
dependency, and its `LICENSE.md` ships inside the app.

### Correction: the 10-13 report's Trojan Source row was wrong

It said "no zero-width characters in 111 tracked code and config files". Today's scan, with U+200B in
its character set, finds **one**: `src/renderer/search.js:62`, `marker.textContent = '​'`.
- It has been there since `172825c` (2026-08-05).
- It is a deliberate measuring marker in a string literal, not a hidden control. It changes no code path.

*Optional:* write it as `'​'` so a reader can see it.

### Carried, re-checked today

- `MDV_*` environment variables are read by the shipped app (`MDV_USER_DATA_DIR`, `MDV_LOCALE`,
  `MDV_REPO_OWNER`/`MDV_REPO_NAME`, `MDV_TEST_*`). Setting them already needs code execution as the
  user. `main.js` is unchanged, so this is unchanged.
- `'unsafe-inline'` remains in `style-src`. `script-src` is a bare `'self'`.
- The app is unsigned and not notarized. Integrity rests on the cask `sha256`, and the chain still
  matches for v1.4.0.
- The bundled font binaries rest on one HTTPS fetch.
- The AI review bot reads attacker-influenced text. Its containment is unchanged: the workflow
  diff since `8d0093b` is empty.
  - Same-repo, non-draft PRs only.
  - Read-only tools plus `gh pr` subcommands.
  - `contents: read`, `id-token: write` for the App token.

---

## What's Secure

Every row was checked today against `fa8f94d` (develop), the open PR #63, or the shipped v1.4.0.

| Area | Evidence (command or file read today) |
|---|---|
| **Electron isolation** | `main.js:228-230`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| **Renderer containment** | `setWindowOpenHandler` (`:242`) passes only `^https?://` to the OS browser and always denies; `will-navigate` (`:251`); `open-external-url` (`:555`) applies the same scheme check |
| **CSP** | `index.html:7`: `default-src`/`script-src`/`font-src` bare `'self'`, `img-src 'self' data:`, `form-action`/`base-uri`/`object-src 'none'`; **0** `https?://` in `index.html`; marked now loads from `node_modules/marked/lib/marked.umd.js`, same origin. mermaid 12 with ELK renders under this CSP (CI mermaid tests pass), so no `unsafe-eval` was needed |
| **IPC surface** | 21 `ipcMain` handlers; every one has a preload counterpart, and preload's extra names are main→renderer event channels; `main.js`/`preload.js` unchanged since `8d0093b` |
| **XSS (marked 18 path)** | `renderMarkdown` = `markedLib.parse` → `sanitizeHtml` (DOMPurify, `markdown.js:487-495`); frontmatter card sanitized separately (`:945`). 17 hostile inputs went through the real `markdown.js` + marked 18.2.0 + DOMPurify 3.4.17 in jsdom: fence info string, fence body, mermaid body, raw `<script>`, SVG `onbegin`, `javascript:` link (plain and entity-encoded), image `onerror`, `javascript:` autolink, HTML in an alert, pseudo-tag with `onclick`, double-encoded entities, table cell, heading HTML, tilde runs, clipping wrapper. **0** `on*` attributes, **0** `javascript:` URLs, **0** script/iframe/object/embed, **0** author `style`/`class` left |
| **Content commands (L1)** | Token is 32 hex (128-bit) per window. Three forged elements carrying wrong `data-mdv-trust` values (`00`, `deadbeef`, 32 zeros) all lost `style`/`class` and `isTrustedContentCommand` rejected all three |
| **innerHTML sinks** | 22 assignments in renderer modules: constants and icons, fixed translated strings, `renderMarkdown` output, the sanitized frontmatter card, and tab snapshots read back from already-sanitized DOM (`hydrateFromDom`). Heading labels from `extractHeadingsFromSource` go to `textContent` (`:899`) |
| **mermaid output** | `MERMAID_BASE_CONFIG` `securityLevel: 'strict'` (`:757`); hostile-label probe above: no handlers, no `javascript:`, no execution on 12.3.0 |
| **Injection** | No `eval`, `new Function`, `child_process` or `spawn` in `src/`; `RegExp` built only from marked's numeric heading depth and from `escapeRegExp(query)` in search |
| **Local paths** | `open-local-path` checks the extension of the link name and of its `realpath` before `shell.openPath(realPath)`; `read-image-data-url` checks the extension, then reads through `realpath` |
| **Renderer DoS** | Frontmatter render budget tests pass (unit 303/303); #4099 fixed (`'*xa '`×8000 4.2 s → 25 ms on MDV's path); R1 accepted (above) |
| **Trojan Source** | 101 tracked code/config files scanned for bidi controls (U+202A-202E, U+2066-2069), zero-width (U+200B-200F, U+2060, U+FEFF) and soft hyphen; a planted U+202E was reported, so the scanner works; one hit, explained above |
| **Dependencies** | `npm audit`: 0 critical, 0 high, 6 moderate (one build-only root); `--omit=dev`: 0. 447 lockfile entries, all `https://registry.npmjs.org/` with `integrity` |
| **Cooldown** | `npm config get min-release-age` = 3; the one bypass is recorded (above) |
| **Secrets** | `git log 8d0093b..HEAD -p` adds nothing secret-shaped; no `.env`/`.pem`/`.key`/`.p12`/`id_rsa` tracked; Actions secrets referenced only through `secrets.*` |
| **CI tokens and pinning** | Every `uses:` is a 40-hex commit SHA; `ci.yml`/`ci-electron.yml` `contents: read`, `release.yml` `contents: write`, review job scoped per job; no `pull_request_target`/`workflow_run`; 12 `run:` blocks parsed with js-yaml, **0** contain `${{ }}`. The Node 26 change is the `node-version` value plus a comment |
| **Release chain** | v1.4.0: asset digest `00889bfc…b223` = tap cask `sha256`; cask version `1.4.0` |
| **Fuses (L2) config** | `package.json` `electronFuses`: `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` `false`, `resetAdHocDarwinSignature: true` |
| **Electron** | develop 44.9.3, no npm advisory. PR #63 → 44.10.2: CI `test` + `test-electron` 132/132 and the review bot pass. 44.10.x carries upstream Chromium/V8/Skia backports and asar-handling fixes |
| **Tests** | `npm run test:unit` 303/303, `npm run test:controller` 13/13 today; develop CI Electron 132/132 after the #61/#62 merges |

---

## Score Board

```
╔════════════════════════════════════════════════════════╗
║          SECURITY SCORE : 96/100  🟢                    ║
╠════════════════════════════════════════════════════════╣
║  🟢 Secrets & Files            100/100   (8%)   =      ║
║  🟢 Network & Egress           100/100   (5%)   =      ║
║  🟢 HTTP Headers / CSP          90/100   (5%)   =      ║
║  🟢 Cryptography / Signing      90/100   (6%)   =      ║
║  🟢 Deployment & CI            100/100   (5%)   =      ║
║  🟢 Advanced Attacks           100/100   (7%)   =      ║
║  🟢 Injections                 100/100   (6%)   =      ║
║  🟢 Race Conditions             95/100   (4%)   =      ║
║  🟢 File Handling              100/100   (3%)   =      ║
║  🟢 Supply Chain                95/100   (5%)   =      ║
║  🟢 Compliance / Privacy       100/100   (4%)   =      ║
║  🟡 Monitoring                  80/100   (3%)   =      ║
║  🟢 Source Code Analysis       100/100   (7%)  +5      ║
║  🟢 Resource Limits            100/100   (3%)   =      ║
║  🟢 AI/LLM (CI review bot)     100/100   (3%)   =      ║
║  🟢 Browser APIs               100/100   (2%)   =      ║
║  🟠 Advanced Security (L3)      60/100   (2%)  +5      ║
╠════════════════════════════════════════════════════════╣
║  N/A: Auth · JWT · Database · Docker · Protocols ·     ║
║       DNS/Email · Mobile · Serverless                  ║
╚════════════════════════════════════════════════════════╝
  📈 92/100 (2026-10-13, 28 days ago) → 96/100
  🔴 0 critical · 🟠 0 high · 🟡 0 medium · 🔵 0 low
```

**Arithmetic.** The method starts from 96. The four missing points are structural: L3 signing,
Monitoring, `'unsafe-inline'` and font provenance. Each finding's penalty is then subtracted.
- L1 and L2 are closed in the code, so their −2 each are gone.
- No new finding scored.

96 − 0 = **96**. Info items cost nothing.

**This score is develop's.** The shipped v1.4.0 still has L2's fuses, marked 9.1.6 with #4099, and
mermaid 11's DOMPurify 3.4.12. The next release delivers all three fixes.

---

## Next Steps

1. **Before the 1.5.0 release:**
   - Merge PR #63 (Electron 44.10.2).
   - After 2026-11-12 23:05Z, confirm `marked@18.2.0` is still published with the lockfile's
     integrity.
2. **After the release:** read the fuses on the brew-installed app and launch it (RELEASING step 7).
   The release build is the first CI run of the fuse flip and the ad-hoc re-sign.
3. **Optional, cheap:**
   - A CI check that every locked version is at least 3 days old.
   - `'​'` in `search.js:62`.
4. **Later, as before:**
   - Code signing and notarization, if distribution widens.
   - Trusted Types, together with dropping `'unsafe-inline'`.
   - Rebuilding the font subsets from upstream.
   - Plan 24 B (a parse-time cap) if R1 shows up in real documents.
