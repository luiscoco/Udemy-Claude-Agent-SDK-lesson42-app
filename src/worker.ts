import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline";
import { allowedTool } from "./policy.js";
export interface WorkerRequest {
  kind: "query" | "rewind";
  cwd: string;
  prompt?: string;
  resume?: string;
  checkpoint?: string;
  dryRun?: boolean;
  allowShell?: boolean;
}
const controller = new AbortController(),
  input = createInterface({ input: process.stdin });
const request = await new Promise<WorkerRequest>((r) =>
  input.once("line", (l) => r(JSON.parse(l))),
);
input.on("line", () => controller.abort());
const send = (type: string, value: unknown) =>
  process.stdout.write(JSON.stringify({ type, value }) + "\n");
const options: Options = {
  cwd: request.cwd,
  model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
  enableFileCheckpointing: true,
  extraArgs: { "replay-user-messages": null },
  permissionMode: "acceptEdits",
  tools: request.allowShell
    ? ["Read", "Edit", "Write", "Bash"]
    : ["Read", "Edit", "Write"],
  allowedTools: request.allowShell
    ? ["Read", "Edit", "Write", "Bash"]
    : ["Read", "Edit", "Write"],
  settingSources: [],
  plugins: [],
  maxTurns: 6,
  maxBudgetUsd: 0.35,
  effort: "low",
  thinking: { type: "disabled" },
  resume: request.resume,
  abortController: controller,
  env: {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: undefined,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  },
  hooks: {
    PreToolUse: [
      {
        hooks: [
          async (i) => {
            if (i.hook_event_name !== "PreToolUse") return {};
            if (
              allowedTool(
                request.cwd,
                i.tool_name,
                i.tool_input,
                request.allowShell,
              )
            )
              return {};
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason:
                  "Only the fixed disposable classroom files and explicitly enabled shell command are permitted.",
              },
            };
          },
        ],
      },
    ],
  },
};
let captured = false;
try {
  const active = query({
    prompt: request.kind === "rewind" ? "" : request.prompt!,
    options,
  });
  for await (const message of active) {
    if (message.type === "system" && message.subtype === "init")
      send("init", { pid: process.pid, sessionId: message.session_id });
    if (request.kind === "rewind") {
      const preview = await active.rewindFiles(request.checkpoint!, {
        dryRun: true,
      });
      send("rewind-preview", preview);
      if (!request.dryRun && preview.canRewind) {
        const result = await active.rewindFiles(request.checkpoint!);
        send("rewind-applied", result);
      }
      break;
    }
    if (message.type === "user" && message.uuid && !captured) {
      captured = true;
      send("checkpoint", { id: message.uuid, sessionId: message.session_id });
    }
    if (message.type === "assistant")
      for (const b of message.message.content) {
        if (b.type === "text") send("answer", b.text);
        if (b.type === "tool_use") send("tool", b);
      }
    if (message.type === "result")
      send("result", {
        pid: process.pid,
        sessionId: message.session_id,
        status: message.subtype,
        text:
          message.subtype === "success"
            ? message.result
            : message.errors.join("\n"),
        costUsd: message.total_cost_usd,
      });
  }
} catch (e) {
  send("exception", e instanceof Error ? e.message : String(e));
} finally {
  input.close();
  process.stdin.destroy();
}
