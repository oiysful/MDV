# Security Audit Report

Date: 2026-10-12 (plan 28 step 6, pre-release audit for v1.4.0)
Score: 91/100
Project: Electron (main + preload + renderer), Node.js, GitHub Actions, Homebrew cask distribution
Previous: 96/100 (2026-09-17, re-audit) · 87/100 (2026-09-17) · 94/100 (2026-08-10) · 96/100 (2026-08-06)
Baseline commit: `907e9e6` (last full audit) → `77c681c` (develop today)

> The 2026-09-17 report is in git history (`git show 907e9e6:security-report.md`). Nothing in
> this one is carried over from it, or from `memory-security.md`, without being re-checked:
> every row in *What's Secure* below comes from a command run today.

---

## Scope

MDV is an offline-first desktop markdown viewer with no server, no database, no accounts and no
sessions. Its real attack surface is unchanged: **it renders untrusted `.md` files and resolves
the file paths they name.** What changed since the last audit:

| Area | Change since `907e9e6` |
|---|---|
| Runtime | Electron 42 → **44.7.0**; js-yaml 4 → 5, KaTeX 0.16 → 0.18.9, hljs 11.12, mermaid 11.17 |
| Main process | Dialog start-folder memory (`save-file-dialog`/`export-pdf` take a second `docPath` arg); watcher `error` listeners; poll backend for configured roots (`watch-options.js`) |
| Renderer | Frontmatter card with render budget (2026-10-02 finding, fixed); print vertical table; ⌘U reading position; theme value validation |
| CI | New `ci-electron.yml`, new **`claude-review.yml`** (AI review bot holding `CLAUDE_CODE_OAUTH_TOKEN`) |
| Supply chain | `min-release-age` **7 → 3** (deliberate, 2026-10-12, PR #42) |

Category 22 (AI/LLM) now applies for the first time, because of the review bot. Eight categories
remain N/A (Auth, JWT, Database, Docker, Protocols, DNS/Email, Mobile, Serverless).

---

## Critical Issues

None.

## High Issues

None.

## Medium Issues

### M1 — third-party GitHub Actions are pinned to movable tags in jobs that hold write tokens

| Workflow | Action | What the job holds |
|---|---|---|
| `release.yml:34` | `softprops/action-gh-release@v3` | `contents: write` token; the built `dist/MDV-*.zip` and `dist/SHA256SUMS` on disk; **the next step receives `HOMEBREW_TAP_TOKEN`** |
| `claude-review.yml:45` | `anthropics/claude-code-action@v1` | `CLAUDE_CODE_OAUTH_TOKEN`; `pull-requests: write`, `issues: write` |

**Why it matters.** A tag such as `@v3` is a pointer that the action's owner, or anyone who takes
over their account, can move to new code at any time. Every later run then executes that code
without any change in this repo. This exact attack happened in March 2025, when the
`tj-actions/changed-files` tags were repointed to a commit that dumped CI secrets.

The release job is the serious case. It runs the action in the same job and on the same runner
*before* the Homebrew step. A malicious version would not need to steal anything. It could
rewrite `dist/MDV-*.zip` and `dist/SHA256SUMS` together, and the next step would publish the
matching hash to the tap that `brew upgrade` installs from. It could also edit
`scripts/update-homebrew-tap.sh` on disk before that step reads it, which would expose
`HOMEBREW_TAP_TOKEN`. The cask's `sha256` is the only download-integrity control the app has
(it is unsigned), and in this scenario it would vouch for the tampered file.

The review bot's exposure is narrower. The OAuth token grants inference only, the job runs only
for same-repo PRs, and its GitHub token cannot push.

**Status: fixed in PR `ci/pin-actions-to-sha` (Ian approved 2026-10-12).** Every `uses:` in all four workflows is now a
commit SHA with its version as a comment: `softprops/action-gh-release` v3.0.3 (the commit `v3` pointed to that day),
`anthropics/claude-code-action` v1.0.247 (newest past the 3-day cooldown; `v1` was already at v1.0.248), `actions/checkout`
v7.0.1, `actions/setup-node` v7.1.0. `release.yml` only runs on a tag, so its pin is first exercised by the v1.4.0 release.

**Fix as originally proposed.** Pin both to a full commit SHA and keep the tag
as a comment, e.g. `softprops/action-gh-release@<40-hex-sha> # v3.x.y`. Resolve the SHA from the
tag on the day it is pinned, and record which version that is. GitHub's own `actions/checkout`
and `actions/setup-node` carry much less risk and can stay on tags, or be pinned in the same
change for consistency. Pinning does not affect plan 28 step 7a: the OIDC check compares the
workflow file with its copy on the default branch, not the action ref.

## Low Issues

None.

---

## Info / Accepted

### The cooldown is 3 days now, and Electron 44.7.0 entered under it

Deliberate change, recorded in `memory-security.md` (2026-10-12) with its reasoning. To grade
today's own work by the standard the 2026-09-17 audit applied to the font: Electron 44.7.0 was
published 2026-10-07 19:26 UTC. It would not have cleared the old 7-day window until 2026-10-15,
so the shipped runtime is in the tree only because of this change. The window it did clear was
3 days. Its lockfile entry resolves to `registry.npmjs.org/electron/-/electron-44.7.0.tgz` with
an `integrity` hash. The packaged app was built and driven end to end (PR #44). Nothing found;
recorded because the trade-off is real.

### Remaining `npm audit` output: 10 nodes, 2 advisories, neither reachable

`npm audit` reports `low: 2, moderate: 8`. That count is per package node. Per advisory there
are two:

- **sprintf-js — GHSA-hp3w-g68c-fv3c (medium, DoS via unbounded precision specifiers).** It
  sits at the end of `electron-builder › app-builder-lib › @electron/get › global-agent › roarr`,
  and every one of the 8 moderate nodes is a link in that chain. It is **build-only**, and
  nothing attacker-controlled reaches a format string there. npm's only fix is `--force` to
  electron-builder 26.5.0, a downgrade. Not taken.
- **KaTeX ≥0.11 <0.18.2 — GHSA-238p-pmpm-9mq7 (low).** The title is *"Existing prototype
  pollution can bypass trust restrictions"*. MDV's own KaTeX is 0.18.9 and not affected. The
  vulnerable 0.16.47 is the copy bundled inside `mermaid.min.js`. Verified in that bundle:
  mermaid calls `renderToString(…, {throwOnError, displayMode, output})` and **never sets
  `trust`**, so there is no trust restriction to bypass. The advisory also requires prototype
  pollution that already exists. `memory-security.md` had listed this one as *moderate*, which is
  corrected there. Revisit with mermaid 12.

The CI gate blocks high and critical only. It passes.

### The AI review bot reads attacker-influenced text

PR diffs are input to a model that can post comments. This is contained in four ways: the job's
`if` admits only PRs whose head repo is this repo, so fork PRs never run it; `allowedTools` is
`Read`/`Grep`/`Glob`, three `gh pr` subcommands and inline comments; the `GITHUB_TOKEN` cannot
push (`contents: read`); and the prompt interpolates only `github.repository` and the PR number,
never the title, body or branch name. A prompt injection would at worst get a misleading comment
posted. M1 is the realistic path to the token.

### Carried from 2026-09-17, unchanged

- `'unsafe-inline'` in `style-src` (style only; `script-src` is a bare `'self'`).
- Unsigned and un-notarized app; download integrity rests on the cask `sha256` (see M1).
- Bundled font binaries rest on one HTTPS fetch from fonts.gstatic.com.
- npm 11 warns that `electron-winstaller`'s install script is not covered by `allowScripts`.
  It is a Windows-target dependency of electron-builder, and the only build here is macOS.

---

## What's Secure

Every row was checked today against `77c681c`.

| Area | Evidence (command or file read today) |
|---|---|
| **Electron isolation** | `main.js:212-214`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| **Renderer containment** | `setWindowOpenHandler` (`:224`) hands only `^https?://` to the OS browser; `will-navigate` (`:233`) blocks leaving the shell; `open-external-url` (`:535`) applies the same scheme check |
| **CSP** | `index.html:7`: `default-src`/`script-src`/`font-src` bare `'self'`, `img-src 'self' data:`, `form-action`/`base-uri`/`object-src 'none'`; **0** `https?://` references in `index.html` |
| **New IPC arguments** | `docPath` is used only as a native dialog's `defaultPath` and accepted only if `path.isAbsolute`; the suggested name goes through `path.basename` and `.`/`..` are rejected. The user still picks the real path, and `preload.js` gained no new channel |
| **Watcher robustness** | Both chokidar watchers now have an `error` listener. Before, an unhandled `error` event on the main process could throw. Errors drop just that watch and the app keeps running |
| **XSS** | New frontmatter HTML: every key/value goes through `escapeHtml`, and the card goes through `sanitizeHtml` (DOMPurify) before insertion; the renderer diff adds no `innerHTML`/`eval`/`new Function` |
| **Injection** | No `eval`, `new Function` or `child_process` in `src/`; `shell.openPath` only on realpath-checked targets (`:621`) |
| **Renderer DoS** | Frontmatter render budget (nodes 5000, text 100k, depth 100, cycle cut), from the 2026-10-02 fix |
| **Dependencies** | `npm audit`: **0 critical, 0 high**; 2 advisories remain, both explained above. Electron 44.7.0 from the npm registry with integrity. Electron 42 EOL (2026-10-20) is no longer relevant |
| **Cooldown** | `.npmrc` `min-release-age=3`, and `npm config get` returns `3` in the repo |
| **Secrets** | `git log 907e9e6..HEAD -p` has no secret-shaped additions and no `.env`/`.pem`/`.key` files. The two Actions secrets are referenced only via `secrets.*` |
| **CI tokens** | `ci.yml`/`ci-electron.yml` `contents: read`; `release.yml` `contents: write`; `claude-review.yml` scoped per job; no `pull_request_target` or `workflow_run` anywhere |

---

## Score Board

```
╔════════════════════════════════════════════════════════╗
║          SECURITY SCORE : 91/100  🟢                    ║
╠════════════════════════════════════════════════════════╣
║  🟢 Secrets & Files            100/100   (8%)   =      ║
║  🟢 Network & Egress           100/100   (5%)   =      ║
║  🟢 HTTP Headers / CSP          90/100   (5%)   =      ║
║  🟢 Cryptography / Signing      90/100   (6%)   =      ║
║  🟡 Deployment & CI             80/100   (5%)  -20     ║
║  🟢 Advanced Attacks           100/100   (7%)   =      ║
║  🟢 Injections                 100/100   (6%)   =      ║
║  🟢 Race Conditions             95/100   (4%)   =      ║
║  🟢 File Handling              100/100   (3%)   =      ║
║  🟢 Supply Chain                95/100   (5%)   =      ║
║  🟢 Compliance / Privacy       100/100   (4%)   =      ║
║  🟡 Monitoring                  80/100   (3%)   =      ║
║  🟢 Source Code Analysis       100/100   (7%)   =      ║
║  🟢 Resource Limits            100/100   (3%)   =      ║
║  🟢 AI/LLM (CI review bot)     100/100   (3%)  new     ║
║  🟢 Browser APIs               100/100   (2%)   =      ║
║  🟠 Advanced Security (L3)      60/100   (2%)   =      ║
╠════════════════════════════════════════════════════════╣
║  N/A: Auth · JWT · Database · Docker · Protocols ·     ║
║       DNS/Email · Mobile · Serverless                  ║
╚════════════════════════════════════════════════════════╝
  📈 96/100 (2026-09-17, 25 days ago) → 91/100
  🔴 0 critical · 🟠 0 high · 🟡 1 medium · 🔵 0 low
```

**Arithmetic.** The 2026-09-17 method starts from 96, where the 4 missing points are structural
(L3 signing, Monitoring, `'unsafe-inline'`, font provenance), and subtracts each finding's
penalty. M1 is one medium, −5 → **91**. Info items cost nothing. The two npm advisories are
counted per advisory, not per node, and neither is reachable.

**Why M1 is new rather than a regression:** `softprops/action-gh-release@v3` has been in
`release.yml` since 2026-07-30, and no earlier audit looked at action pinning. The review bot
added the second instance on 2026-10-07.

---

## Next Steps

1. **Before releasing v1.4.0: pin `softprops/action-gh-release` to a commit SHA** (M1). The
   release is the run where it matters, and the change is one line. Doing
   `anthropics/claude-code-action` in the same PR is natural, since plan 28 step 7a already
   edits `claude-review.yml` right before the release.
2. Afterwards, as before: code signing and notarization if distribution widens; Trusted Types
   together with dropping `'unsafe-inline'`; rebuild the font subsets from the JetBrains upstream
   release.
3. Revisit the nested KaTeX with mermaid 12, and the sprintf-js chain when electron-builder
   moves off `global-agent`.
