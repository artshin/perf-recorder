# Architecture

Three layers, one data type. A React DevTools **V5 profiling export** is the
contract that flows JS → native → consumers (see [data-contract.md](data-contract.md)).

```
 React fiber tree (in JS runtime)
        │  __REACT_DEVTOOLS_GLOBAL_HOOK__
        ▼
┌──────────────────────────────┐
│ 1. JS capture (expo pkg)     │  setInterval: stop window → V5 export → re-arm
│    capture.ts / operations.ts│  injectNames() merges decoded display names
└──────────────┬───────────────┘
        ingestDump(JSON.stringify(export))   ← fire-and-forget
               ▼
┌──────────────────────────────┐
│ 2. Native persist/analyse    │  single bg thread, off the JS thread
│    PerfRecorderModule.kt/swift│  analyze() → rolling aggregates (by NAME)
│                              │  raw dumps → disk ring buffer (maxDumps)
└──────────────┬───────────────┘
        getStats() / getDumpSummary() / listDumps()
               ▼
┌──────────────────────────────┐
│ 3. Consumers                 │  PerfOverlay (expo pkg)
│                              │  Rozenite panel + agent tools (rozenite pkg)
└──────────────────────────────┘
```

## 1. JS capture — `packages/expo-perf-recorder/src/`

The only half that **must** run in the app's JS runtime: timing data lives in
React's in-memory fiber tree, reachable only through
`__REACT_DEVTOOLS_GLOBAL_HOOK__`. There is **no WebSocket and no Metro
middleware** — capture taps the hook directly.

- **`capture.ts`** runs a `setInterval` loop. Every `intervalMs` (default 10s)
  it calls `stopProfiling()` on each armed renderer, collects the V5 export,
  re-arms a fresh window (this bounds in-memory commit growth), and hands the
  export to a callback. It keeps retrying to arm if no renderer is registered
  yet — the devtools agent attaches a few hundred ms after startup.
  `mainRendererOnly` (default true) skips secondary reconcilers like Skia, which
  have destabilised devtools attach.
- **`operations.ts`** decodes the DevTools **operations stream** in-process
  (subscribed via the hook's `operations` event) to build an id→displayName
  table. Necessary because `getProfilingData()` returns empty `snapshots` in this
  RN setup, so heavy fibers would otherwise be `(unnamed)`. Opcode constants are
  verified against `react-devtools-core@7.0.1`.
- **`capture.ts#injectNames`** merges those names (plus
  `getDisplayNameForElementID` for the initial-mount subtree) back into each
  dump's `snapshots` before shipping.
- **`index.ts`** is the public API: `startPerfRecorder` / `stopPerfRecorder` /
  `getPerfStats` / `clearPerfData`. All no-op unless `__DEV__`. `shipToNative`
  does `JSON.stringify` + `ingestDump`, fire-and-forget.
- **`auto.ts`** is a side-effect entry (`import "@artshin/expo-perf-recorder/auto"`)
  that auto-starts the loop in dev.
- **`PerfOverlay.tsx`** is a floating dev-only stats pill (tap to expand,
  long-press to clear).

**Invariant:** capture must never crash the dev app. Malformed dumps, missing
renderers, and bad operations frames are swallowed with at most a `console.warn`.

## 2. Native persist / analyse / stats

Autolinked Expo module registered as `"PerfRecorder"`
(`android/…/PerfRecorderModule.kt`, `ios/PerfRecorderModule.swift`). All work
runs on a **single-threaded background executor, off the JS thread.** The Kotlin
and Swift implementations are intended to be behaviour-equivalent — keep them in
sync when changing analysis or the JSON contract.

- `ingestDump(json)` → `analyze()` (pure; also reused by `getDumpSummary`)
  computes per-dump metrics and folds them into rolling aggregates **keyed by
  component name**. Element ids reset on every reload, so name is the stable key.
- Rolling state lives in native memory and **survives Fast Refresh** — the native
  runtime isn't restarted on a JS reload, only the JS side is. This is why stats
  accumulate across edit-reload cycles.
- Raw dumps are ring-buffered to disk (`cacheDir/perf-recorder/dump-<epochMs>.json`),
  pruned to `maxDumps` (default 50). `getDumpSummary(name)` re-analyses one by
  name; a `dumpNameRe` (`^dump-\d+\.json$`) guards against path traversal.

## 3. Consumers — `packages/rozenite-perf-recorder/`

Imports **nothing** from the expo package; coupled only by the native module
name, reached via `requireNativeModule("PerfRecorder")` in
`src/react-native/native.ts`. The types in `src/shared/messaging.ts` are a
deliberate standalone copy of the native stats contract.

- `usePerfRecorderDevTools()` (app hook, exported from `react-native.ts`) polls
  native stats and pushes them to the panel every ~2s, and handles
  `request-stats` / `clear` messages. It also calls `usePerfRecorderAgentTools()`.
- `src/shared/agent-tools.ts` defines four agent-tool contracts — `get-stats`,
  `clear`, `list-dumps`, `get-dump` — callable from the Rozenite agent CLI and
  thus Claude Code. Handlers in
  `src/react-native/agent/usePerfRecorderAgentTools.ts` proxy straight to the
  native module. See [agent-tools.md](agent-tools.md).
- `src/ui/perf-recorder.tsx` is the web panel (React DOM, built by
  Vite/Rozenite); `rozenite.config.ts` registers it.

## Cross-cutting

- **Dev-only.** Everything is gated on `__DEV__` / `NODE_ENV !== "production"`
  and is a no-op in production and on the server. Profiling mode adds per-commit
  overhead and skews absolute numbers — read stats for trends/regressions, not
  as a budget.
- **Why name-keyed rolling stats.** DevTools element ids are per-session and
  reset on reload; only the display name is stable across reloads, so rolling
  aggregates key on name.
- **Why no WebSocket.** The classic devtools sink listens on `:8097`; this design
  avoids that entirely by reading the in-process hook, so the capture loop has
  data as soon as the agent attaches — but the native side only has stats once
  the loop ships its first window.
