// In-app decoder for the React DevTools "operations" stream.
//
// `getProfilingData()` omits the id→displayName map in this RN setup
// (`snapshots: 0`). Those names only ever travel inside the DevTools operations
// protocol. scripts/profile-sink.js decodes that stream OUT of process over a
// WebSocket; here we do the same thing IN process by subscribing to the hook's
// `operations` event — no WS, no Metro middleware. We build a session-scoped
// id → { displayName, key, type, parentID } table that capture.ts injects into
// each dump's `snapshots` before shipping to native, so heavy fibers get named.
//
// Opcodes verified against react-devtools-core@7.0.1 (store.js decoder /
// fiber/renderer.js encoder) — identical to scripts/profile-sink.js.

const TREE_OPERATION_ADD = 1;
const TREE_OPERATION_REMOVE = 2;
const TREE_OPERATION_REORDER_CHILDREN = 3;
const TREE_OPERATION_UPDATE_TREE_BASE_DURATION = 4;
const TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS = 5;
const TREE_OPERATION_REMOVE_ROOT = 6;
const TREE_OPERATION_SET_SUBTREE_MODE = 7;
const SUSPENSE_TREE_OPERATION_ADD = 8;
const SUSPENSE_TREE_OPERATION_REMOVE = 9;
const SUSPENSE_TREE_OPERATION_SUSPENDERS = 12;
const ElementTypeRoot = 11;

export type SnapshotNode = {
  displayName: string | null;
  key: string | null;
  type: number;
  parentID: number;
};

type EmitterHook = {
  sub?: (event: string, fn: (payload: unknown) => void) => () => void;
  on?: (event: string, fn: (payload: unknown) => void) => void;
  off?: (event: string, fn: (payload: unknown) => void) => void;
};

function hook(): EmitterHook | undefined {
  return (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: EmitterHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
}

// Session-scoped maps. Element ids are stable within one JS session and reset on
// reload (which restarts JS and this module), so a single growing map per
// session is correct.
let idToName: Record<number, string> = {};
let nodes: Record<number, SnapshotNode> = {};

let unsubscribe: (() => void) | null = null;
let listener: ((payload: unknown) => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function decodeString(arr: number[], left: number, right: number): string {
  let s = "";
  for (let i = left; i <= right; i++) s += String.fromCodePoint(arr[i]);
  return s;
}

// Walk one operations payload exactly as Store.onBridgeOperations does, recording
// displayName/key/type/parentID from element ADDs. Other opcodes are walked only
// to keep the cursor aligned; on an unknown opcode we bail this frame (cursor
// would desync) but keep everything captured so far.
function decodeOperations(ops: number[]): void {
  if (!Array.isArray(ops) || ops.length < 3) return;

  const stringTable: (string | null)[] = [null]; // 1-indexed; 0 === null
  let i = 2;
  const stringTableSize = ops[i++];
  const stringTableEnd = i + stringTableSize;
  while (i < stringTableEnd) {
    const len = ops[i++];
    stringTable.push(decodeString(ops, i, i + len - 1));
    i += len;
  }

  while (i < ops.length) {
    const op = ops[i];
    switch (op) {
      case TREE_OPERATION_ADD: {
        const id = ops[i + 1];
        const type = ops[i + 2];
        i += 3;
        if (type === ElementTypeRoot) {
          i += 4; // strictMode, profilerFlags, supportsStrictMode, hasOwnerMetadata
        } else {
          // parentID, ownerID, displayNameStringID, keyStringID, namePropStringID
          const parentID = ops[i];
          const name = stringTable[ops[i + 2]] ?? null;
          const key = stringTable[ops[i + 3]] ?? null;
          if (name != null) idToName[id] = name;
          nodes[id] = { displayName: name, key, type, parentID };
          i += 5;
        }
        break;
      }
      case TREE_OPERATION_REMOVE:
        i += 2 + ops[i + 1];
        break;
      case TREE_OPERATION_REMOVE_ROOT:
        i += 1;
        break;
      case TREE_OPERATION_REORDER_CHILDREN:
        i += 3 + ops[i + 2];
        break;
      case TREE_OPERATION_SET_SUBTREE_MODE:
        i += 3;
        break;
      case TREE_OPERATION_UPDATE_TREE_BASE_DURATION:
        i += 3;
        break;
      case TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS:
        i += 4;
        break;
      case SUSPENSE_TREE_OPERATION_ADD: {
        const numRects = ops[i + 5];
        i += 6 + (numRects === -1 ? 0 : numRects * 4);
        break;
      }
      case SUSPENSE_TREE_OPERATION_REMOVE:
        i += 2 + ops[i + 1];
        break;
      case SUSPENSE_TREE_OPERATION_SUSPENDERS: {
        i += 1;
        const changeLength = ops[i++];
        for (let c = 0; c < changeLength; c++) {
          i += 3; // id, hasUniqueSuspenders, isSuspended
          i += 1 + ops[i]; // environmentNamesLength, ...stringIDs
        }
        break;
      }
      default:
        return; // unknown opcode — bail this frame, keep captured names
    }
  }
}

/** Subscribe to the hook's operations event. Retries until the hook exists. */
export function startOperationsCapture(): void {
  if (unsubscribe || listener) return;
  const h = hook();
  if (!h) {
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        startOperationsCapture();
      }, 200);
    }
    return;
  }
  listener = (payload: unknown) => {
    try {
      if (Array.isArray(payload)) decodeOperations(payload as number[]);
    } catch {
      // never let a malformed frame break the dev app
    }
  };
  if (typeof h.sub === "function") {
    unsubscribe = h.sub("operations", listener);
  } else if (typeof h.on === "function") {
    h.on("operations", listener);
    unsubscribe = () => h.off?.("operations", listener!);
  }
}

export function stopOperationsCapture(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  listener = null;
}

/** Snapshot map keyed by element id, in DevTools SnapshotNode-ish shape. */
export function snapshotMap(): Record<number, SnapshotNode> {
  return nodes;
}

export function nameMap(): Record<number, string> {
  return idToName;
}

/** Reset captured state (e.g. on a fresh recording session). */
export function resetOperations(): void {
  idToName = {};
  nodes = {};
}
