import { StatusBar, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { PerfOverlay } from "@artshin/expo-perf-recorder";
import { usePerfRecorderDevTools } from "@artshin/rozenite-perf-recorder";

import { HeavyDemo } from "./src/HeavyDemo";

declare const __DEV__: boolean;

export default function App() {
  // Bridges native PerfRecorder stats to the Rozenite "Perf Recorder" panel and
  // registers the agent tools. No-op in production / without Rozenite running.
  const { isConnected } = usePerfRecorderDevTools();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="default" />
        <View style={styles.header}>
          <Text style={styles.title}>@artshin/perf-recorder example</Text>
          <Text style={styles.status}>
            Rozenite panel: {isConnected ? "connected" : "not connected"}
          </Text>
        </View>

        <HeavyDemo />

        {/* Floating dev-only stats pill. Tap to expand, long-press to clear. */}
        {__DEV__ && <PerfOverlay />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 16, fontWeight: "700" },
  status: { fontSize: 12, opacity: 0.7, marginTop: 2 },
});
