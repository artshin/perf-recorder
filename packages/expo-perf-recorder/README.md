# @artshin/expo-perf-recorder

[![npm](https://img.shields.io/npm/v/@artshin/expo-perf-recorder)](https://www.npmjs.com/package/@artshin/expo-perf-recorder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Continuous, **dev-only** background React profiler for Expo / React Native apps,
shipped as a self-contained Expo module (autolinked native Kotlin + Swift). It
records the same data the React DevTools profiler captures (`getProfilingData()`
V5 exports), but **automatically and on an interval** — then persists, analyses,
and aggregates it natively, off the JS thread, so stats are available on demand.

The companion Rozenite DevTools panel + agent tools live in
[`@artshin/rozenite-perf-recorder`](../rozenite-perf-recorder).

## Install

```sh
npx expo install @artshin/expo-perf-recorder
```

Expo autolinking picks up the native module from `node_modules` — no manual
linking. Rebuild the dev client / run `expo prebuild` so the native code is
compiled in.

## How it works

| Layer | Where | Responsibility |
|-------|-------|----------------|
| Capture | JS (`src/capture.ts`) | Taps `__REACT_DEVTOOLS_GLOBAL_HOOK__`, runs a continuous loop: every `intervalMs` it stops the profiling window, ships the V5 export to native, and re-arms a fresh window (so in-memory commit data never grows unbounded). |
| Persist + analyse + stats | Native (Kotlin / Swift) | Parses each dump on a background thread, ring-buffers raw dumps to disk, and folds results into rolling stats that **survive Fast Refresh**. |
| Stats UI | JS (`src/overlay/PerfOverlay.tsx`) | Floating dev overlay. A richer Rozenite devtools panel ships in `@artshin/rozenite-perf-recorder`. |

Capture *must* run in the app's JS runtime — the timing data lives in React's
in-memory fiber tree, reachable only through the devtools hook. Everything else
is native and off-thread.

## Usage

### Zero-integration (recommended)

Add one side-effect import to your app entry (`index.ts`):

```ts
import "@artshin/expo-perf-recorder/auto"; // dev-only; no-op in production
```

That's it — the loop arms itself once the devtools agent attaches.

### Show live stats

Mount the overlay near the app root (dev branch only):

```tsx
import { PerfOverlay } from "@artshin/expo-perf-recorder";
// ...
{__DEV__ && <PerfOverlay />}
```

Tap the pill to expand; long-press to clear stats.

### Programmatic

```ts
import {
  startPerfRecorder,
  stopPerfRecorder,
  getPerfStats,
  clearPerfData,
} from "@artshin/expo-perf-recorder";

await startPerfRecorder({ intervalMs: 8000, mainRendererOnly: true, maxDumps: 50 });
const stats = await getPerfStats(); // PerfStats
await stopPerfRecorder();
await clearPerfData();
```

## Config

| Option | Default | Notes |
|--------|---------|-------|
| `intervalMs` | `10000` | Window length / ship cadence. Bounds memory. |
| `mainRendererOnly` | `true` | Skip secondary reconcilers (e.g. Skia) — they have destabilised devtools attach on this app. |
| `maxDumps` | `50` | Raw dumps retained in the native disk ring buffer. |

## Caveats

- **Dev-only.** Guarded by `__DEV__`; profiling mode adds per-commit overhead and
  skews absolute numbers — read it for trends/regressions, not budgets.
- **Names** come from the in-app DevTools operations decoder (`src/operations.ts`),
  injected into each dump's `snapshots` before shipping; `commitData.updaters` is
  the secondary source. Requires the devtools agent attached (see `:8097` caveat).
- Rolling fiber stats are keyed by **name**, not id, because element ids reset on
  every JS reload.
- Raw dumps land in the app cache dir (`<cache>/perf-recorder/`), newest-last.

## Companion panel

`@artshin/rozenite-perf-recorder` is a standalone Rozenite DevTools panel +
agent tools that talk to this module's native side by name
(`requireNativeModule("PerfRecorder")`). It surfaces the same rolling stats in a
Rozenite panel and exposes `get-stats` / `clear` / `list-dumps` / `get-dump`
agent tools. See that package's README.
