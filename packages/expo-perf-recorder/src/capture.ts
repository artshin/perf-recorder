// Self-contained capture layer. Taps __REACT_DEVTOOLS_GLOBAL_HOOK__ directly —
// no WebSocket, no Metro middleware, no dependency on the app's lib/profiler.ts.
// Runs a continuous loop: every `intervalMs` it stops the current profiling
// window, hands the V5 export to native (which persists + analyses off-thread),
// then re-arms a fresh window so in-memory commit data never grows unbounded.
//
// This is the ONLY half that must run inside the app's JS runtime: the timing
// data lives in React's in-memory fiber tree, reachable solely through the
// devtools hook. Persistence, analysis and stats all live in the native module.

import type { PerfRecorderConfig, V5Export } from "./PerfRecorder.types";
import {
  snapshotMap,
  startOperationsCapture,
  stopOperationsCapture,
  type SnapshotNode,
} from "./operations";

type RendererInterface = {
  startProfiling: (recordChangeDescriptions: boolean) => void;
  stopProfiling: () => void;
  getProfilingData: () => { dataForRoots: unknown[] };
  // Resolves a fiber's displayName straight from the renderer's live instance
  // map (react-devtools-core backend). Unlike the operations stream, it covers
  // the initial-mount subtree, so we use it as the primary name source.
  getDisplayNameForElementID?: (id: number) => string | null;
};

type ReactRenderer = {
  rendererPackageName?: string;
  version?: string;
  reconcilerVersion?: string;
};

type DevToolsHook = {
  rendererInterfaces?: Map<number, RendererInterface>;
  renderers?: Map<number, ReactRenderer>;
  inject?: (renderer: ReactRenderer) => number;
  onCommitFiberRoot?: (
    rendererID: number,
    root: unknown,
    priority?: unknown,
    ...rest: unknown[]
  ) => unknown;
};

