# @artshin/perf-recorder

[![CI](https://github.com/artshin/perf-recorder/actions/workflows/ci.yml/badge.svg)](https://github.com/artshin/perf-recorder/actions/workflows/ci.yml)
[![expo-perf-recorder](https://img.shields.io/npm/v/@artshin/expo-perf-recorder?label=%40artshin%2Fexpo-perf-recorder)](https://www.npmjs.com/package/@artshin/expo-perf-recorder)
[![rozenite-perf-recorder](https://img.shields.io/npm/v/@artshin/rozenite-perf-recorder?label=%40artshin%2Frozenite-perf-recorder)](https://www.npmjs.com/package/@artshin/rozenite-perf-recorder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Continuous, **dev-only** background React profiler for Expo / React Native, plus
its Rozenite DevTools panel — a standalone, reusable monorepo.

It captures React DevTools profiling dumps (`getProfilingData()` V5 exports) on
an interval, ships them to a native module that persists + analyses them off the
JS thread, and surfaces rolling stats via an in-app overlay, a Rozenite panel,
and Rozenite agent tools queryable from Claude Code.

## Packages

| Package | What |
|---------|------|
| [`@artshin/expo-perf-recorder`](packages/expo-perf-recorder) | The Expo native module (autolinked Kotlin + Swift) + JS capture loop + `PerfOverlay`. Exposes native module `"PerfRecorder"`. |
| [`@artshin/rozenite-perf-recorder`](packages/rozenite-perf-recorder) | Rozenite DevTools panel + `usePerfRecorderDevTools()` app hook + agent tools (`get-stats` / `clear` / `list-dumps` / `get-dump`). Talks to the native module by name. |
| [`@artshin/perf-recorder-example`](apps/example) | Runnable Expo dev-client app wiring both packages together — `/auto`, `PerfOverlay`, the DevTools hook, and a deliberately heavy screen to profile. Needs a custom dev client (not Expo Go). |

The two are coupled only by the native module name `"PerfRecorder"` — the panel
imports nothing from the native package, it calls `requireNativeModule("PerfRecorder")`.

## Docs

Deeper reference lives in [`docs/`](docs/) (the package READMEs cover install +
usage; `docs/` covers the cross-cutting how/why):

- [docs/architecture.md](docs/architecture.md) — the three layers, data flow, threading, and the design decisions.
- [docs/data-contract.md](docs/data-contract.md) — the V5 export, derived stats, the three metric families, and the Kotlin/Swift/TS sync rule.
- [docs/agent-tools.md](docs/agent-tools.md) — querying live stats from Claude Code / the Rozenite agent CLI.

## Develop

```bash
yarn install          # workspaces
yarn build            # build both packages
yarn typecheck        # typecheck both
yarn workspace @artshin/expo-perf-recorder test   # JS capture-layer tests
```

Tests cover the pure JS capture layer (the operations-stream decoder, the
capture loop, the public API); see [docs/testing.md](docs/testing.md).

To run the example app (builds the packages first, then a custom dev client),
see [`apps/example/README.md`](apps/example/README.md).

## Publish

Both packages publish independently to npm (scope `@artshin`). Their build runs
on `prepublishOnly`, so a clean `npm publish` produces the right `build/` /
`dist/` output.

```bash
# expo native module
cd packages/expo-perf-recorder && npm publish --access public

# rozenite panel
cd packages/rozenite-perf-recorder && npm publish --access public
```

## Consume in an app

```bash
npx expo install @artshin/expo-perf-recorder
npm install --save-dev @artshin/rozenite-perf-recorder
```

Then:

```ts
// app entry (e.g. index.ts) — dev-only, no-op in production
import "@artshin/expo-perf-recorder/auto";
```

```tsx
// app root layout
import { PerfOverlay } from "@artshin/expo-perf-recorder";
import { usePerfRecorderDevTools } from "@artshin/rozenite-perf-recorder";

function AppRoot() {
  usePerfRecorderDevTools();
  // ...
  return <>{__DEV__ && <PerfOverlay />}</>;
}
```

Rebuild the native dev client (autolinking compiles the module in), then run
with `WITH_ROZENITE=true` to get the panel + agent tools.

See each package's README for details.
