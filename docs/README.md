# perf-recorder docs

Deeper reference for `@artshin/perf-recorder`. For install + day-to-day usage,
start with the package READMEs; come here for the cross-cutting "how" and "why".

| Doc | What it covers |
|-----|----------------|
| [architecture.md](architecture.md) | The three layers (JS capture → native analyse → consumers), the data flow, threading, and the design decisions behind them (Fast-Refresh survival, name-keyed rolling stats, no WebSocket). |
| [data-contract.md](data-contract.md) | The one data type that flows through the system (the V5 profiling export), the stats the native layer derives from it, the three metric families, and the rule for keeping the Kotlin / Swift / TS copies in sync. |
| [agent-tools.md](agent-tools.md) | Querying live native stats from Claude Code / the Rozenite agent CLI — sessions, domain token, the four tools, and example invocations. |
| [testing.md](testing.md) | What the JS test suites cover, why the runner bypasses `jest-expo`, and how to add a test. |

## Map

| Where | Package / path | README |
|-------|----------------|--------|
| Native module + JS capture | [`packages/expo-perf-recorder`](../packages/expo-perf-recorder) | [readme](../packages/expo-perf-recorder/README.md) |
| Rozenite panel + agent tools | [`packages/rozenite-perf-recorder`](../packages/rozenite-perf-recorder) | [readme](../packages/rozenite-perf-recorder/README.md) |
| Runnable example app | [`apps/example`](../apps/example) | [readme](../apps/example/README.md) |

The two packages are coupled **only** by the native module name `"PerfRecorder"`
— the panel imports nothing from the native package, it calls
`requireNativeModule("PerfRecorder")`.
