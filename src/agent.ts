import { runWorker } from "./host.js";
import { prepareWorkspace, BUG } from "./workspace.js";
import { chooseCheckpoint } from "./controls.js";
import { validateConfig, MODES } from "./modes.js";
import { SHELL_COMMAND } from "./policy.js";
import type { WorkerRequest } from "./worker.js";
import type {
  RunConfig,
  Mode,
  LabEvent,
  RunResult,
  Observation,
  Catalog,
  Checkpoint,
  Evidence,
} from "./protocol.js";
export { validateConfig, MODES };
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const DEFAULT_CONFIG: RunConfig = { mode: "restore" };
const EDIT =
  "Read math.mts, then use Edit once to replace the exact substring BASE-42 with EDITED-42. Leave every other character unchanged. Report EDITED-42. No other tools.";
export const PROMPTS = Object.fromEntries(
  MODES.map((m) => [m, EDIT]),
) as Record<Mode, string>;
export function redact(text: string) {
  for (const s of [
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
  ].filter(Boolean) as string[])
    text = text.split(s).join("[REDACTED]");
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]");
}
export async function runAgent(
  value: RunConfig,
  emit: (e: LabEvent) => void,
  controller = new AbortController(),
  scripted = false,
) {
  const c = validateConfig(value),
    w = await prepareWorkspace(),
    started = Date.now(),
    before = await w.snapshot();
  const results: RunResult[] = [],
    checkpoints: Checkpoint[] = [],
    observations: Observation[] = [],
    exceptions: string[] = [],
    rewinds: unknown[] = [],
    validation: unknown[] = [];
  let selectedCheckpointId: string | null = null,
    afterEdit: unknown = before;
  const observe = (kind: string, detail: unknown) => {
    const record = {
      sequence: observations.length + 1,
      atMs: Date.now() - started,
      kind,
      detail,
    };
    observations.push(record);
    emit({ type: "observation", record });
  };
  const call = async (label: string, extra: Partial<WorkerRequest> = {}) => {
    const snapshot = await w.snapshot(),
      count = results.length;
    observe("query-options", {
      label,
      enableFileCheckpointing: true,
      replayUserMessages: true,
      ...extra,
    });
    await runWorker(
      { kind: "query", cwd: w.cwd, prompt: EDIT, ...extra },
      {
        ...process.env,
        HOME: w.home,
        USERPROFILE: w.home,
        CLAUDE_CONFIG_DIR: w.sdkHome,
      },
      controller.signal,
      (type, data) => {
        if (type === "result") {
          const record = { ...data, index: results.length + 1, label };
          results.push(record);
          emit({ type: "result", record });
        }
        if (type === "checkpoint")
          checkpoints.push({ ...data, label, before: snapshot });
        if (type === "answer") emit({ type: "answer", text: redact(data) });
        if (type === "exception") exceptions.push(redact(data));
        if (type.startsWith("rewind-"))
          rewinds.push({ kind: type, checkpoint: extra.checkpoint, ...data });
        observe(type, type === "exception" ? redact(data) : data);
      },
    );
    if (extra.kind !== "rewind" && results.length === count)
      throw new Error("No SDK result. Inspect the actual worker events.");
    observe("file-snapshot", await w.snapshot());
    return results.at(-1)?.sessionId;
  };
  const rewind = async (
    sessionId: string,
    checkpoint: string,
    dryRun = false,
  ) => {
    await call(dryRun ? "Dry-run preview" : "Restore checkpoint", {
      kind: "rewind",
      resume: sessionId,
      checkpoint,
      dryRun,
    });
  };
  emit({
    type: "options",
    config: c,
    options: {
      model: MODEL,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      permissionMode: "acceptEdits",
      scope:
        "Only disposable classroom files; guards reject unrelated paths and commands.",
      maxBudgetUsd: 0.35,
      cleanup:
        "Temporary project files, transcripts and backups are removed after evidence capture.",
    },
  });
  try {
    if (c.mode === "validation")
      validation.push({ stage: "baseline", ...(await w.test()) });
    const prompt =
      c.mode === "created"
        ? "Use Write once to create note.txt with content CREATED-42. Report CREATED-42. No other tools."
        : c.mode === "validation"
          ? `Use Write once to replace math.mts with exactly this code:\n${BUG}Report BUG-42. No other tools.`
          : EDIT;
    const id = (await call("Tracked agent edit", { prompt }))!;
    if (!checkpoints.length)
      throw new Error("No replayed user checkpoint UUID was captured.");
    const first = checkpoints[0];
    afterEdit = await w.snapshot();
    if (c.mode === "menu")
      await call("Second tracked turn", {
        resume: id,
        prompt:
          "Read math.mts then use Edit once to replace EDITED-42 with SECOND-42. Report SECOND-42. No other tools.",
      });
    if (c.mode === "untracked")
      await call("Untracked shell file", {
        resume: id,
        allowShell: true,
        prompt: `Use Bash exactly once with command: ${SHELL_COMMAND}. Do not edit untracked.txt with Write or Edit. Report SHELL-42.`,
      });
    afterEdit = await w.snapshot();
    if (c.mode === "restart") {
      const saved = await w.saveIds({ sessionId: id, checkpointId: first.id });
      observe("restore-manifest-reloaded", saved);
      await rewind(saved.sessionId, saved.checkpointId);
    } else if (c.mode === "validation") {
      const failed = await w.test();
      validation.push({ stage: "after edit", ...failed });
      observe("validation", failed);
      if (!failed.passed) await rewind(id, first.id);
      validation.push({ stage: "after recovery", ...(await w.test()) });
    } else if (c.mode === "menu") {
      const catalog: Catalog = {
        checkpoints: checkpoints.map((p) => ({ id: p.id, title: p.label })),
        messages: checkpoints.map((p) => ({
          checkpointId: p.id,
          messages: [{ sessionId: p.sessionId, before: p.before }],
        })),
      };
      emit({ type: "catalog", catalog });
      if (scripted) selectedCheckpointId = checkpoints[1].id;
      else {
        const choice = chooseCheckpoint(
          checkpoints.map((p) => p.id),
          controller.signal,
        );
        emit({
          type: "choose",
          id: choice.id,
          preferred: checkpoints[1].id,
          checkpoints: catalog.checkpoints,
        });
        try {
          selectedCheckpointId = await choice.selection;
        } finally {
          choice.dispose();
        }
      }
      await rewind(id, selectedCheckpointId!);
    } else if (c.mode === "invalid") {
      const other = (await call("Separate session", {
        prompt: "Reply exactly OTHER-42. No tools.",
      }))!;
      await rewind(other, first.id);
    } else await rewind(id, first.id, c.mode === "preview");
    if (c.mode === "history")
      await call("Recall prior edit after rewind", {
        resume: id,
        prompt:
          "What exact marker did you write with Edit earlier in this conversation? Reply exactly with that prior marker only. Do not read files or use tools.",
      });
    const catalog: Catalog = {
      checkpoints: checkpoints.map((p) => ({ id: p.id, title: p.label })),
      messages: checkpoints.map((p) => ({
        checkpointId: p.id,
        messages: [{ sessionId: p.sessionId, before: p.before }],
      })),
    };
    emit({ type: "catalog", catalog });
    const evidence: Evidence = {
      mode: c.mode,
      results,
      checkpoints,
      catalog,
      selectedCheckpointId,
      before,
      afterEdit,
      after: await w.snapshot(),
      rewinds,
      validation,
      storage: await w.inspect(),
      exceptions,
      observations,
    };
    emit({ type: "evidence", ...evidence });
  } finally {
    await w.cleanup();
  }
}
