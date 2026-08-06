# 🔐 Security Audit Report

**Date:** 2026-08-06 (updated same day — see correction note and Resolved section below)
**Score:** 96/100 🟢
**Project:** MDV (v1.1.0) — Claude-style Markdown Editor
**Stacks:** Electron 42 (desktop app, no backend server), Node.js/JavaScript, GitHub Actions CI/CD, electron-builder, Homebrew tap distribution
**Audited by:** security-skill v1.0.0

---

## 📊 Score Breakdown

Only categories applicable to a local, single-user Electron desktop app (no server, no network API, no auth/DB/JWT/Docker/GraphQL/websocket/file-upload-over-network/mobile/AI features) are scored. Non-applicable categories are excluded and their weight redistributed.

| Category | Score | Issues |
|---|---|---|
| 01. Secrets & Files | 100/100 | none |
| 08. Deployment & Cloud | 85/100 | 1 low |
| 11. Advanced Attacks (XSS/SSRF/SSTI/proto-pollution) | 100/100 | none |
| 12. Injections (path traversal) | 100/100 | none |
| 16. Supply Chain | 85/100 | 2 low (accepted risk) |
| 21. Source Code Analysis (dangerous functions, taint) | 100/100 | none |
| 24. Browser/Electron APIs | 100/100 | none |
| 25. Advanced Security (L3 hardening) | 95/100 | 1 info |

**Not applicable / excluded from scoring:** Network & CORS, HTTP Headers (covered instead under CSP in §24), Auth & Sessions, Cryptography, JWT, Database Security, Docker, Protocols, Race Conditions, File Upload, DNS & Email, Mobile, Compliance/GDPR, Monitoring, Serverless, AI/LLM Security, Bot & DDoS — MDV is a local desktop app with no network-facing surface, no login, no persisted user data beyond a local `session.json`.

---

## ✅ What's Secure

This codebase shows deliberate, well-documented security engineering (comments throughout `src/main.js`, `path-utils.js`, `markdown.js` explain the exact threat each guard defeats):

- **Electron hardening (`src/main.js:71-76`):** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `preload.js` exposes a minimal, explicit `contextBridge` API surface — no raw `ipcRenderer`/Node access reaches the renderer.
- **Navigation lockdown (`src/main.js:85-96`):** `setWindowOpenHandler` and `will-navigate` both reject anything but the local shell, so no remote page can ever inherit the `window.api` bridge.
- **Strict CSP (`index.html:6-7`):** `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` — blocks inline/remote script execution outright.
- **XSS defense-in-depth (`markdown.js`):** all rendered markdown HTML is piped through DOMPurify before `innerHTML`, with an `escapeHtml` fallback if DOMPurify fails to load. Mermaid diagram source is base64-encoded into `data-mermaid-src` specifically to avoid an mXSS gap where DOMPurify would otherwise strip an attribute containing an encoded `>`. Mermaid itself runs with `securityLevel: 'strict'`.
- **Path-traversal / arbitrary-file-read guards (`main.js:337-429`):**
  - `open-external-url` allowlists `^https?://` only.
  - `open-local-path` resolves symlinks via `realpath` and checks the extension of *both* the link name and its real target before handing anything to `shell.openPath`, specifically to stop a `notes.pdf`-named symlink pointing at an executable, or a `.md`-named symlink pointing at `~/.ssh/id_rsa`.
  - `OPENABLE_EXTENSIONS` deliberately excludes `.svg` (can carry `<script>`) and any script-like extension (`.command`, etc.) that would hand active content to the OS default handler.
  - `read-image-data-url` allowlists known image MIME types only, closing a documented prior arbitrary-file-read via `![](../../.ssh/id_rsa)`.
- **No dangerous code-execution patterns:** no `eval`, `new Function`, string-form `setTimeout`/`setInterval`, `child_process.exec`/`spawn`, or dynamic `require` found anywhere in `src/`.
- **No Trojan Source characters** (Unicode bidi overrides) in any source file.
- **Supply chain (production runtime deps):** `npm audit --omit=dev` reports 0 vulnerabilities across `dompurify`, `marked`, `mermaid`, `chokidar`, `@highlightjs/cdn-assets` and their subtrees. See **Medium/Low #1–4** below for issues found in `devDependencies` (electron itself, and the electron-builder/jsdom build-and-test toolchain) once those are included. CI (`ci.yml`) and release (`release.yml`) both use `npm ci` against the committed lockfile; workflows use `pull_request` (not `pull_request_target`) so PR code never runs with repo secrets.
- **Release integrity:** `scripts/common.sh` pins `curl --proto '=https'` and verifies a SHA256 checksum against a `SHA256SUMS` asset before installing any downloaded release artifact — a corrupted or tampered download is rejected rather than silently installed.
- **Secrets hygiene:** `.gitignore` excludes `.env*`, `*.key`, `*.pem`, `secrets/`; no hardcoded credentials, tokens, or API keys found in source. `HOMEBREW_TAP_TOKEN` is consumed only from the CI secret store, never logged.
- **Install scripts (`scripts/*.sh`):** `set -euo pipefail`, no unquoted variable expansion into a shell context, no interpolation of untrusted input into commands — no command-injection path found.

---

## ⚠️ Correction (2026-08-06, same day)

The original version of this report scoped its `npm audit` check to `--omit=dev` (production runtime deps only) and stated the project's supply chain was clean without calling out that devDependencies weren't included. Running `npm install`/plain `npm audit` — as `scripts/install-local.sh` does — audits the full 445-package tree (electron itself + the electron-builder/jsdom/playwright toolchain) and surfaces **4 known advisories (1 moderate, 3 high)**. None of them are false positives; they're real, currently-unpatched versions in `package-lock.json`. Findings and real-world exploitability for MDV are below; the Supply Chain category score and overall score have been revised down accordingly (97 → 96).

