# Contributing

Thanks for helping improve `@artshin/perf-recorder`.

## Setup

```bash
yarn install   # Node >= 24, Yarn 1 (Classic) workspaces
yarn build     # build both packages
yarn typecheck
yarn lint
yarn test
```

The example app (`apps/example`) needs a custom Expo dev client — see
[`apps/example/README.md`](apps/example/README.md).

## Workflow

1. Branch off `main`.
2. Make your change. Keep the two published packages decoupled — they
   communicate only via the native module name `"PerfRecorder"`.
3. Run the health checks above; CI enforces all of them.
4. **Add a changeset** for any change to a published package:
   ```bash
   yarn changeset
   ```
   Pick the package(s) and bump level and write a one-line summary. CI fails a
   PR that changes a package without one. Skip this only for docs/CI/example
   changes that touch no published package.
5. Open a PR. Its **title must follow [Conventional Commits](https://www.conventionalcommits.org/)**
   (e.g. `feat(rozenite): add get-dump tool`) — it becomes the squash-merge
   commit. Local commits are also linted by commitlint.

## Commit / PR types

`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`,
`revert`.

## Releasing

Merging to `main` opens a **Version Packages** PR (Changesets). Merging that
bumps versions and writes the changelogs; publishing to npm is then a deliberate
manual run of the Release workflow.
