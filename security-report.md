# Security Audit Report

Date: 2026-09-17
Score: 87/100
Project: Electron (main + preload + renderer), Node.js, GitHub Actions, Homebrew cask distribution
Previous: 94/100 (2026-08-10), 96/100 (2026-08-06)

> The score went **down** because this audit found two things earlier audits never looked
> at, not because the code got worse. Both prior audits scored almost entirely on dependency
> advisories; neither examined the remote font dependency or the image handler's symlink
> behaviour. Dependencies are currently at **0 advisories**, better than at either previous audit.

---

## Scope

MDV is an offline-first desktop markdown viewer. It has no server, no database, no user
accounts, no sessions, no cookies, and exactly **one** outbound network call it makes on its
own (`src/main.js:126`, the GitHub Releases check). Most of the 25 categories therefore do
not apply and are marked N/A rather than scored as passes — the score is computed over the
16 applicable categories only (75% of the standard weighting), then normalised.

The app's real attack surface is narrow and specific: **it renders untrusted `.md` files and
resolves file paths they name.** Every finding below lives there or in the supply chain.

---

## Critical Issues (fix immediately)

None.

---

## High Issues

None.

---

## Medium Issues

### M1 — `read-image-data-url` checks the extension by name only, so a symlink escapes it

**File:** `src/main.js:687` · **CWE-59 (Link Following), CWE-22** · Category 11/14/21

The handler resolves the extension with `path.extname(filePath)` and rejects anything not in
`IMAGE_MIME_TYPES`. That check sees the **link's own name**, never where it points, and
`fs.promises.readFile` follows symlinks.

```
attacker ships:  notes.md  +  photo.png → ~/.ssh/id_rsa   (symlink)
notes.md says:   ![](./photo.png)
result:          .png passes the allowlist, the private key is read and
                 returned as data:image/png;base64,<key>, landing in the DOM
```

Path containment does not help: `pathUtils.resolveLocalImageCandidates` deliberately tries an
absolute candidate for a leading-slash `src`, so the read is not confined to the document's
folder.

**Why this stands out rather than being theoretical:** this repository already identified and
fixed exactly this bypass class elsewhere. `main.js:538 isOpenableTarget()` checks the link
name **and** its `realpath`, and `AGENTS.md` records the reasoning — *"a name-only check is
bypassed by `notes.pdf → setup.command`"* and *"a `.md`-named symlink must resolve to a real
`.md`/`.markdown` target too"*. The image handler is the one reader that never got that
treatment.

**Honest impact assessment:** this is not currently a data leak. The CSP (`img-src 'self'
data:`, no remote origins anywhere, `connect-src` inheriting `default-src 'self'`) leaves the
renderer no way to send the bytes anywhere. The content reaches the DOM and stops there. So
the practical severity is bounded — but it is bounded by **one** control, where the rest of
this codebase deliberately keeps two.

**Fix** — mirror the existing pattern:

```js
const realPath = await fs.promises.realpath(filePath)
const named = path.extname(filePath).slice(1).toLowerCase()
const real  = path.extname(realPath).slice(1).toLowerCase()
if (!IMAGE_MIME_TYPES[named] || !IMAGE_MIME_TYPES[real]) {
  return { ok: false, error: `Unsupported image type: .${named || '(none)'}` }
}
```

A `realpath` failure (broken or looping symlink) should be treated as a rejection, the way
`open-local-path` already does. Add a regression test with a symlink fixture.

---

### M2 — The app fetches its font from Google on every launch

**File:** `src/renderer/index.html:30-32` · Category 02/16/18

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Three consequences, none of them dramatic, all of them avoidable:

1. **Privacy.** A local document viewer contacts a third party every time it opens, exposing
   the user's IP address and usage timing. Nothing about reading a local `.md` file requires
   that. For EU users this is a GDPR-relevant transfer with no notice and no opt-out (German
   courts have treated exactly this pattern as a violation). The app otherwise collects
   nothing.
2. **It forces the CSP to be looser than it needs to be.** `style-src` has to name a remote
   origin, and carries `'unsafe-inline'` alongside it. Without the remote font, `style-src`
   could tighten toward `'self'`.
