# perf-recorder example app

A minimal Expo dev-client app that exercises both workspace packages end to end:

- `import "@artshin/expo-perf-recorder/auto"` in [`index.ts`](./index.ts) — arms the continuous, dev-only capture loop before render.
- `<PerfOverlay />` in [`App.tsx`](./App.tsx) — the floating in-app stats pill.
- `usePerfRecorderDevTools()` in [`App.tsx`](./App.tsx) — bridges native stats to the Rozenite **Perf Recorder** panel and registers the agent tools.
- [`src/HeavyDemo.tsx`](./src/HeavyDemo.tsx) — a deliberately heavy, continuously re-rendering screen so the profiler has real work to measure (named `HeavyList` / `HeavyItem` / `Ticker` fibers).

## Requirements

`@artshin/expo-perf-recorder` ships native Kotlin/Swift, so this **cannot run in Expo Go** — you need a custom dev client built from a prebuild.

## Run

From the repo root (the example resolves the local packages via the Yarn workspace):

```bash
yarn install
yarn build            # build the two packages first — the example consumes their build/ + dist/ output
```

Then from `apps/example`:

```bash
yarn prebuild         # generate native android/ios (autolinks the native module)
yarn android          # or: yarn ios — build + install the dev client
yarn start            # Metro for the dev client (plain)
yarn start:rozenite   # Metro with the Rozenite panel + agent tools enabled (WITH_ROZENITE=true)
```

Re-run `yarn build` in the root whenever you change either package — Metro serves the packages' built output, not their `src/`.

## See the data

- **Overlay:** tap the pill (bottom-right) to expand live stats; long-press to clear.
- **Rozenite panel:** start with `yarn start:rozenite`, open React Native DevTools → **Perf Recorder** tab.
- **Agent tools / Claude Code:** with `start:rozenite` running, query live stats over the Rozenite agent CLI — see [`../../packages/rozenite-perf-recorder/README.md`](../../packages/rozenite-perf-recorder/README.md) for the `get-stats` / `list-dumps` / `get-dump` / `clear` invocations.
