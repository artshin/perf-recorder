# Agent tools (query stats from Claude Code)

`@artshin/rozenite-perf-recorder` registers Rozenite **agent tools**, so once it
is running in the app you can query the live native stats from the CLI / Claude
Code — no adb, no panel open, no device interaction.

These proxy straight to the native module, so they reflect the same in-memory
counters as the overlay and the panel.

## Prerequisites

- The app is running with Rozenite enabled (`WITH_ROZENITE=true`) and
  `usePerfRecorderDevTools()` mounted.
- The capture loop has shipped at least one window — the native side has no stats
  until the first dump lands (see [architecture.md](architecture.md), "Why no WebSocket").

## Session + domain

```bash
# create a session (note the id, or capture it)
SID=$(npx rozenite agent session create --json | jq -r '.sessionId')

# the domain token is the pluginId with `/`→`__` and `@`/dots normalized:
#   @artshin/rozenite-perf-recorder → at-artshin__rozenite-perf-recorder
# confirm it:
npx rozenite agent domains --session "$SID"
```

## The four tools

| Tool | Input | Returns |
|------|-------|---------|
| `get-stats` | `{}` | `PerfStats` — `dumpCount`, `totalCommits`, `totalReactCommitMs`, `topBySelf` (self-time), `triggers` (updaters), `topFibers` (subtree), and `lastDump`. |
| `clear` | `{}` | `{ cleared: boolean }` — reset the native ring buffer + rolling stats. |
| `list-dumps` | `{}` | `PerfDumpListEntry[]` (newest first): `{ name, sizeBytes, ingestedAt }`. |
| `get-dump` | `{ "name": "dump-….json" }` | `PerfDumpSummary \| null` — re-analyses one persisted dump off-thread; `null` if missing. |

See [data-contract.md](data-contract.md) for the full shape of each type.

## Invocations

```bash
npx rozenite agent at-artshin__rozenite-perf-recorder call --tool get-stats   --args '{}' --session "$SID"
npx rozenite agent at-artshin__rozenite-perf-recorder call --tool list-dumps  --args '{}' --session "$SID"
npx rozenite agent at-artshin__rozenite-perf-recorder call --tool get-dump    --args '{"name":"dump-1779830426509.json"}' --session "$SID"
npx rozenite agent at-artshin__rozenite-perf-recorder call --tool clear       --args '{}' --session "$SID"

# done
npx rozenite agent session stop "$SID"
```

## Reading the output

- **"What's slow?"** → `topBySelf` (self-time isolates the component's own cost
  from its children's).
- **"Why is it re-rendering?"** → `triggers` — high `timesTriggered` with a large
  `avgCascadeFibers` means one component is forcing wide re-render cascades.
- **"What's the heaviest subtree?"** → `topFibers` (subtree cost).
- A single dump's detail → `list-dumps` to find a name, then `get-dump`.
