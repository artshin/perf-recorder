import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { PerfStats } from "../PerfRecorder.types";
import { clearPerfData, getPerfStats } from "../index";

declare const __DEV__: boolean;

type Props = {
  /** Poll interval for refreshing stats, ms. Default 3000. */
  pollMs?: number;
};

/**
 * Floating dev-only overlay showing live perf-recorder stats. Renders nothing
 * in production. Tap the pill to expand/collapse; long-press to clear stats.
 *
 * Mount once near the app root, e.g. in a dev branch of your layout:
 *   {__DEV__ && <PerfOverlay />}
 */
export function PerfOverlay({ pollMs = 3000 }: Props) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<PerfStats | null>(null);

  const refresh = useCallback(() => {
    getPerfStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  if (!__DEV__) return null;

  const dot = stats?.recording ? "🔴" : "⚪️";
  const label = stats
    ? `${dot} ${stats.dumpCount} dumps · ${Math.round(stats.totalReactCommitMs)}ms`
    : `${dot} perf`;

  return (
    <View pointerEvents="box-none" style={styles.root}>
      {open && stats && (
        <View style={styles.panel}>
          <Text style={styles.h}>perf-recorder</Text>
          <Text style={styles.kv}>
            dumps={stats.dumpCount} commits={stats.totalCommits} react=
            {Math.round(stats.totalReactCommitMs)}ms
          </Text>
          {stats.lastDump && (
            <Text style={styles.kv}>
              last: {stats.lastDump.commits} commits ·{" "}
              {stats.lastDump.wallSec.toFixed(1)}s ·{" "}
              {Math.round(stats.lastDump.reactCommitMs)}ms
            </Text>
          )}
          <Text style={[styles.h, styles.sub]}>top fibers (self-time)</Text>
          <ScrollView style={styles.list}>
            {stats.topBySelf.map((f, i) => (
              <Text key={`${f.name}-${i}`} style={styles.row} numberOfLines={1}>
                {Math.round(f.cumulativeMs).toString().padStart(5)}
                ms ×{String(f.renderCount).padStart(3)} {f.name}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}
      <Pressable
        style={styles.pill}
        onPress={() => setOpen((v) => !v)}
        onLongPress={() => {
          void clearPerfData();
          refresh();
        }}
      >
        <Text style={styles.pillText}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    right: 8,
    bottom: 80,
    alignItems: "flex-end",
  },
  pill: {
    backgroundColor: "rgba(0,0,0,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  pillText: { color: "#fff", fontSize: 11, fontVariant: ["tabular-nums"] },
  panel: {
    width: 300,
    maxHeight: 320,
    backgroundColor: "rgba(0,0,0,0.88)",
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
  },
  h: { color: "#7fd1ff", fontSize: 12, fontWeight: "600" },
  sub: { marginTop: 8 },
  kv: { color: "#ddd", fontSize: 11, marginTop: 2 },
  list: { marginTop: 4 },
  row: {
    color: "#9fe6a0",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    fontFamily: "monospace",
  },
});
