// Exercises the capture loop against a fake __REACT_DEVTOOLS_GLOBAL_HOOK__:
// arming windows, collecting V5 exports, the main-renderer filter, name
// injection into snapshots, and the interval loop's re-arm behaviour. No real
// renderer, no native module.

import type { V5Export } from "../PerfRecorder.types";
import {
  armWindow,
  collectWindow,
  currentConfig,
  isRecording,
  startLoop,
  stopLoop,
} from "../capture";

type FakeRenderer = {
  startProfiling: jest.Mock;
  stopProfiling: jest.Mock;
  getProfilingData: jest.Mock;
  getDisplayNameForElementID?: jest.Mock;
};

/**
 * One root's profiling data with a single commit whose fiber `id` cost `ms`.
 * `injectNames` keys off `fiberActualDurations`, so that's what we populate.
 */
function rootWithFiber(id: number, ms: number) {
  return {
    commitData: [{ fiberActualDurations: [[id, ms]] }],
    snapshots: {},
  };
}

function makeRenderer(
  roots: unknown[],
  names: Record<number, string> = {},
): FakeRenderer {
  return {
    startProfiling: jest.fn(),
    stopProfiling: jest.fn(),
    getProfilingData: jest.fn(() => ({ dataForRoots: roots })),
    getDisplayNameForElementID: jest.fn((id: number) => names[id] ?? null),
  };
}

/** Install a hook exposing the given renderers under `packageName`. */
function installHook(
  ifaces: FakeRenderer[],
  packageName = "react-native-renderer",
) {
  const rendererInterfaces = new Map<number, FakeRenderer>();
  const renderers = new Map<number, { rendererPackageName: string }>();
  ifaces.forEach((iface, idx) => {
    rendererInterfaces.set(idx, iface);
    renderers.set(idx, { rendererPackageName: packageName });
  });
  const hook = {
    rendererInterfaces,
    renderers,
    // operations.ts subscribes on startLoop(); accept and ignore.
    sub: () => () => {},
  };
  (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  return hook;
}

afterEach(() => {
  // stopLoop() clears recording, the interval, and the started-renderer set.
  stopLoop();
  delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  jest.useRealTimers();
});

describe("armWindow", () => {
  it("starts profiling on an eligible main renderer", () => {
    const r = makeRenderer([rootWithFiber(2, 1)]);
    installHook([r]);
    expect(armWindow()).toBe(true);
    expect(r.startProfiling).toHaveBeenCalledWith(true);
  });

  it("returns false when no renderer is registered", () => {
    installHook([]);
    expect(armWindow()).toBe(false);
  });

  it("skips secondary reconcilers when mainRendererOnly is set (default)", () => {
    const skia = makeRenderer([rootWithFiber(2, 1)]);
    installHook([skia], "@shopify/react-native-skia");
    expect(armWindow()).toBe(false);
    expect(skia.startProfiling).not.toHaveBeenCalled();
  });
});

describe("collectWindow", () => {
  it("returns null when nothing was armed", () => {
    installHook([makeRenderer([])]);
    expect(collectWindow()).toBeNull();
  });

  it("stops profiling and returns a V5 export with the roots", () => {
    const r = makeRenderer([rootWithFiber(2, 1.5)]);
    installHook([r]);
    armWindow();

    const out = collectWindow() as V5Export;
    expect(r.stopProfiling).toHaveBeenCalledTimes(1);
    expect(out.version).toBe(5);
    expect(out.dataForRoots).toHaveLength(1);
  });

  it("injects names onto the first root's snapshots", () => {
    const r = makeRenderer([rootWithFiber(2, 1.5)], { 2: "HeavyItem" });
    installHook([r]);
    armWindow();

    const out = collectWindow() as V5Export;
    const root = out.dataForRoots[0] as {
      snapshots: Record<number, { displayName: string }>;
    };
    expect(root.snapshots[2]).toMatchObject({ displayName: "HeavyItem" });
  });

  it("clears the armed set so a second collect returns null", () => {
    installHook([makeRenderer([rootWithFiber(2, 1)])]);
    armWindow();
    expect(collectWindow()).not.toBeNull();
    expect(collectWindow()).toBeNull();
  });
});

describe("startLoop / stopLoop", () => {
  it("arms immediately and ships a window on each interval tick", () => {
    jest.useFakeTimers();
    const r = makeRenderer([rootWithFiber(2, 1)], { 2: "App" });
    installHook([r]);
    const onWindow = jest.fn();

    expect(startLoop(onWindow, { intervalMs: 1000 })).toBe(true);
    expect(isRecording()).toBe(true);
    expect(r.startProfiling).toHaveBeenCalledTimes(1); // armed up front

    jest.advanceTimersByTime(1000);
    expect(onWindow).toHaveBeenCalledTimes(1);
    const shipped = onWindow.mock.calls[0][0] as V5Export;
    expect(shipped.version).toBe(5);
    expect(r.startProfiling).toHaveBeenCalledTimes(2); // re-armed after collect
  });

  it("does not ship empty windows", () => {
    jest.useFakeTimers();
    installHook([makeRenderer([])]); // renderer yields no roots
    const onWindow = jest.fn();
    startLoop(onWindow, { intervalMs: 1000 });

    jest.advanceTimersByTime(3000);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it("returns false but keeps recording when no renderer is attached yet", () => {
    jest.useFakeTimers();
    installHook([]); // agent not attached
    const onWindow = jest.fn();

    expect(startLoop(onWindow, { intervalMs: 1000 })).toBe(false);
    expect(isRecording()).toBe(true); // loop scheduled, will retry to arm
  });

  it("merges config overrides onto defaults", () => {
    jest.useFakeTimers();
    installHook([makeRenderer([rootWithFiber(2, 1)])]);
    startLoop(jest.fn(), { intervalMs: 5000 });
    expect(currentConfig()).toMatchObject({
      intervalMs: 5000,
      mainRendererOnly: true, // untouched default
      maxDumps: 50,
    });
  });

  it("is idempotent — a second startLoop does not re-arm", () => {
    jest.useFakeTimers();
    const r = makeRenderer([rootWithFiber(2, 1)]);
    installHook([r]);
    const onWindow = jest.fn();
    startLoop(onWindow, { intervalMs: 1000 });
    expect(startLoop(onWindow, { intervalMs: 1000 })).toBe(true);
    expect(r.startProfiling).toHaveBeenCalledTimes(1);
  });

  it("stopLoop stops recording and returns the final partial window", () => {
    jest.useFakeTimers();
    const r = makeRenderer([rootWithFiber(2, 1)]);
    installHook([r]);
    startLoop(jest.fn(), { intervalMs: 1000 });

    const tail = stopLoop();
    expect(isRecording()).toBe(false);
    expect(tail).not.toBeNull();
    expect((tail as V5Export).version).toBe(5);
  });
});
