// Side-effect import FIRST: arms the continuous, dev-only background profiler
// before anything renders. No-op in production builds.
import "@artshin/expo-perf-recorder/auto";

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