3. **Offline and supply chain.** An offline launch silently falls back; and a stylesheet
   fetched at runtime from a third party is an unpinned dependency (no SRI is possible on a
   Google Fonts CSS URL, since it serves varying content).

**Fix:** bundle the font. JetBrains Mono is OFL-licensed, so the `.woff2` files can ship in
the app (`electron-builder` already packages `src/`), the two `preconnect` hints and the
stylesheet `<link>` drop out, and `style-src`/`font-src` lose their remote origins. This is a
visual-surface change in that it touches how the font loads, so per the skill's
"Ask Before Modifying UI/Design" rule it needs approval before being applied — the rendered
result should be identical, since the same font is used either way.

---

## Low Issues

### L1 — `memory-security.md` credits this repo with an `.npmrc` it does not have

**Files:** `memory-security.md` (three separate claims) · Category 16

The security memory states *"this repo's own `.npmrc` sets `min-release-age=7`"* and builds a
standing policy on it (*"do not bypass it with `--force` or by lowering `min-release-age`"*).

Verified: **there is no `.npmrc` in this repository, and there never has been** (`git log --
.npmrc` is empty). The setting lives in `~/.npmrc` — the maintainer's user-level npm config.

Practical impact is small, because the cooldown matters at `npm install` / `npm audit fix`
time, which happens on the maintainer's machine where the setting is active; CI only runs
`npm ci` from the committed lockfile, which installs pinned versions and never consults it.
But the memory presents a machine-local preference as a repository control, so a second
contributor, a fresh clone, or a future CI change would silently have no cooldown while the
audit trail claims otherwise.

**Fix:** either commit an `.npmrc` with `min-release-age=7` so the control is real and
portable, or correct the three claims in `memory-security.md` to say it is user-level. The
first is one line and makes the documentation true.

### L2 — `ci.yml` declares no `permissions:` block

**File:** `.github/workflows/ci.yml` · Category 08

`release.yml` correctly scopes itself (`permissions: contents: write`). `ci.yml` declares
nothing, so its `GITHUB_TOKEN` inherits the repository/organisation default, which can be
read-write. A test workflow needs only `contents: read`.

**Fix:** add `permissions:\n  contents: read` at the top of `ci.yml`. No behaviour change —
the workflow only checks out and runs tests.

---

## Info / Accepted

### The app is unsigned and un-notarized

Known, documented in `RELEASING.md`, and the reason the in-app update checker is notify-only
(Squirrel.Mac cannot apply an update to an unsigned app). Users see a Gatekeeper warning on
first launch.

Not scored as a finding, because download integrity is covered in practice: the Homebrew cask
pins a `sha256` for each release artifact, so a tampered download fails installation. What is
genuinely absent is revocation and publisher identity — acceptable for a personal tool,
worth revisiting if distribution ever widens.

### CI's audit allowlist was suppressing two packages that are still in the tree

`ci.yml`'s allowlist named `brace-expansion` and `fast-uri`. This report first described them
as stale leftovers of packages no longer present — **that was wrong, and it was wrong because
it was copied from `memory-security.md`'s 2026-09-15 note instead of being checked.** Both
packages are very much in the dependency tree (`npm ls` finds them), so the entries were live
suppressions: a future high or critical in either would not have failed the gate.

Nothing was actually hidden, because the full tree is at 0 high/critical. The entries were
removed rather than left, since a suppression that suppresses nothing only costs coverage —
verified first by running the gate's own script with an empty allowlist against a fresh
`npm audit --json` (0 blocking). A name should go back only together with a
`memory-security.md#accepted_risks` entry saying why that specific advisory cannot be fixed.

---

## What's Secure

