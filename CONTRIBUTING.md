# Contributing

<div align="center">

**English** | [한국어](CONTRIBUTING.ko.md)
</div>

MDV keeps two long-lived branches. **`develop` is where work integrates**; **`main` holds released code only** and moves when a release is deliberately decided. Everything else is a short-lived branch that lands through a pull request.

`main`, `develop`, and `release/*` are protected by a repository ruleset against force pushes and deletion. There are no required status checks, so CI is advisory rather than blocking — read it before merging.

## Workflow

1. Branch off `develop` using a `type/short-description` name — `feat/`, `fix/`, `docs/`, `ci/`, `harden/`, etc.
2. Commit in small, focused steps: one logical change per commit, staging only the paths that change belongs to. Open a pull request early so work is visible.
   - If `develop` moves ahead while you work, **rebase onto it rather than merging it back in**. Force-push a branch you already pushed with `--force-with-lease`, and only when you are its sole owner.
3. Before merging, CI must pass. `.github/workflows/ci.yml` runs `npm run test:unit`, `npm run test:controller`, and a dependency audit gate on every push and PR, including documentation-only ones — it takes about 15s. `.github/workflows/ci-electron.yml` runs the Electron smoke suite (macOS runner, ~4min) and is skipped when a change touches only documentation; that file lists the excluded paths and explains why `tests/fixtures/*.md` must keep triggering it.
4. Run the Electron smoke suite locally at least once before pushing (see [AGENTS.md](AGENTS.md) test tiers) — CI now runs it too, but a local run surfaces failures faster than waiting on the macOS runner:
   ```
   npm run test:electron
   ```
5. Merge the PR into `develop` (merge commit, matching existing history). The branch is deleted automatically on merge. Squash and rebase merges are available but are a deliberate per-PR choice, not the default.
6. Releasing is a separate, explicit act: open a pull request from `develop` to `main`, merge it, then follow [RELEASING.md](RELEASING.md). Nothing reaches `main` any other way.

## Dependencies

`.npmrc` sets `min-release-age=7`: npm will not install a package version published less than seven days ago.

The attack this guards against is a maintainer account takeover followed by a malicious patch release. Those are usually caught and unpublished within hours, so nearly all of the risk sits in the first days after a version appears. This project has no reason to take a release the day it ships, so waiting out that window costs nothing and closes it.

What you will actually notice: `npm install` and `npm audit fix` skip a fix whose patched version is still inside the cooldown, and print

```
npm warn audit ... left at a vulnerable version because a fix is newer than the release-age cutoff
```

It warns rather than failing, and the line is easy to lose in scrollback — so if an advisory looks unfixable, check for that warning before concluding it is blocked upstream. Re-run the audit once the cooldown passes.

Do not reach for `npm audit fix --force`, and do not lower the number to get a green audit; either one trades the guard for exactly the days it exists to cover. If a fix is urgent enough to skip the wait, make that call deliberately and record it in `memory-security.md`.

CI is unaffected: `npm ci` installs the pinned versions in `package-lock.json` and never consults the cooldown. The setting matters when dependencies are *changed*, which happens on a contributor's machine.

## Releasing

See [RELEASING.md](RELEASING.md).
