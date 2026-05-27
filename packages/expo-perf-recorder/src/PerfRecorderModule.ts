import { NativeModule, requireNativeModule } from "expo";

// Native bridge. All heavy work (disk ring buffer, per-dump analysis, rolling
// stats) lives behind these async functions and runs on a background thread in
// Kotlin/Swift — the JS thread only serialises a dump and hands it over.
declare class PerfRecorderModule extends NativeModule {
  /** Configure the native ring buffer. Safe to call repeatedly. */
  configure(maxDumps: number): Promise<void>;
  /**
   * Ingest one V5 profiling export (as a JSON string). Native parses,
   * analyses, appends a summary to the ring buffer, and folds the result into
   * rolling stats. Resolves once persisted.
   */
  ingestDump(json: string): Promise<void>;
  /** Current rolling stats as a JSON string (see PerfStats). */
  getStats(): Promise<string>;
  /** Reset the ring buffer and rolling stats. */
  clear(): Promise<void>;
  /**
   * List persisted raw dumps in the disk ring buffer, newest first, as a JSON
   * string (array of PerfDumpListEntry).
   */
  listDumps(): Promise<string>;
  /**
   * Re-analyse one persisted dump by file name (e.g. "dump-123.json"); returns
   * a PerfDumpSummary JSON string, or "null" if missing / invalid name.
   */
  getDumpSummary(name: string): Promise<string>;
}

export default requireNativeModule<PerfRecorderModule>("PerfRecorder");
