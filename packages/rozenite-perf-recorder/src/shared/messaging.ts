import type { RozeniteDevToolsClient } from "@rozenite/plugin-bridge";

// Mirrors the native PerfRecorder stats contract (see
// @artshin/expo-perf-recorder's src/PerfRecorder.types.ts). Kept as a standalone
// copy so this package has no dependency on the native module package.
export type PerfFiberStat = {
  name: string;
  cumulativeMs: number;
  renderCount: number;
  avgMs: number;
};

export type PerfTriggerStat = {
  name: string;
  timesTriggered: number;
  totalCommitMs: number;
  avgCascadeFibers: number;
};

export type PerfDumpSummary = {
  ingestedAt: number;
  roots: number;
  commits: number;
  fiberRecords: number;
  reactCommitMs: number;
  wallSec: number;
  topFibers: PerfFiberStat[];
  topBySelf: PerfFiberStat[];
  triggers: PerfTriggerStat[];
};

export type PerfStats = {
  dumpCount: number;
  totalCommits: number;
  totalReactCommitMs: number;
  topFibers: PerfFiberStat[];
  topBySelf: PerfFiberStat[];
  triggers: PerfTriggerStat[];
  lastDump: PerfDumpSummary | null;
};

export type PerfDumpListEntry = {
  name: string;
  sizeBytes: number;
  ingestedAt: number;
};

export type PerfRecorderPluginEventMap = {
  /** app → panel: latest rolling stats. */
  stats: PerfStats;
  /** panel → app: ask for an immediate stats push. */
  "request-stats": undefined;
  /** panel → app: reset the native ring buffer + rolling stats. */
  clear: undefined;
};

export type PerfRecorderPluginClient =
  RozeniteDevToolsClient<PerfRecorderPluginEventMap>;

export const PLUGIN_ID = "@artshin/rozenite-perf-recorder";
