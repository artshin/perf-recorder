import { useRozeniteDevToolsClient } from "@rozenite/plugin-bridge";
import { useEffect, useState } from "react";

import {
  PLUGIN_ID,
  type PerfFiberStat,
  type PerfRecorderPluginEventMap,
  type PerfStats,
  type PerfTriggerStat,
} from "../shared/messaging";

const fmtMs = (n: number) => `${n < 10 ? n.toFixed(2) : Math.round(n)}ms`;

export default function PerfRecorderPanel() {
  const client = useRozeniteDevToolsClient<PerfRecorderPluginEventMap>({
    pluginId: PLUGIN_ID,
  });
  const [stats, setStats] = useState<PerfStats | null>(null);

  useEffect(() => {
    if (!client) return;
    const sub = client.onMessage("stats", setStats);
    client.send("request-stats", undefined);
    return () => sub.remove();
  }, [client]);

  if (!client) return <div style={S.empty}>Connecting to device…</div>;
  if (!stats) return <div style={S.empty}>Waiting for first dump…</div>;

  const last = stats.lastDump;

  return (
    <div style={S.root}>
      <div style={S.bar}>
        <strong>Perf Recorder</strong>
        <span style={S.spacer} />
        <button
          style={S.btn}
          onClick={() => client.send("request-stats", undefined)}
        >
          Refresh
        </button>
        <button style={S.btn} onClick={() => client.send("clear", undefined)}>
          Clear
        </button>
      </div>

      <div style={S.cards}>
        <Card label="Dumps" value={String(stats.dumpCount)} />
        <Card label="Commits" value={String(stats.totalCommits)} />
        <Card label="React work" value={fmtMs(stats.totalReactCommitMs)} />
      </div>

      {last && (
        <div style={S.sub}>
          last dump: {last.commits} commits · {last.wallSec.toFixed(1)}s ·{" "}
          {fmtMs(last.reactCommitMs)} · {last.fiberRecords} fiber records
        </div>
      )}

      <FiberTable title="What's expensive — self-time" rows={stats.topBySelf} />
      <TriggerTable rows={stats.triggers} />
      <FiberTable
        title="Subtree cost — cumulative actualDuration"
        rows={stats.topFibers}
      />
    </div>
  );
}

function FiberTable({ title, rows }: { title: string; rows: PerfFiberStat[] }) {
  if (!rows?.length) return null;
  return (
    <>
      <h4 style={S.h4}>{title}</h4>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.thR}>total</th>
            <th style={S.thR}>×</th>
            <th style={S.thR}>avg</th>
            <th style={S.thL}>component</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => (
            <tr
              key={`${f.name}-${i}`}
              style={f.cumulativeMs > 50 ? S.rowHot : undefined}
            >
              <td style={S.tdR}>{fmtMs(f.cumulativeMs)}</td>
              <td style={S.tdR}>{f.renderCount}</td>
              <td style={S.tdR}>{fmtMs(f.avgMs)}</td>
              <td style={S.tdL}>{f.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TriggerTable({ rows }: { rows: PerfTriggerStat[] }) {
  if (!rows?.length) return null;
  return (
    <>
      <h4 style={S.h4}>Why it renders — triggers</h4>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.thR}>commits</th>
            <th style={S.thR}>total</th>
            <th style={S.thR}>~fibers</th>
            <th style={S.thL}>triggered by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr
              key={`${t.name}-${i}`}
              style={t.totalCommitMs > 50 ? S.rowHot : undefined}
            >
              <td style={S.tdR}>{t.timesTriggered}</td>
              <td style={S.tdR}>{fmtMs(t.totalCommitMs)}</td>
              <td style={S.tdR}>{Math.round(t.avgCascadeFibers)}</td>
              <td style={S.tdL}>{t.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.card}>
      <div style={S.cardVal}>{value}</div>
      <div style={S.cardLbl}>{label}</div>
    </div>
  );
}

const mono =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" as const;

const S: Record<string, React.CSSProperties> = {
  root: { fontFamily: "system-ui, sans-serif", padding: 12, color: "#e6e6e6" },
  empty: { padding: 24, color: "#888", fontFamily: "system-ui, sans-serif" },
  bar: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  spacer: { flex: 1 },
  btn: {
    background: "#2b2b2b",
    color: "#e6e6e6",
    border: "1px solid #444",
    borderRadius: 6,
    padding: "4px 10px",
    cursor: "pointer",
  },
  cards: { display: "flex", gap: 8 },
  card: {
    background: "#1e1e1e",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "10px 14px",
    minWidth: 96,
  },
  cardVal: {
    fontSize: 20,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  cardLbl: { fontSize: 11, color: "#999", marginTop: 2 },
  sub: { marginTop: 10, fontSize: 12, color: "#aaa" },
  h4: { margin: "16px 0 6px" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: mono,
    fontSize: 12,
  },
  thR: {
    textAlign: "right",
    padding: "4px 8px",
    color: "#888",
    borderBottom: "1px solid #333",
  },
  thL: {
    textAlign: "left",
    padding: "4px 8px",
    color: "#888",
    borderBottom: "1px solid #333",
  },
  tdR: {
    textAlign: "right",
    padding: "3px 8px",
    fontVariantNumeric: "tabular-nums",
  },
  tdL: { textAlign: "left", padding: "3px 8px", color: "#9fe6a0" },
  rowHot: { background: "rgba(255,80,80,0.12)" },
};
