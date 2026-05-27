// App-side entry. Dev-only: the hook bridges the native PerfRecorder module's
// stats to the DevTools panel. No-op in production / on the server.
export let usePerfRecorderDevTools: typeof import("./src/react-native/usePerfRecorderDevTools").usePerfRecorderDevTools;

const isDev = process.env.NODE_ENV !== "production";
const isServer = typeof window === "undefined";

if (isDev && !isServer) {
  usePerfRecorderDevTools =
    require("./src/react-native/usePerfRecorderDevTools").usePerfRecorderDevTools;
} else {
  usePerfRecorderDevTools = () => ({ isConnected: false });
}
