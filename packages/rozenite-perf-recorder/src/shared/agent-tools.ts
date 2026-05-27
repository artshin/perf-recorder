import {
  defineAgentToolContract,
  type JSONSchema7,
} from "@rozenite/agent-shared";

import type {
  PerfDumpListEntry,
  PerfDumpSummary,
  PerfStats,
} from "./messaging";

// Agent-tool contracts. These are what the Rozenite agent CLI (and therefore
// Claude Code) can call against a live session:
//   npx rozenite agent at-artshin__rozenite-perf-recorder \
//     call --tool get-stats --args '{}' --session <id>
export const PERF_RECORDER_AGENT_PLUGIN_ID = "@artshin/rozenite-perf-recorder";

const emptyInputSchema: JSONSchema7 = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export type PerfRecorderClearResult = { cleared: boolean };
export type GetDumpInput = { name: string };

export const perfRecorderToolDefinitions = {
  getStats: defineAgentToolContract<Record<string, never>, PerfStats>({
    name: "get-stats",
    description:
      "Return perf-recorder rolling stats from live in-memory native counters: " +
      "dumpCount, totalCommits, totalReactCommitMs, topBySelf (what's expensive " +
      "— self-time), triggers (why it renders — updaters), topFibers (subtree " +
      "cost), and the latest per-dump summary.",
    inputSchema: emptyInputSchema,
  }),
  clear: defineAgentToolContract<
    Record<string, never>,
    PerfRecorderClearResult
  >({
    name: "clear",
    description:
      "Reset the perf-recorder native ring buffer and rolling stats.",
    inputSchema: emptyInputSchema,
  }),
  listDumps: defineAgentToolContract<
    Record<string, never>,
    PerfDumpListEntry[]
  >({
    name: "list-dumps",
    description:
      "List persisted raw dumps in the disk ring buffer, newest first: " +
      "{ name, sizeBytes, ingestedAt }. Pass a name to get-dump.",
    inputSchema: emptyInputSchema,
  }),
  getDump: defineAgentToolContract<GetDumpInput, PerfDumpSummary | null>({
    name: "get-dump",
    description:
      "Re-analyse one persisted dump by file name (from list-dumps) and return " +
      "its per-dump summary: roots, commits, fiberRecords, reactCommitMs, " +
      "wallSec, topBySelf (self-time), triggers (updaters), topFibers (subtree). " +
      "Returns null if the dump is missing.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: 'Dump file name, e.g. "dump-1779830426509.json".',
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  }),
};
