# Security Audit Report

Date: 2026-09-17 (re-audit, same day)
Score: 96/100
Project: Electron (main + preload + renderer), Node.js, GitHub Actions, Homebrew cask distribution
Previous: 87/100 (2026-09-17, earlier today) · 94/100 (2026-08-10) · 96/100 (2026-08-06)

> Every finding from this morning's audit was fixed and is verified closed below. The four
> fixes are my own work from the same session, so nothing here is graded on the commit
> message — each control was re-checked against the running code and the live tree, not
> assumed from the diff. This matters because two claims in the earlier report turned out to
> be inherited from memory rather than verified; see *Corrections carried forward*.

---

## Scope

Unchanged: MDV is an offline-first desktop markdown viewer with no server, no database, no
accounts, no sessions. Nine of the 25 categories do not apply and are marked N/A rather than
scored as free passes; the score is computed over the 16 applicable categories (75% of the
standard weighting) and normalised.

The real attack surface remains narrow: **it renders untrusted `.md` files and resolves the
file paths they name.** Both of this morning's medium findings lived there. Both are closed.

---

## Critical Issues

None.

## High Issues

None.

## Medium Issues

None.

## Low Issues

None open.

---

## Findings Closed Since This Morning

### M1 — image handler now checks the symlink target ✅ `f28bab9`

