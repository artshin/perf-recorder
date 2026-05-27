# @artshin/rozenite-perf-recorder

[![npm](https://img.shields.io/npm/v/@artshin/rozenite-perf-recorder)](https://www.npmjs.com/package/@artshin/rozenite-perf-recorder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

A [Rozenite](https://rozenite.dev) React Native DevTools panel for the
`perf-recorder` module. Shows live rolling stats (dumps, commits, React work,
top fibers) and a Clear button.

It is **fully standalone** — it talks to the native module by its registered
name (`requireNativeModule("PerfRecorder")`), so it imports nothing from the app.

## Architecture

| Side | File | Role |
|------|------|------|
| App (RN) | `src/react-native/usePerfRecorderDevTools.ts` | Polls native `getStats()` every 2s, pushes to panel; handles `request-stats` / `clear`. |
| Panel (web) | `src/ui/perf-recorder.tsx` | Renders stats; sends `request-stats` / `clear`. |
| Shared | `src/shared/messaging.ts` | Typed event map + stats types. |

Requires the companion native module
[`@artshin/expo-perf-recorder`](../expo-perf-recorder) installed in the app — the
panel reaches its native side by name.

## Install

```bash
npm install --save-dev @artshin/rozenite-perf-recorder
# or: yarn add -D @artshin/rozenite-perf-recorder
```

The published `dist/` already contains the built panel + app entry; Rozenite
discovers the plugin from the package's `rozenite.config.ts` automatically.

## Wire into the app

In your app's root layout, alongside the other Rozenite hooks:

```tsx
import { usePerfRecorderDevTools } from "@artshin/rozenite-perf-recorder";
// ...
usePerfRecorderDevTools();
```

## Run

```bash
WITH_ROZENITE=true yarn start     # from your app root
```

Open React Native DevTools → **Perf Recorder** tab. Requires the perf-recorder
capture loop running (the `:8097` sink caveat from the module applies — the
native side only has stats once the capture loop ships dumps).

## Query from Claude Code (agent tools)

The plugin registers Rozenite **agent tools**, so once it's running in the app
you can query the live native stats from the CLI / Claude Code — no adb, no
panel open:

```bash
# from your app root
SID=$(npx rozenite agent session create --json | jq -r '.sessionId')   # or note the id it prints
npx rozenite agent at-artshin__rozenite-perf-recorder call --tool get-stats --args '{}' --session "$SID"
npx rozenite agent at-artshin__rozenite-perf-recorder call --tool clear    --args '{}' --session "$SID"
npx rozenite agent session stop "$SID"
```

Tools:
- `get-stats` → `PerfStats` (dumpCount, totalCommits, totalReactCommitMs, topFibers, lastDump) from the live in-memory native counters.
- `clear` → `{ cleared: boolean }` — reset ring buffer + rolling stats.
- `list-dumps` → `PerfDumpListEntry[]` (newest first): `{ name, sizeBytes, ingestedAt }`.
- `get-dump` ← `{ name }` → `PerfDumpSummary | null` — re-analyses one persisted dump off-thread (roots, commits, fiberRecords, reactCommitMs, wallSec, topFibers).

```bash
npx rozenite agent at-artshin__rozenite-perf-recorder call --tool list-dumps --args '{}' --session "$SID"
npx rozenite agent at-artshin__rozenite-perf-recorder call --tool get-dump --args '{"name":"dump-1779830426509.json"}' --session "$SID"
```

The domain token is the pluginId with `/`→`__` and `@`/dots normalized:
`at-artshin__rozenite-perf-recorder`. Confirm with
`npx rozenite agent domains --session "$SID"`.

## Dev (panel hot reload)

```bash
yarn workspace @artshin/rozenite-perf-recorder dev
```
