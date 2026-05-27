// Exercises the in-process React DevTools "operations" stream decoder. The
// decoder is private; we drive it through the public surface exactly as the app
// does — install a fake __REACT_DEVTOOLS_GLOBAL_HOOK__, subscribe via
// startOperationsCapture(), emit operations frames, then read nameMap() /
// snapshotMap(). Frame layout is verified against react-devtools-core@7.0.1.

import {
  nameMap,
  resetOperations,
  snapshotMap,
  startOperationsCapture,
  stopOperationsCapture,
} from "../operations";

const TREE_OPERATION_ADD = 1;
const TREE_OPERATION_REMOVE = 2;
const ElementTypeRoot = 11;
const ElementTypeFunction = 5;

type Listener = (payload: unknown) => void;

/** Minimal emitter hook matching the `sub`/`off` shape operations.ts expects. */
function installHook() {
  const listeners: Record<string, Listener[]> = {};
  const hook = {
    sub(event: string, fn: Listener) {
      (listeners[event] ??= []).push(fn);
      return () => {
        listeners[event] = (listeners[event] ?? []).filter((l) => l !== fn);
      };
    },
    emit(event: string, payload: unknown) {
      for (const l of listeners[event] ?? []) l(payload);
    },
  };
  (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  return hook;
}

/** Encode a string for the operations string table: [len, ...codepoints]. */
function encodeString(s: string): number[] {
  const points = [...s].map((c) => c.codePointAt(0)!);
  return [len(points), ...points];
}
function len(a: unknown[]): number {
  return a.length;
}

/**
 * Build one operations frame: a 2-int header, a string table, then ops.
 * `strings` are 1-indexed in the resulting table (index 0 is always null).
 */
function frame(strings: string[], ops: number[]): number[] {
  const table = strings.flatMap(encodeString);
  return [1, 1, table.length, ...table, ...ops];
}

/** ADD for a non-root element. stringIDs are 1-based indices into `strings`. */
function addElement(
  id: number,
  parentID: number,
  displayNameStringID: number,
  keyStringID = 0,
): number[] {
  // op, id, type, parentID, ownerID, displayNameStringID, keyStringID, namePropStringID
  return [
    TREE_OPERATION_ADD,
    id,
    ElementTypeFunction,
    parentID,
    parentID,
    displayNameStringID,
    keyStringID,
    0,
  ];
}

/** ADD for a root: op, id, type=root, then 4 root-metadata ints. */
function addRoot(id: number): number[] {
  return [TREE_OPERATION_ADD, id, ElementTypeRoot, 0, 0, 0, 0];
}

let hook: ReturnType<typeof installHook>;

beforeEach(() => {
  resetOperations();
  hook = installHook();
  startOperationsCapture();
});

afterEach(() => {
  stopOperationsCapture();
  resetOperations();
  delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
});

describe("operations decoder", () => {
  it("records id → displayName and full node metadata from element ADDs", () => {
    hook.emit(
      "operations",
      frame(
        ["App", "Foo"],
        [...addRoot(1), ...addElement(2, 1, 1), ...addElement(3, 2, 2)],
      ),
    );

    expect(nameMap()).toEqual({ 2: "App", 3: "Foo" });
    expect(snapshotMap()).toEqual({
      2: {
        displayName: "App",
        key: null,
        type: ElementTypeFunction,
        parentID: 1,
      },
      3: {
        displayName: "Foo",
        key: null,
        type: ElementTypeFunction,
        parentID: 2,
      },
    });
  });

  it("resolves keys from the string table", () => {
    // strings: 1="Row", 2="row-7" (the key)
    hook.emit("operations", frame(["Row", "row-7"], addElement(2, 1, 1, 2)));
    expect(snapshotMap()[2]).toMatchObject({
      displayName: "Row",
      key: "row-7",
    });
  });

  it("does not record a root as a named node", () => {
    hook.emit("operations", frame([], addRoot(1)));
    expect(snapshotMap()).toEqual({});
    expect(nameMap()).toEqual({});
  });

  it("keeps the cursor aligned across a REMOVE op", () => {
    // ADD id=2, then REMOVE 1 element (id 2), then ADD id=3 — the decoder must
    // skip `2 + count` ints for REMOVE and still parse the trailing ADD.
    const remove = [TREE_OPERATION_REMOVE, 1, 2];
    hook.emit(
      "operations",
      frame(
        ["App", "Bar"],
        [...addElement(2, 1, 1), ...remove, ...addElement(3, 1, 2)],
      ),
    );
    expect(nameMap()).toEqual({ 2: "App", 3: "Bar" });
  });

  it("bails on an unknown opcode but keeps names captured before it", () => {
    const UNKNOWN = 99;
    hook.emit(
      "operations",
      frame(
        ["App", "Lost"],
        [...addElement(2, 1, 1), UNKNOWN, ...addElement(3, 1, 2)],
      ),
    );
    // "App" was parsed before the bad opcode; the trailing ADD is abandoned.
    expect(nameMap()).toEqual({ 2: "App" });
  });

  it("accumulates names across multiple frames in one session", () => {
    hook.emit("operations", frame(["App"], addElement(2, 1, 1)));
    hook.emit("operations", frame(["Foo"], addElement(3, 1, 1)));
    expect(nameMap()).toEqual({ 2: "App", 3: "Foo" });
  });

  it("swallows malformed frames without throwing or recording", () => {
    expect(() => {
      hook.emit("operations", null);
      hook.emit("operations", [1, 1]); // too short (< 3)
      hook.emit("operations", "not-an-array");
      hook.emit("operations", {});
    }).not.toThrow();
    expect(nameMap()).toEqual({});
  });

  it("resetOperations clears all captured state", () => {
    hook.emit("operations", frame(["App"], addElement(2, 1, 1)));
    expect(nameMap()).not.toEqual({});
    resetOperations();
    expect(nameMap()).toEqual({});
    expect(snapshotMap()).toEqual({});
  });
});
