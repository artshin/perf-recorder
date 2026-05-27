# Data contract

One data type flows through the whole system, and the native layer derives a
fixed set of stats from it. This page is the reference for both, plus the rule
for keeping the three copies of the contract in sync.

## The input: a V5 profiling export

What `getProfilingData()` produces and what `ingestDump` accepts:

```ts
type V5Export = {
  version: 5;
  dataForRoots: unknown[];   // per-root commit data (durations, updaters, …)
  timelineData: unknown[];
};
```

The JS capture layer enriches each export's `snapshots` with decoded display
names before shipping (see [architecture.md](architecture.md) §1) — `dataForRoots`
otherwise references fibers by id only, and ids are not stable across reloads.

## The three metric families

Every analysis (per-dump and rolling) reports three **distinct** views. Don't
conflate them — they answer different questions:

| Family | Source | Question | Type |
|--------|--------|----------|------|
| `topFibers` | `fiberActualDurations` | **Subtree cost** — total time under a fiber, including children. | `PerfFiberStat[]` |
| `topBySelf` | self-time | **What's actually expensive** — a fiber's own render time, children excluded. | `PerfFiberStat[]` |
| `triggers` | `updaters` | **Why it renders** — which components caused commits, and how wide the cascade was. | `PerfTriggerStat[]` |

```ts
type PerfFiberStat = {
  name: string;
  cumulativeMs: number;  // actualDuration (subtree) OR self-time, per list
  renderCount: number;
  avgMs: number;
};

type PerfTriggerStat = {
  name: string;
  timesTriggered: number;     // commits this component triggered (1 per commit)
  totalCommitMs: number;      // sum of those commits' total durations
  avgCascadeFibers: number;   // avg fibers re-rendered per triggered commit
};
```

## Per-dump vs rolling

`analyze()` runs on a single dump. The native layer then folds each result into
rolling aggregates keyed by component **name** (ids reset on reload).

```ts
// One dump, re-analysed on demand by getDumpSummary(name) / get-dump.
type PerfDumpSummary = {
  ingestedAt: number;   // epoch ms when native ingested this dump
  roots: number;
  commits: number;
  fiberRecords: number;
  reactCommitMs: number;
  wallSec: number;      // wall-clock span of the commits in this dump
  topFibers: PerfFiberStat[];
  topBySelf: PerfFiberStat[];
  triggers: PerfTriggerStat[];
};

// Accumulated across all retained dumps; survives Fast Refresh.
type PerfStats = {
  recording: boolean;        // JS loop believes it is recording (native-side copy omits this)
  dumpCount: number;
  totalReactCommitMs: number;
  totalCommits: number;
  topFibers: PerfFiberStat[];
  topBySelf: PerfFiberStat[];
  triggers: PerfTriggerStat[];
  lastDump: PerfDumpSummary | null;
};

// Disk ring-buffer listing (listDumps / list-dumps), newest first.
type PerfDumpListEntry = {
  name: string;        // "dump-1779830426509.json" — pass to getDumpSummary
  sizeBytes: number;
  ingestedAt: number;  // epoch ms parsed from the file name
};
```

> Note: the two `PerfStats` copies differ slightly — the expo package's type
> carries `recording` (the JS loop's view), the rozenite copy omits it because
> the panel reads only the native counters. Keep that intentional difference in
> mind when syncing.

## Keep the copies in sync

The contract exists in **three** places. When you change the V5 → stats analysis
or any JSON field, update **all** of them together:

1. `packages/expo-perf-recorder/android/.../PerfRecorderModule.kt` — the analysis + JSON it emits.
2. `packages/expo-perf-recorder/ios/PerfRecorderModule.swift` — must stay behaviour-equivalent to the Kotlin.
3. The mirrored TS types:
   - `packages/expo-perf-recorder/src/PerfRecorder.types.ts`
   - `packages/rozenite-perf-recorder/src/shared/messaging.ts` (standalone copy — the rozenite package imports nothing from the expo package).

A field added natively but not mirrored in both TS files will silently not reach
consumers with types.
