export const MODES = [
  "restore",
  "preview",
  "created",
  "validation",
  "menu",
  "restart",
  "history",
  "untracked",
  "invalid",
] as const;
export type Mode = (typeof MODES)[number];
export interface RunConfig {
  mode: Mode;
}
export interface RunResult {
  index: number;
  label: string;
  pid: number;
  sessionId: string;
  status: string;
  text: string;
  costUsd: number;
}
export interface Observation {
  sequence: number;
  atMs: number;
  kind: string;
  detail: unknown;
}
export interface Catalog {
  sessions: { id: string; title: string }[];
  messages: { sessionId: string; messages: unknown[] }[];
}
export interface Checkpoint {
  id: string;
  sessionId: string;
  label: string;
  before: unknown;
}
export interface Evidence {
  mode: Mode;
  results: RunResult[];
  checkpoints: Checkpoint[];
  catalog: Catalog;
  selectedCheckpointId: string | null;
  before: unknown;
  afterEdit: unknown;
  after: unknown;
  rewinds: unknown[];
  validation: unknown[];
  storage: unknown;
  exceptions: string[];
  observations: Observation[];
}
export type LabEvent =
  | { type: "options"; config: RunConfig; options: unknown }
  | { type: "observation"; record: Observation }
  | { type: "result"; record: RunResult }
  | { type: "catalog"; catalog: Catalog }
  | {
      type: "choose";
      id: string;
      preferred: string;
      sessions: Catalog["sessions"];
    }
  | { type: "answer"; text: string }
  | ({ type: "evidence" } & Evidence)
  | { type: "error" | "notice"; text: string };
