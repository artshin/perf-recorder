import { useRozeniteDevToolsClient } from "@rozenite/plugin-bridge";
import { useEffect } from "react";

import { nativePerfRecorder as native } from "./native";
import {
  PLUGIN_ID,
  type PerfRecorderPluginEventMap,
  type PerfStats,
} from "../shared/messaging";
import { usePerfRecorderAgentTools } from "./agent/usePerfRecorderAgentTools";

/**
 * Bridges native PerfRecorder stats to the Rozenite "Perf Recorder" panel.
 * Pushes stats every 2s while a panel is connected; responds to on-demand
 * refresh and clear requests from the panel. Also registers agent tools so
 * Claude Code can query the same stats over the Rozenite agent CLI.
 */
export const usePerfRecorderDevTools = () => {
  const client = useRozeniteDevToolsClient<PerfRecorderPluginEventMap>({
    pluginId: PLUGIN_ID,
  });

  usePerfRecorderAgentTools();

  useEffect(() => {
    if (!client) return;
    let alive = true;

    const push = async () => {
      const n = native();
      if (!n) return;
      try {
        const raw = await n.getStats();
        if (alive) client.send("stats", JSON.parse(raw) as PerfStats);
      } catch {
        // ignore — native not ready or bad payload
      }
    };

    const subRefresh = client.onMessage("request-stats", () => {
      void push();
    });
    const subClear = client.onMessage("clear", () => {
      native()
        ?.clear()
        .then(() => push())
        .catch(() => {});
    });

    void push();
    const timer = setInterval(push, 2000);

    return () => {
      alive = false;
      clearInterval(timer);
      subRefresh.remove();
      subClear.remove();
    };
  }, [client]);

  return { isConnected: !!client };
};