function hook(): DevToolsHook | undefined {
  return (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
}

// react-native-renderer / react-dom are the "main" trees; secondary reconcilers
// (e.g. @shopify/react-native-skia) register under their own package names.
const MAIN_RENDERER_PACKAGES = new Set(["react-native-renderer", "react-dom"]);

function isMainRenderer(rendererID: number): boolean {
  const pkg = hook()?.renderers?.get(rendererID)?.rendererPackageName;
  return pkg ? MAIN_RENDERER_PACKAGES.has(pkg) : false;
}

// devtools-core 7.x runs semver gte(renderer.version, ...) on attach; secondary
// reconcilers inject with no version → "Invalid argument not valid semver".
// Backfill a valid version before any agent reads it. Dev-only, harmless.
const SEMVER_RE = /^\d+\.\d+\.\d+/;
let injectPatched = false;

function isValidVersion(v: unknown): v is string {
  return typeof v === "string" && SEMVER_RE.test(v);
}

function fixRendererVersion(r: ReactRenderer | undefined): void {
  if (!r) return;
  if (!isValidVersion(r.version)) {
    r.version = isValidVersion(r.reconcilerVersion)
      ? r.reconcilerVersion
      : "19.0.0";
  }
  if (!isValidVersion(r.reconcilerVersion)) r.reconcilerVersion = r.version;
}

function patchRendererVersions(): void {
  const h = hook();
  if (!h) return;
  h.renderers?.forEach((r) => fixRendererVersion(r));
  const origInject = h.inject;
  if (origInject && !injectPatched) {
    injectPatched = true;
    h.inject = (renderer: ReactRenderer) => {
      fixRendererVersion(renderer);
      return origInject.call(h, renderer);
    };
  }
}

// --- recording state --------------------------------------------------------
let recording = false;
let loopTimer: ReturnType<typeof setInterval> | null = null;
let config: Required<PerfRecorderConfig> = {
  intervalMs: 10000,
  mainRendererOnly: true,
  maxDumps: 50,
};

// Renderer interfaces we've actually called startProfiling on. A second
// startProfiling wipes a renderer's buffer, and getProfilingData on an
// unstarted renderer returns null — so track precisely which ones are live.
const startedRenderers = new Set<RendererInterface>();

function eligibleInterfaces(): RendererInterface[] {
  const h = hook();
  if (!h?.rendererInterfaces) return [];
  const out: RendererInterface[] = [];
  for (const [id, iface] of h.rendererInterfaces.entries()) {
    if (config.mainRendererOnly && !isMainRenderer(id)) continue;
    out.push(iface);
  }
  return out;
}

function startNewRenderers(): number {
  let started = 0;
  for (const r of eligibleInterfaces()) {
    if (startedRenderers.has(r)) continue;
    try {
      r.startProfiling(true);
      startedRenderers.add(r);
      started++;
    } catch (e) {
      console.warn("[perf-recorder] startProfiling failed", e);
    }
  }
  return started;
}

function stopAndCollect(): V5Export {
  const dataForRoots: unknown[] = [];
  for (const r of startedRenderers) {
    try {
      r.stopProfiling();
    } catch (e) {
      console.warn("[perf-recorder] stopProfiling failed", e);
    }
    const data = r.getProfilingData?.();
    if (data && Array.isArray(data.dataForRoots)) {
      injectNames(r, data.dataForRoots);
      dataForRoots.push(...data.dataForRoots);
    }
  }
  startedRenderers.clear();
  return { version: 5, dataForRoots, timelineData: [] };
}

type CommitWithFibers = { fiberActualDurations?: [number, number][] };
type RootWithCommits = {
  commitData?: CommitWithFibers[];
  snapshots?: Record<string, unknown>;
};

// Build a `snapshots` map naming every fiber that has timing in this window, so
// native (and the CLI) can name heavy fibers. getProfilingData() leaves
// `snapshots` empty here. Each id is named from:
//   (a) the operations-decoded map — also carries key/type/parentID; or
//   (b) the renderer's getDisplayNameForElementID(), resolved from the live
//       instance map, which covers the INITIAL-MOUNT subtree the incremental
//       operations stream never delivers (the main source of "(unnamed)").
// element ids are unique within a renderer, so injecting onto the first root is
// enough — the native side flattens every root's snapshots into one id→name map.
function injectNames(r: RendererInterface, roots: unknown[]): void {
  if (roots.length === 0) return;

  const ids = new Set<number>();
  for (const root of roots) {
    for (const c of (root as RootWithCommits).commitData ?? []) {
      for (const pair of c.fiberActualDurations ?? []) {
        if (Array.isArray(pair) && pair.length > 0) ids.add(pair[0]);
      }
    }
  }
  if (ids.size === 0) return;

  const opMap = snapshotMap();
  const getName =
    typeof r.getDisplayNameForElementID === "function"
      ? r.getDisplayNameForElementID.bind(r)
      : null;

  const snapshots: Record<number, SnapshotNode> = {};
  for (const id of ids) {
    const op = opMap[id];
    if (op?.displayName) {
      snapshots[id] = op; // best: name + key/type/parentID from operations
      continue;
    }
    let name: string | null = null;
    if (getName) {
      try {
        name = getName(id);
      } catch {
        name = null;
      }
    }
    if (name) {
      snapshots[id] = op
        ? { ...op, displayName: name }
        : { displayName: name, key: null, type: 0, parentID: 0 };
    } else if (op) {
      snapshots[id] = op;
    }
  }

  const first = roots[0] as RootWithCommits;
  first.snapshots = { ...snapshots, ...(first.snapshots ?? {}) };
}

/** Whether the capture loop is currently recording. */
export function isRecording(): boolean {
  return recording;
}

/**
 * Stop the current window and return its V5 export WITHOUT re-arming. Used by
 * the loop tick and by stop(). Returns null if nothing was being recorded.
 */
export function collectWindow(): V5Export | null {
  if (startedRenderers.size === 0) return null;
  return stopAndCollect();
}

/**
 * Begin a fresh profiling window across all eligible renderers. Returns true if
 * at least one renderer was armed.
 */
export function armWindow(): boolean {
  patchRendererVersions();
  return startNewRenderers() > 0 || startedRenderers.size > 0;
}

/**
 * Start the continuous capture loop. `onWindow` is invoked with each collected
 * V5 export at the configured interval — the caller ships it to native.
 */
export function startLoop(
  onWindow: (data: V5Export) => void,
  overrides?: PerfRecorderConfig,
): boolean {
  if (recording) return true;
  config = { ...config, ...overrides };
  // Begin name capture immediately so fibers are named as soon as the devtools
  // agent attaches, independent of when the first renderer arms.
  startOperationsCapture();
  if (!armWindow()) {
    // No renderer registered yet (devtools agent not attached). Keep trying on
    // the loop interval — the main renderer often appears a few hundred ms in.
    recording = true;
    scheduleLoop(onWindow);
    return false;
  }
  recording = true;
  scheduleLoop(onWindow);
  return true;
}

function scheduleLoop(onWindow: (data: V5Export) => void): void {
  if (loopTimer) return;
  loopTimer = setInterval(() => {
    if (!recording) return;
    const data = collectWindow();
    // Re-arm immediately so the gap between windows is minimal.
    armWindow();
    if (data && (data.dataForRoots as unknown[]).length > 0) onWindow(data);
  }, config.intervalMs);
}

/** Stop the loop. Returns the final partial window (may be null). */
export function stopLoop(): V5Export | null {
  recording = false;
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  const tail = collectWindow();
  stopOperationsCapture();
  return tail;
}

export function currentConfig(): Required<PerfRecorderConfig> {
  return config;
}