`read-image-data-url` resolved the extension with `path.extname()` (the link's own name) and
read with `readFile()` (which follows symlinks), so `photo.png → ~/.ssh/id_rsa` passed the
allowlist and came back as a `data:image/png` URI.

Verified closed against the running code, not the diff: the handler now checks the named
extension **and** the realpath extension against `IMAGE_MIME_TYPES`, reads through the
resolved path (so no symlink can be swapped between check and read), and treats a realpath
failure as a rejection — the same shape `open-local-path` has used since the HIGH-1 follow-up.
The regression test asserts the legitimate case alongside the blocked one, so it cannot pass
by refusing everything, and confirms the rejection does not leak the target's bytes through
the error string. It was run red against the previous handler before being accepted.

### M2 — the font is bundled; boot makes no remote request ✅ `61cc4e3`

JetBrains Mono came from `fonts.googleapis.com` / `fonts.gstatic.com`, so opening a local
document contacted a third party and leaked the reader's IP and timing.

Verified closed at three levels: `index.html` contains **zero** `https?://` references; the
CSP is now `style-src 'self' 'unsafe-inline'; font-src 'self'`; and an Electron test reloads
the app with a request listener attached and asserts a real boot issues no remote request at
all, then that the font resolves from the bundle rather than silently falling back to SF
Mono. That test was run red against the previous markup — it fails on "boot must not reach
any remote origin".

The six subset files are generated from the same css2 response, so unicode-ranges and
subsetting are unchanged and no character lost its font.

### L1 — the cooldown is a repository control now ✅ `8d0cef8`

`memory-security.md` had claimed since 2026-08-10 that "this repo's own `.npmrc` sets
`min-release-age=7`". There was no `.npmrc` here; the setting lived in the maintainer's
`~/.npmrc`.

Verified closed: the file is committed, and `npm config list` reports the user entry as
`overridden by project`. Its role is documented in three places — the file's own header,
`CONTRIBUTING.md` and `CONTRIBUTING.ko.md` — covering what it guards against, the fact that
npm *warns rather than fails* when it skips a fix (so an advisory that looks blocked upstream
may just be waiting out the window), and the instruction not to `--force` past it. Confirmed
by execution that it does not affect CI: `npm ci --dry-run` installs the locked tree cleanly.

### L2 — CI token scoped, and a live suppression removed ✅ `f275edb`, `907e9e6`

`ci.yml` declared no `permissions:` block, so its `GITHUB_TOKEN` inherited the repository
default. It is now `contents: read`; `release.yml` keeps `contents: write` because it
genuinely publishes.

The audit allowlist named `brace-expansion` and `fast-uri`. This morning's report called them
stale leftovers — **wrong**, and wrong because the claim was copied from memory instead of
checked. `npm ls` finds both in the tree, so they were live suppressions that would have let
a future high or critical pass the gate in silence. The allowlist is now empty, verified by
running the gate's own script against a fresh `npm audit --json` (0 blocking) and then by
watching CI go green on the real runner.

---

## Info / Accepted

### The bundled font binaries rest on one HTTPS fetch

Six `.woff2` files are now committed. Their provenance is a single HTTPS download from
`fonts.gstatic.com` on 2026-09-17 — not a checksum published by JetBrains, and not a build
from the upstream source. Recording it because it is a new supply-chain input introduced by
this session's own fix, and grading my own change leniently would defeat the point.

Why it is Info rather than a finding: the origin is a well-known CDN over TLS, the files are
now immutable in git (any future change is a visible binary diff and re-verifiable against
history), `OFL.txt` ships beside them as the licence requires, and an Electron test proves
they decode and render as real JetBrains Mono rather than being arbitrary bytes. The stronger
option — building the subsets from the JetBrains GitHub release — is available if this ever
needs a firmer chain.

### `'unsafe-inline'` remains in `style-src`

Inline `<style>` blocks and `style=` attributes are used throughout the renderer. Removing
the keyword means introducing nonces or hashes and reworking every inline style — a separate
piece of work, not a leftover. Worth noting that it is *style* only: `script-src` is a bare
`'self'`, so this is not an XSS execution path.

### The app is unsigned and un-notarized

Unchanged and documented in `RELEASING.md`; the reason the update checker is notify-only.
Download integrity is covered in practice by the Homebrew cask's per-release `sha256`. What
is genuinely absent is revocation and publisher identity.

### Three Electron tests are load-dependent flakes — a gate-trust problem

Not a vulnerability, but it belongs in a security report: the copy-button hover test, the
default-app-guide focus test, and (before `fcd7015`) the ⌘B focus-guard test each pass 3/3 in
isolation and fail intermittently only under the full suite's concurrency, where several
Electron instances contend for OS focus.

The security consequence is alert fatigue on the gate that catches dependency advisories. A
CI run that is red often enough for unrelated reasons trains everyone — including me, twice
today — to reach for "probably flaky" before reading the log. The audit gate and the flaky
tests share one red/green signal.

---

## Corrections Carried Forward

Two claims in this morning's report were wrong, both because they were copied out of
`memory-security.md` instead of checked against the repo:

1. *"`brace-expansion` and `fast-uri` … neither is in the dependency tree any more."* Both
   are in the tree. The entries were live suppressions, not leftovers.
2. The `.npmrc` was described by memory as a repository control for five weeks while it
   existed only on one machine.

Both are corrected in `memory-security.md` with the underlying lesson recorded: **a sentence
in security memory is what someone believed on a date, not a fact about today's tree — run
the command.** A third error the same day (a comment apostrophe breaking the audit gate's
single-quoted shell string, which `node --check` and `bash -n` both pass) is recorded there
too, with the only check that catches it: execute the step.

---

## What's Secure

| Area | Evidence |
|---|---|
| **Electron isolation** | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| **Renderer containment** | `will-navigate` blocks navigation away from the shell; `setWindowOpenHandler` denies every window and hands only `^https?://` to the OS browser |
| **Untrusted file paths** | Both readers — `open-local-path` and `read-image-data-url` — check the link name *and* its realpath, and read through the resolved path |
| **Network** | Exactly one outbound call in the whole app (the GitHub Releases check): 10s timeout, 1MB body cap, 24h throttle. Boot itself reaches nothing, enforced by test |
| **CSP** | `default-src`/`script-src`/`font-src` all bare `'self'`; `img-src 'self' data:`; `form-action`/`base-uri`/`object-src` `'none'`. Six assertions in `csp.test.js` fail on any relaxation, including a stray remote `<link>` or `preconnect` |
| **XSS** | DOMPurify on all markdown output; mermaid source base64'd into `data-*` to survive sanitisation; TOC built with `createElement` + `textContent` |
| **Injection** | No `eval`, `new Function`, or `child_process` anywhere in `src/`. Search queries escaped before `new RegExp` — no ReDoS from user input |
| **Dependencies** | `npm audit` full tree: **0 vulnerabilities**. Lockfile committed. `min-release-age=7` now repo-level. Audit gate with an empty allowlist, so nothing is exempt |
| **Secrets** | None in source or history. `.gitignore` covers `.env*`, `*.key`, `*.pem`, `secrets/`. The one `TAP_TOKEN=` is an env reference |
| **CI** | `ci.yml` and `ci-electron.yml` `contents: read`, `release.yml` `contents: write`, no `${{ }}` inside any `run:` block |
| **Resource limits** | Directory watch: depth 1, ignore list, 20,000-path circuit breaker that closes the watcher and warns rather than stalling the main process |
| **IPC surface** | Every channel reviewed; the newest (`fullscreen-changed`) is main→renderer, one boolean, with no renderer-callable counterpart |

---

## Score Board

```
╔════════════════════════════════════════════════════════╗
║          SECURITY SCORE : 96/100  🟢                    ║
╠════════════════════════════════════════════════════════╣
║  🟢 Secrets & Files            100/100   (8%)   =      ║
║  🟢 Network & Egress           100/100   (5%)  +20     ║
║  🟢 HTTP Headers / CSP          90/100   (5%)  +10     ║
║  🟢 Cryptography / Signing      90/100   (6%)   =      ║
║  🟢 Deployment & CI            100/100   (5%)  +15     ║
║  🟢 Advanced Attacks           100/100   (7%)  +20     ║
║  🟢 Injections                 100/100   (6%)   =      ║
║  🟢 Race Conditions             95/100   (4%)   =      ║
║  🟢 File Handling              100/100   (3%)  +25     ║
║  🟢 Supply Chain                95/100   (5%)  +10     ║
║  🟢 Compliance / Privacy       100/100   (4%)  +15     ║
║  🟡 Monitoring                  80/100   (3%)   =      ║
║  🟢 Source Code Analysis       100/100   (7%)  +15     ║
║  🟢 Resource Limits            100/100   (3%)   =      ║
║  🟢 Browser APIs               100/100   (2%)   =      ║
║  🟠 Advanced Security (L3)      60/100   (2%)   =      ║
╠════════════════════════════════════════════════════════╣
║  N/A: Auth · JWT · Database · Docker · Protocols ·     ║
║       DNS/Email · Mobile · Serverless · AI/LLM         ║
╚════════════════════════════════════════════════════════╝
  📈 87/100 → 96/100 this session
  🔴 0 critical · 🟠 0 high · 🟡 0 medium · 🔵 0 low
```

**The remaining 4 points are structural, not defects.** No finding is open. The gap is two
categories where the project has deliberately not gone further:

- **Advanced Security L3 (60)** — no code signing or notarization, no Trusted Types, no
  anti-tamper. Signing is the big one and would also unblock a real auto-updater.
- **Monitoring (80)** — errors are swallowed silently by design throughout (a background
  update check must never surface an error), and there is no logging or anomaly detection.
  Reasonable for a local viewer; it does mean a failure leaves no trace.
- **CSP (90)** — `'unsafe-inline'` for styles.
- **Supply Chain (95)** — the font binaries' single-fetch provenance.

---

## Next Steps

Nothing is urgent. In rough order of value:

1. **Stabilise the three flaky Electron tests.** Not a vulnerability, but it is what keeps the
   dependency gate trustworthy, and the failure mode is already observable — twice today a red
   CI was reasoned about as "probably flaky" before the log was read. Likely fix is the same
   class as `fcd7015`: these tests contend for OS focus under concurrency.
2. **Code signing + notarization**, if distribution ever widens beyond a personal Homebrew
   tap. Unblocks the auto-updater as a side effect.
3. **Trusted Types and dropping `'unsafe-inline'`**, together — both mean reworking inline
   styles, so they are one project rather than two.
4. Rebuild the font subsets from the JetBrains upstream release if the supply chain ever needs
   a firmer link than one CDN fetch.