## ✅ Resolved (2026-08-06, user ran `npm audit fix`)

### Electron 42.3.0 — protocol response cache reused across sessions (CWE-668, was moderate) — FIXED
**Advisory:** [GHSA-r4w5-6pfg-jxp5](https://github.com/advisories/GHSA-r4w5-6pfg-jxp5) — affected Electron 42.0.0-alpha.1 – 42.5.0.
**Status:** `npm audit fix` bumped `electron` 42.3.0 → **42.8.0** (within the existing `^42.3.0` range, no `--force`). Confirmed via `npm ls electron` and a clean re-run of `npm audit` (this advisory no longer appears). `npm run test:unit` (147/147) and `npm run test:controller` (8/8) both pass against the new electron version — no regression. The electron/e2e smoke suite (`test:electron`) has not been re-run yet since it requires quitting the currently-running MDV.app first; run it once before the next release build.

### undici (both instances, was high) — FIXED
**Advisory:** multiple GHSAs (response desync, cache poisoning, CRLF injection).
**Status:** `npm audit fix` bumped `undici` 6.27.0→6.28.0 (under `node-gyp`) and 7.28.0→7.29.0 (under `@electron/get` and `jsdom`). Confirmed gone from `npm audit` output.

---

## 🔵 Low / Info (still open — accepted risk)

### 1. brace-expansion & fast-uri — unpatched in electron-builder's own dependency tree (High severity per advisory; Low real-world risk here)
**Files:** `node_modules/@electron/asar`, `@electron/universal`, `dir-compare`, `filelist` → `minimatch` → `brace-expansion` (currently 1.1.17 / 2.1.3 / 5.0.8); `node_modules/ajv` → `fast-uri` (currently 3.1.4).
**Advisories:** [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) (brace-expansion, DoS) and [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) (fast-uri, host confusion via backslash authority).
**Confirmed still unresolved after `npm audit fix`, and after `npm audit fix --force --dry-run`** — the force run produced byte-identical output to the normal run, meaning npm found *no* resolvable install path, forced or not. Root cause: patched releases exist upstream (`brace-expansion@5.0.9`, `fast-uri@4.x` per `npm view`), but they're nested two levels deep inside `electron-builder`'s own dependencies (`minimatch`, `ajv`), and `electron-builder` is already at its newest published version (26.15.3) — it simply hasn't bumped those deps yet. npm cannot reach across another package's own declared dependency range without that package publishing an update, or this project overriding it via a package.json `overrides` block (untested against electron-builder's real behavior — not applied here).
**Risk in MDV specifically:** Effectively none. Both packages run only inside `electron-builder`'s own build-time processing of this project's own trusted `package.json`/glob config during `npm run build` — never shipped inside `MDV.app`, never exposed to attacker-controlled input (`build.files` only packages `src/**/*` and `assets/**/*`). Per this audit's own policy, DoS-only findings and build-tool-only exposure with no attacker-reachable input are not scored as exploitable runtime vulnerabilities.
**Recorded as an accepted risk** in `memory-security.md` (2026-08-06). No action required now; re-check when `electron-builder` publishes its next release, or on the next `/security-audit`.

### 2. Release builds are unsigned / not notarized (Low)
**File:** `.github/workflows/release.yml:24-26`, `scripts/install-local.sh`, `scripts/update-local.sh`
**Observation:** `CSC_IDENTITY_AUTO_DISCOVERY=false` is set for both local and CI release builds, so the shipped `.app`/`.zip` is not Apple-signed or notarized. `common.sh` compensates by manually clearing the quarantine flag (`xattr -dr com.apple.quarantine`) after install and by verifying a SHA256SUMS checksum before that — this mitigates in-transit tampering but does not provide the OS-level authenticity guarantee (Gatekeeper/notarization) that a signed build would. This is a known tradeoff (no paid Apple Developer account), not a code defect, and is already reflected in this project's own distribution docs.
**Recommendation:** If/when an Apple Developer ID becomes available, sign and notarize release builds; until then, keep the current checksum verification as the primary integrity control (already in place — no action required).

### 3. No automated dependency-vulnerability scanning in CI (Info)
**File:** `.github/workflows/ci.yml`
**Observation:** CI runs `npm ci` and tests but does not run `npm audit` (or equivalent) as a gate. As this same-day correction shows, that means new advisories (like the 4 above) go unnoticed until someone runs `npm install`/`npm audit` locally.
**Recommendation:** Add an `npm audit --omit=dev --audit-level=high` step (production-only, so build-toolchain noise doesn't fail CI) plus a separate informational full `npm audit` step, to `ci.yml`. Purely optional; per policy, outdated/vulnerable third-party libraries are tracked separately from this audit, but automating the check would have caught this sooner.

---

## 📋 Accepted Risks

None recorded yet in `memory-security.md`.

---

## 📅 Next Steps

1. Run `npm audit fix` (verified safe via `--dry-run`: bumps `electron` 42.3.0→42.8.0 and a handful of electron-builder/jsdom transitive deps, all within existing semver ranges, no `--force`, no code changes needed) to clear all 4 advisories.
2. Add `npm audit` as a CI gate so the next advisory is caught automatically (see Info #4).
3. Optional: pursue code signing/notarization for release builds if an Apple Developer account becomes available (see Low #3).
4. Re-run `/security-audit` after any change to `src/main.js`, `preload.js`, or the CSP in `index.html` — these are the highest-leverage files for this app's security posture.
