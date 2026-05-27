# Testing

Tests live in `packages/expo-perf-recorder/src/__tests__/` and cover the **pure
JS capture layer** — the half with non-trivial logic that runs in the app's JS
runtime. The native (Kotlin / Swift) analysis and the Rozenite package are not
covered by these JS tests (see [Scope](#scope)).

```bash
yarn workspace @artshin/expo-perf-recorder test            # all suites
yarn workspace @artshin/expo-perf-recorder test -- -t "…"  # one test by name
yarn workspace @artshin/expo-perf-recorder test capture    # one file
```

## What's covered

| Suite | Target | What it asserts |
|-------|--------|-----------------|
| `operations.test.ts` | `operations.ts` decoder | The DevTools operations-stream decoder: id→name + node metadata from element ADDs, key resolution, cursor alignment across `REMOVE`, graceful bail on unknown opcodes, multi-frame accumulation, and that malformed frames never throw. |
| `capture.test.ts` | `capture.ts` loop | Arming windows, the main-renderer filter, collecting a V5 export, name injection into `snapshots`, the interval loop's ship + re-arm, empty-window suppression, idempotent start, and `stopLoop`'s final partial window. |
| `index.test.ts` | `index.ts` public API | The dev-only gating invariant (no-op when `__DEV__` is false), native `configure`/`clear` proxying, `getPerfStats` parsing + the JS `recording` stamp, and resilience to a native `configure` rejection. |

These suites drive the code exactly as the app does: they install a fake
`__REACT_DEVTOOLS_GLOBAL_HOOK__` on `globalThis` and read back through the public
exports, rather than reaching into private functions.

## How the runner is configured

`packages/expo-perf-recorder/jest.config.js` deliberately **does not** use the
`jest-expo` preset. The hoisted `react-native@0.85` moved its Jest preset to a
separate package, which `jest-expo@53` (built for RN 0.79) can't load — the same
version skew documented elsewhere in this repo. The capture-layer tests need no
React Native runtime, so the config runs **`ts-jest` in a plain `node`
environment** with `isolatedModules` (transpile-only).

Consequence: tests do **not** type-check. Type-checking is a separate gate
(`yarn typecheck` → `expo-module build`). Keep both green.

## Scope

- **Native analysis** (`PerfRecorderModule.kt` / `.swift`) — the V5 → stats
  computation — is not exercised here. If you change it, the JS tests won't catch
  a regression; verify against the example app (`apps/example`) on a device, and
  remember the Kotlin and Swift sides must stay behaviour-equivalent (see
  [data-contract.md](data-contract.md)).
- **`rozenite-perf-recorder`** is almost entirely declarative agent-tool
  contracts, native proxies, and a React DOM panel — no standalone logic that
  repays unit tests today. Add tests there if real logic lands.

## Adding a test

Drop a `*.test.ts` into `src/__tests__/`. For anything touching the devtools
hook, install a fake on `globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__` in
`beforeEach` and remove it in `afterEach`; reset module singletons
(`resetOperations()`, `stopLoop()`) so state doesn't leak between tests.
