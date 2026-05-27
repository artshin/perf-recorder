import { requireNativeModule } from "expo";

// The SAME native module the perf-recorder app module owns, reached by its
// registered name so this package imports nothing from the app.
export type NativePerfRecorder = {
  getStats(): Promise<string>;
  clear(): Promise<void>;
  listDumps(): Promise<string>;
  getDumpSummary(name: string): Promise<string>;
};

let _native: NativePerfRecorder | null | undefined;

export function nativePerfRecorder(): NativePerfRecorder | null {
  if (_native !== undefined) return _native;
  try {
    _native = requireNativeModule(
      "PerfRecorder",
    ) as unknown as NativePerfRecorder;
  } catch {
    _native = null;
  }
  return _native;
}
