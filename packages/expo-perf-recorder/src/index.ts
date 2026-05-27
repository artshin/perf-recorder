import type {
  PerfRecorderConfig,
  PerfStats,
  V5Export,
} from "./PerfRecorder.types";
import PerfRecorderModule from "./PerfRecorderModule";
import { startLoop, stopLoop, isRecording, currentConfig } from "./capture";

declare const __DEV__: boolean;

let started = false;

function shipToNative(data: V5Export): void {
  // Fire-and-forget: serialise on the JS thread, hand the string to native,
  // which parses + analyses + persists on a background thread.
  PerfRecorderModule.ingestDump(JSON.stringify(data)).catch((e) => {
    console.warn("[perf-recorder] ingestDump failed", e);
  });
}

/**
 * Start continuous background profiling. Dev-only and idempotent. The capture
 * loop runs in JS (reading React's fiber tree); persistence, analysis and stats
 * are handled natively, off the JS thread.
 */
export async function startPerfRecorder(
  config?: PerfRecorderConfig,
): Promise<void> {
  if (!__DEV__ || started) return;
  started = true;
  try {
    await PerfRecorderModule.configure(
      config?.maxDumps ?? currentConfig().maxDumps,
    );
  } catch (e) {
    console.warn("[perf-recorder] native configure failed", e);
  }
  startLoop(shipToNative, config);
  console.log("[perf-recorder] started (continuous, dev-only)");
}

/** Stop the loop and ship the final partial window. */
export async function stopPerfRecorder(): Promise<void> {
  if (!started) return;
  started = false;
  const tail = stopLoop();
  if (tail && (tail.dataForRoots as unknown[]).length > 0) shipToNative(tail);
  console.log("[perf-recorder] stopped");
}

/** Current rolling stats (survives Fast Refresh — held natively). */
export async function getPerfStats(): Promise<PerfStats> {
  const raw = await PerfRecorderModule.getStats();
  const parsed = JSON.parse(raw) as Omit<PerfStats, "recording">;
  return { ...parsed, recording: isRecording() };
}

/** Reset the native ring buffer and rolling stats. */
export async function clearPerfData(): Promise<void> {
  await PerfRecorderModule.clear();
}

export type {
  PerfRecorderConfig,
  PerfStats,
  PerfDumpSummary,
  PerfFiberStat,
} from "./PerfRecorder.types";
