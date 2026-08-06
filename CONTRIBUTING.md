# Contributing

MDV uses [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow): `main` is always deployable, and all changes land through short-lived branches and pull requests.

## Workflow

1. Branch off `main` using a `type/short-description` name — `feat/`, `fix/`, `docs/`, `harden/`, etc.
2. Commit in small, focused steps. Open a pull request early so work is visible.
3. Before merging, CI (`.github/workflows/ci.yml`) must pass: `npm run test:unit`, `npm run test:controller`, a dependency audit gate, and the Electron smoke suite (`test-electron` job, macOS runner).
4. Run the Electron smoke suite locally at least once before pushing (see [AGENTS.md](AGENTS.md) test tiers) — CI now runs it too, but a local run surfaces failures faster than waiting on the macOS runner:
   ```
   npm run test:electron
   ```
5. Merge the PR (merge commit, matching existing history). The branch is deleted automatically on merge.

## Releasing

See [RELEASING.md](RELEASING.md).