| Area | Evidence |
|---|---|
| **Electron isolation** | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (`main.js:207-210`) — the full modern trio, not just the first |
| **Renderer containment** | `will-navigate` blocks navigation away from the local shell; `setWindowOpenHandler` denies every window and hands only `^https?://` to the OS browser. Both guard the fact that the renderer holds `window.api` |
| **XSS** | All markdown output passes through DOMPurify; mermaid source is base64'd into `data-*` to survive sanitisation; TOC entries are built with `createElement` + `textContent`, so the stored `tocHTML` re-parses inertly |
| **Injection** | No `eval`, no `new Function`, no `child_process` anywhere in `src/`. Search queries are escaped before `new RegExp` (`search.js:2-3`), so no ReDoS from user input |
| **Local file opening** | `open-local-path` checks the link name **and** its realpath against `OPENABLE_EXTENSIONS`; directories (incl. `.app` bundles) and non-allowlisted targets get `showItemInFolder` only. `.svg` deliberately excluded |
| **Dependencies** | `npm audit`: **0 vulnerabilities**, full tree. Lockfile committed. CI fails the build on new high/critical outside an explicit allowlist |
| **Secrets** | None in source or history. `.gitignore` covers `.env*`, `*.key`, `*.pem`, `secrets/`. The one `TAP_TOKEN=` is an env reference, and the single `ghp_` history hit is a detection pattern inside the security skill's own docs |
| **Resource limits** | Update check: 10s timeout, 1MB body cap, 24h throttle. Directory watch: depth 1, ignore list, and a 20,000-path circuit breaker that closes the watcher and warns rather than stalling the main process |
| **IPC surface** | Every channel reviewed. The newest, `fullscreen-changed`, is main→renderer, one boolean, `Boolean()`-coerced, with no `send`/`invoke`/`ipcMain` counterpart — nothing new is callable *from* the renderer |
| **Storage** | `localStorage` used in 3 places for UI preferences only. Session state deliberately goes to `userData/session.json` via the main process, not `localStorage`, because every window shares one origin |
| **CI** | No `${{ }}` interpolation inside any `run:` block — the classic Actions script-injection vector is absent |

---

## Score Board

```
╔════════════════════════════════════════════════════════╗
║          SECURITY SCORE : 87/100  🟡                    ║
╠════════════════════════════════════════════════════════╣
║  🟢 Secrets & Files            100/100   (8%)          ║
║  🟡 Network & Egress            80/100   (5%)          ║
║  🟡 HTTP Headers / CSP          80/100   (5%)          ║
║  🟢 Cryptography / Signing      90/100   (6%)          ║
║  🟢 Deployment & CI             85/100   (5%)          ║
║  🟡 Advanced Attacks            80/100   (7%)          ║
║  🟢 Injections                 100/100   (6%)          ║
║  🟢 Race Conditions             95/100   (4%)          ║
║  🟡 File Handling               75/100   (3%)          ║
║  🟢 Supply Chain                85/100   (5%)          ║
║  🟢 Compliance / Privacy        85/100   (4%)          ║
║  🟡 Monitoring                  80/100   (3%)          ║
║  🟢 Source Code Analysis        85/100   (7%)          ║
║  🟢 Resource Limits            100/100   (3%)          ║
║  🟢 Browser APIs               100/100   (2%)          ║
║  🟠 Advanced Security (L3)      60/100   (2%)          ║
╠════════════════════════════════════════════════════════╣
║  N/A: Auth · JWT · Database · Docker · Protocols ·     ║
║       DNS/Email · Mobile · Serverless · AI/LLM ·       ║
║       Bot/DDoS (no server, no accounts, no data store) ║
╚════════════════════════════════════════════════════════╝
  📈 Last score: 94/100 (2026-08-10, dependency-weighted)
  🎯 Target: 100/100
  🔴 0 critical · 🟠 0 high · 🟡 2 medium · 🔵 2 low
```

Weighted over the 16 applicable categories (75% of the standard weighting), normalised to 100.
Cross-checked against the flat penalty model: 2 medium (−5) + 2 low (−2) = 86, consistent.

---

## Next Steps

In the order they are worth doing:

1. **M1 — the image handler realpath check.** Smallest diff, closes a known bypass class the
   rest of the codebase already defends against, and removes the reliance on CSP being the
   only thing standing between an untrusted document and an arbitrary file read.
2. **M2 — bundle JetBrains Mono.** Ends the third-party call on every launch, and lets the CSP
   tighten afterwards. Needs approval first: it touches how the UI loads its font.
3. **L1 — commit an `.npmrc`.** One line, and it turns a documented control into a real one.
4. **L2 — `permissions: contents: read` in `ci.yml`.** One line, no behaviour change.
5. Drop the two stale allowlist entries in `ci.yml` while touching it.

Reaching 100/100 would additionally need the L3 items — code signing and notarization (which
would also unblock a real auto-updater) and Trusted Types. Both are larger decisions than
this audit should make on its own.
