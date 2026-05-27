// A deliberately heavy, continuously re-rendering screen — its only job is to
// give the profiler something to measure. Named function components (HeavyList,
// HeavyItem, Ticker) so they show up by name in the perf-recorder stats /
// overlay / Rozenite panel instead of "(unnamed)".
import { useEffect, useReducer, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

// Synchronous busy-work so each render of an item costs measurable ms
// (actualDuration / selfDuration). Tune `spin` to make the cost bigger.
function burn(seed: number, spin: number): number {
  let acc = seed;
  for (let i = 0; i < spin; i++) {
    acc += Math.sqrt((acc % 97) + i) * Math.sin(i);
  }
  return acc;
}

function HeavyItem({ index, spin }: { index: number; spin: number }) {
  const value = burn(index + 1, spin);
  return (
    <View style={styles.item}>
      <Text style={styles.itemText} numberOfLines={1}>
        #{index} · {value.toFixed(2)}
      </Text>
    </View>
  );
}

function HeavyList({ count, spin }: { count: number; spin: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, i) => (
        <HeavyItem key={i} index={i} spin={spin} />
      ))}
    </View>
  );
}

// Forces a commit on every interval tick so the capture loop always has fresh
// data, even if nobody is touching the controls.
function Ticker({ enabled }: { enabled: boolean }) {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(bump, 500);
    return () => clearInterval(id);
  }, [enabled]);
  return <Text style={styles.tick}>auto-render tick: {tick}</Text>;
}

const SPIN = 20000; // iterations of busy-work per item per render

export function HeavyDemo() {
  const [count, setCount] = useState(20);
  const [auto, setAuto] = useState(true);

  return (
    <View style={styles.root}>
      <Text style={styles.h}>Heavy render demo</Text>
      <Text style={styles.sub}>
        {count} items × {SPIN.toLocaleString()} ops each, every render.
      </Text>

      <View style={styles.controls}>
        <Btn label="− items" onPress={() => setCount((c) => Math.max(0, c - 10))} />
        <Btn label="+ items" onPress={() => setCount((c) => c + 10)} />
        <Btn
          label={auto ? "pause auto" : "resume auto"}
          onPress={() => setAuto((a) => !a)}
        />
      </View>

      <Ticker enabled={auto} />
      <HeavyList count={count} spin={SPIN} />
    </View>
  );
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.btn} onPress={onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 8 },
  h: { fontSize: 18, fontWeight: "700" },
  sub: { fontSize: 12, opacity: 0.7 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  btn: {
    backgroundColor: "#1f6feb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnText: { color: "#fff", fontWeight: "600" },
  tick: { fontSize: 12, fontVariant: ["tabular-nums"], marginBottom: 4 },
  list: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  item: {
    backgroundColor: "rgba(127,127,127,0.15)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  itemText: { fontSize: 10, fontVariant: ["tabular-nums"] },
});
