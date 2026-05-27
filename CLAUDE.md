# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A continuous, **dev-only** background React profiler for Expo / React Native, split into two independently-published npm packages under the `@artshin` scope, plus a runnable example app (`apps/example`). It captures React DevTools profiling exports on an interval, ships them to a native module that persists + analyses them off the JS thread, and surfaces rolling stats via an in-app overlay, a Rozenite DevTools panel, and Rozenite agent tools queryable from Claude Code.

Deeper cross-cutting reference lives in `docs/` (`architecture.md`, `data-contract.md`, `agent-tools.md`) — the same material this file summarises, in long form.

## Commands

Yarn 1 workspaces (`packages/*` + `apps/*`); requires Node >= 24.

```bash
yarn install        # install all workspaces
yarn build          # build both packages (expo-module build, then rozenite build)
yarn typecheck      # expo-module build + rozenite tsc --noEmit
```

Root `build` / `typecheck` cover the two packages only — the example app is not built or published.

Per package (run from root via `yarn workspace <name> <script>`):

- `@artshin/expo-perf-recorder` (uses `expo-module-scripts`): `build`, `clean`, `lint`, `test`, `prepare`. `test` runs Jest; a single test is `yarn workspace @artshin/expo-perf-recorder test -- -t "name"`. Tests live in `src/__tests__/` and cover the pure JS capture layer (`operations.ts` decoder, `capture.ts` loop, `index.ts` public API). **Important:** `jest.config.js` deliberately bypasses the `jest-expo` preset and runs `ts-jest` in a plain `node` environment — `jest-expo@53` can't load the hoisted `react-native@0.85` RN preset, and these tests need no RN runtime. Native (Kotlin/Swift) analysis is not covered by JS tests.
- `@artshin/rozenite-perf-recorder` (uses `rozenite` + Vite): `build`, `dev` (panel dev server on port 3001), `typecheck`.

Both packages build on `prepublishOnly` and publish independently: `cd packages/<pkg> && npm publish --access public`.

## Architecture

Three layers, one data type. A React DevTools **V5 profiling export** (`getProfilingData()` output: `{ version: 5, dataForRoots, timelineData }`) is the contract that flows JS → native → consumers.

### 1. JS capture (`expo-perf-recorder/src/capture.ts` + `operations.ts`)

The only half that *must* run in the app's JS runtime, because timing data lives in React's in-memory fiber tree, reachable only through `__REACT_DEVTOOLS_GLOBAL_HOOK__`. There is **no WebSocket, no Metro middleware** — it taps the hook directly.

- `capture.ts` runs a `setInterval` loop: every `intervalMs` (default 10s) it `stopProfiling()` on each armed renderer, collects the V5 export, re-arms a fresh window (bounds in-memory growth), and hands the export to a callback. It keeps retrying to arm if no renderer is registered yet (devtools agent attaches a few hundred ms in). `mainRendererOnly` (default true) skips secondary reconcilers like Skia, which have destabilised devtools attach.
- `operations.ts` decodes the DevTools **operations stream** in-process (subscribed via the hook's `operations` event) to build an id→displayName table. This is necessary because `getProfilingData()` returns empty `snapshots` in this RN setup, so heavy fibers would otherwise be `(unnamed)`. `capture.ts#injectNames` merges these names (plus `getDisplayNameForElementID` for the initial-mount subtree) back into each dump's `snapshots` before shipping. Opcode constants are verified against `react-devtools-core@7.0.1`.
- `index.ts` is the public API: `startPerfRecorder` / `stopPerfRecorder` / `getPerfStats` / `clearPerfData`. All no-op unless `__DEV__`. `shipToNative` does `JSON.stringify` + `ingestDump` fire-and-forget.
- `auto.ts` is a side-effect entry (`import "@artshin/expo-perf-recorder/auto"`) that auto-starts the loop in dev.
- `PerfOverlay.tsx` is a floating dev-only stats pill (tap to expand, long-press to clear).

### 2. Native persist/analyse/stats (`expo-perf-recorder/android/...PerfRecorderModule.kt`, `ios/PerfRecorderModule.swift`)

Autolinked Expo module registered as `"PerfRecorder"`. All work runs on a single-threaded background executor, off the JS thread. The Kotlin and Swift implementations are intended to be behavior-equivalent — **keep them in sync when changing analysis or the JSON contract.**

- `ingestDump(json)` → `analyze()` (pure, also reused by `getDumpSummary`) computes per-dump metrics and folds them into **rolling aggregates keyed by component NAME** (element ids reset on every reload, so name is the stable key). Rolling state lives in native memory and **survives Fast Refresh** (the native runtime isn't restarted on JS reload).
- Three distinct metric families: `topFibers` = subtree cost (`fiberActualDurations`), `topBySelf` = self-time ("what's actually expensive"), `triggers` = which components caused commits (`updaters`, "why it renders").
- Raw dumps are ring-buffered to disk (`cacheDir/perf-recorder/dump-<epochMs>.json`), pruned to `maxDumps` (default 50). `getDumpSummary(name)` re-analyses one by name; `dumpNameRe` guards against path traversal.

### 3. Rozenite DevTools panel + agent tools (`rozenite-perf-recorder/`)

This package imports **nothing** from the expo package — the two are coupled only by the native module name `"PerfRecorder"`, reached via `requireNativeModule("PerfRecorder")` in `src/react-native/native.ts`. Types in `src/shared/messaging.ts` are a deliberate standalone copy of the native stats contract.

- `usePerfRecorderDevTools()` (app hook, exported from `react-native.ts`) pushes native stats to the panel every 2s and handles `request-stats` / `clear` messages. It also calls `usePerfRecorderAgentTools()`.
- `src/shared/agent-tools.ts` defines four agent tool contracts — `get-stats`, `clear`, `list-dumps`, `get-dump` — callable from the Rozenite agent CLI (and thus Claude Code), e.g. `npx rozenite agent at-artshin__rozenite-perf-recorder call --tool get-stats --args '{}' --session <id>`. Handlers in `src/react-native/agent/usePerfRecorderAgentTools.ts` proxy straight to the native module.
- `src/ui/perf-recorder.tsx` is the web panel (React DOM, built by Vite/Rozenite); `rozenite.config.ts` registers it.

### Example app (`apps/example`)

A workspace-member Expo dev-client app (Expo SDK 56 / RN 0.85) that consumes both packages via workspace linking, so local package edits flow through after a rebuild. `index.ts` imports `/auto` first, `App.tsx` wires `PerfOverlay` + `usePerfRecorderDevTools()`, and `src/HeavyDemo.tsx` generates continuous heavy re-renders to profile. `metro.config.js` is monorepo-aware (watches the workspace root, resolves hoisted `node_modules`) and conditionally applies `withRozenite` when `WITH_ROZENITE` is set. Because the expo package ships native code, the example **cannot run in Expo Go** — it requires `expo prebuild` + a dev client, and Metro serves the packages' built `build/`/`dist/` output, so `yarn build` (root) must run before/after package edits.

## Conventions

- Everything is gated on `__DEV__` / `NODE_ENV !== "production"` and must be a no-op in production and on the server.
- The capture layer must never crash the dev app: malformed dumps, missing renderers, and bad operations frames are swallowed with at most a `console.warn`.
- When changing the V5 → stats analysis, update **both** the Kotlin and Swift modules and the mirrored types in `expo-perf-recorder/src/PerfRecorder.types.ts` *and* `rozenite-perf-recorder/src/shared/messaging.ts`.
