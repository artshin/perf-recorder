import { useRozenitePluginAgentTool } from "@rozenite/agent-bridge";

import {
  PERF_RECORDER_AGENT_PLUGIN_ID,
  perfRecorderToolDefinitions,
} from "../../shared/agent-tools";
import type {
  PerfDumpListEntry,
  PerfDumpSummary,
  PerfStats,
} from "../../shared/messaging";
import { nativePerfRecorder } from "../native";

const EMPTY_STATS: PerfStats = {
  dumpCount: 0,
  totalCommits: 0,
  totalReactCommitMs: 0,
  topFibers: [],
  topBySelf: [],
  triggers: [],
  lastDump: null,
};

/**
 * Registers perf-recorder agent tools so the Rozenite agent CLI / Claude Code
 * can query the live native stats. No-op until a session attaches.
 */
export const usePerfRecorderAgentTools = () => {
  useRozenitePluginAgentTool({
    pluginId: PERF_RECORDER_AGENT_PLUGIN_ID,
    tool: perfRecorderToolDefinitions.getStats,
    handler: async () => {
      const n = nativePerfRecorder();
      if (!n) return EMPTY_STATS;
      try {
        return JSON.parse(await n.getStats()) as PerfStats;
      } catch {
        return EMPTY_STATS;
      }
    },
  });

  useRozenitePluginAgentTool({
    pluginId: PERF_RECORDER_AGENT_PLUGIN_ID,
    tool: perfRecorderToolDefinitions.clear,
    handler: async () => {
      const n = nativePerfRecorder();
      if (n) {
        try {
          await n.clear();
        } catch {
          // ignore
        }
      }
      return { cleared: !!n };
    },
  });

  useRozenitePluginAgentTool({
    pluginId: PERF_RECORDER_AGENT_PLUGIN_ID,
    tool: perfRecorderToolDefinitions.listDumps,
    handler: async () => {
      const n = nativePerfRecorder();
      if (!n) return [];
      try {
        return JSON.parse(await n.listDumps()) as PerfDumpListEntry[];
      } catch {
        return [];
      }
    },
  });

  useRozenitePluginAgentTool({
    pluginId: PERF_RECORDER_AGENT_PLUGIN_ID,
    tool: perfRecorderToolDefinitions.getDump,
    handler: async ({ name }) => {
      const n = nativePerfRecorder();
      if (!n) return null;
      try {
        return JSON.parse(
          await n.getDumpSummary(name),
        ) as PerfDumpSummary | null;
      } catch {
        return null;
      }
    },
  });
};
