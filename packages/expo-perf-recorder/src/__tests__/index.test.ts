// Public API: dev-only gating (the documented invariant — no-op in production)
// and the thin proxying to the native module. The native module is mocked, so
// these run in node without expo's requireNativeModule.

// `mock`-prefixed names are allowed inside a jest.mock factory.
const mockNative = {
  configure: jest.fn().mockResolvedValue(undefined),
  ingestDump: jest.fn().mockResolvedValue(undefined),
  getStats: jest.fn(),
  clear: jest.fn().mockResolvedValue(undefined),
  listDumps: jest.fn(),
  getDumpSummary: jest.fn(),
};

jest.mock("../PerfRecorderModule", () => ({
  __esModule: true,
  default: mockNative,
}));

const STATS_JSON = JSON.stringify({
  dumpCount: 3,
  totalCommits: 12,
  totalReactCommitMs: 7.5,
  topFibers: [],
  topBySelf: [],
  triggers: [],
  lastDump: null,
});

type IndexModule = typeof import("../index");

/** Load a fresh copy of index.ts with a chosen __DEV__, isolating its state. */
function loadIndex(dev: boolean): IndexModule {
  (globalThis as Record<string, unknown>).__DEV__ = dev;
  let mod!: IndexModule;
  jest.isolateModules(() => {
    mod = require("../index");
  });
  return mod;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.getStats.mockResolvedValue(STATS_JSON);
});

afterEach(() => {
  jest.useRealTimers();
  delete (globalThis as Record<string, unknown>).__DEV__;
});

describe("startPerfRecorder (dev gating)", () => {
  it("is a no-op in production (__DEV__ false)", async () => {
    const mod = loadIndex(false);
    await mod.startPerfRecorder();
    expect(mockNative.configure).not.toHaveBeenCalled();
  });

  it("configures native and begins recording in dev", async () => {
    jest.useFakeTimers();
    const mod = loadIndex(true);
    await mod.startPerfRecorder({ maxDumps: 25 });
    expect(mockNative.configure).toHaveBeenCalledWith(25);
    await mod.stopPerfRecorder(); // tear down the scheduled loop
  });

  it("survives a native configure rejection", async () => {
    jest.useFakeTimers();
    mockNative.configure.mockRejectedValueOnce(new Error("native boom"));
    const mod = loadIndex(true);
    await expect(mod.startPerfRecorder()).resolves.toBeUndefined();
    await mod.stopPerfRecorder();
  });
});

describe("getPerfStats", () => {
  it("parses the native JSON and stamps the JS recording flag", async () => {
    const mod = loadIndex(false); // not started → recording false
    const stats = await mod.getPerfStats();
    expect(stats).toMatchObject({
      dumpCount: 3,
      totalCommits: 12,
      recording: false,
    });
    expect(mockNative.getStats).toHaveBeenCalledTimes(1);
  });
});

describe("clearPerfData", () => {
  it("delegates to the native clear()", async () => {
    const mod = loadIndex(true);
    await mod.clearPerfData();
    expect(mockNative.clear).toHaveBeenCalledTimes(1);
  });
});

describe("stopPerfRecorder", () => {
  it("is a no-op when never started", async () => {
    const mod = loadIndex(true);
    await mod.stopPerfRecorder();
    expect(mockNative.ingestDump).not.toHaveBeenCalled();
  });
});
