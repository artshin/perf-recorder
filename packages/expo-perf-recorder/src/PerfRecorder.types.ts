// Shared types for the perf-recorder module. These mirror the JSON contract
// between the JS capture layer and the native persist/analyze/stats layer.

/** A React DevTools v5 profiling export, as produced by `getProfilingData()`. */
export type V5Export = {
  version: 5;
  dataForRoots: unknown[];
  timelineData: unknown[];
};

export type PerfRecorderConfig = {
  /**
   * How often (ms) the capture loop stops, ships the window to native, and
   * re-arms. Bounds in-memory commit accumulation. Default 10000.
   */
  intervalMs?: number;
  /**
   * Restrict profiling to the main React Native renderer, skipping secondary
   * reconcilers (e.g. @shopify/react-native-skia). Default true — secondary
   * reconcilers have historically destabilised devtools attach on this app.
   */
  mainRendererOnly?: boolean;
  /** Max number of dump summaries the native ring buffer retains. Default 50. */
  maxDumps?: number;
};

/** One aggregated fiber across a dump (or rolling, keyed by name). */
export type PerfFiberStat = {
  name: string;
  /** Cumulative ms — actualDuration (subtree) or self-time, per list. */
  cumulativeMs: number;
  renderCount: number;
  avgMs: number;
};

/**
 * A component credited with triggering commits (from `updaters`). Answers "why
 * does this render happen" — distinct from the cost metrics above.
 */
export type PerfTriggerStat = {
  name: string;
  /** Commits this component triggered (counted once per commit). */
  timesTriggered: number;
  /** Sum of those commits' total durations, ms. */
  totalCommitMs: number;
  /** Average number of fibers re-rendered per triggered commit. */
  avgCascadeFibers: number;
};

/** One entry in the persisted ring-buffer listing (`listDumps`). */
export type PerfDumpListEntry = {
  /** File name, e.g. "dump-1779830426509.json". Pass to getDumpSummary. */
  name: string;
  sizeBytes: number;
  /** Epoch ms parsed from the file name. */
  ingestedAt: number;
};

/** Per-dump analysis result computed natively, off the JS thread. */
export type PerfDumpSummary = {
  /** Epoch ms when native ingested this dump. */
  ingestedAt: number;
  roots: number;
  commits: number;
  fiberRecords: number;
  reactCommitMs: number;
  /** Wall-clock span of the commits inside this dump, seconds. */
  wallSec: number;
  /** Top fibers by cumulative actualDuration (subtree cost). */
  topFibers: PerfFiberStat[];
  /** Top fibers by cumulative self-time ("what's actually expensive"). */
  topBySelf: PerfFiberStat[];
  /** Components that triggered commits ("why it renders"). */
  triggers: PerfTriggerStat[];
};

/** Rolling stats returned by `getStats()` — survives Fast Refresh. */
export type PerfStats = {
  /** Whether the JS capture loop currently believes it is recording. */
  recording: boolean;
  /** How many dumps native has ingested since the last clear. */
  dumpCount: number;
  /** Cumulative React commit work across all retained dumps, ms. */
  totalReactCommitMs: number;
  /** Cumulative commit count across all retained dumps. */
  totalCommits: number;
  /** Top fibers by cumulative actualDuration (subtree cost), by NAME. */
  topFibers: PerfFiberStat[];
  /** Top fibers by cumulative self-time ("what's actually expensive"), by NAME. */
  topBySelf: PerfFiberStat[];
  /** Components that triggered commits ("why it renders"), by NAME. */
  triggers: PerfTriggerStat[];
  /** Most recent per-dump summary, or null if none yet. */
  lastDump: PerfDumpSummary | null;
};
