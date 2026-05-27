// Public surface of the perf-recorder module.
//
// Two ways to use it:
//   1. Zero-integration: `import "@artshin/expo-perf-recorder/auto";` once in your
//      entry (dev-only auto-start). See ./auto.ts.
//   2. Programmatic: start/stop/getStats/clear from app code or a dev screen.
export {
  startPerfRecorder,
  stopPerfRecorder,
  getPerfStats,
  clearPerfData,
} from "./src";
export { PerfOverlay } from "./src/overlay/PerfOverlay";
export type {
  PerfRecorderConfig,
  PerfStats,
  PerfDumpSummary,
  PerfDumpListEntry,
  PerfFiberStat,
  PerfTriggerStat,
} from "./src/PerfRecorder.types";
export { default as PerfRecorderModule } from "./src/PerfRecorderModule";
