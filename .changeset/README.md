# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

Every PR that changes a published package (`@artshin/expo-perf-recorder` or
`@artshin/rozenite-perf-recorder`) must include a changeset. Add one with:

```bash
yarn changeset
```

Pick the affected package(s) and the bump (`patch` / `minor` / `major`) and
write a one-line summary — it becomes the changelog entry. CI (`changeset-gate`)
fails a PR that touches a package without one.

On merge to `main`, the Release workflow opens (or updates) a **Version
Packages** PR that consumes the accumulated changesets, bumps versions, and
writes each package's `CHANGELOG.md`. Merging that PR publishes to npm and tags
the release.
