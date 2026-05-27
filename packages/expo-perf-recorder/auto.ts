// Side-effect entry: import this ONCE in your app entry to enable continuous
// background profiling in dev with zero further integration:
//
//   import "@artshin/expo-perf-recorder/auto";
//
// No-op in production builds. The capture loop arms itself; if no renderer is
// registered yet it keeps retrying on the interval until the agent attaches.
import { startPerfRecorder } from "./src";

declare const __DEV__: boolean;

if (__DEV__) {
  // Defer one tick so the devtools hook / renderers have a chance to register.
  setTimeout(() => {
    void startPerfRecorder();
  }, 0);
}
