# Claude Agent SDK · Lesson 42 · File checkpointing and rewind

Five linked student pages, large text, actual SDK experiments and coloured code in all thirteen UML steps.

## What you will learn

- Enable tracked file backups: Use enableFileCheckpointing and replay-user-messages. The SDK tracks edits through Write, Edit and NotebookEdit; the lab performs real Edit and Write calls.
- Capture checkpoint identities: Save the replayed user-message UUID together with its session ID. These identify a pre-turn file state, not an arbitrary result message or a Git commit.
- Preview and rewind: Use rewindFiles(id, { dryRun: true }) to inspect the native preview, then rewindFiles(id) to restore. Modified files recover their old content; tracked newly created files are removed.
- Keep safe restore points: Automatically rewind when a real Node test fails. Or capture multiple turns, inspect their pre-turn snapshots and choose a known checkpoint through the web menu.
- Rewind from a later process: Save and reload the session/checkpoint pair, open an empty resumed query with checkpointing enabled, then restore. Local transcripts and backup files must still be available.
- Understand what remains: Conversation history stays intact. A distinct file changed only by Bash remains untracked. Checkpoints are session-specific, not a complete filesystem or remote storage snapshot.

## Configure and run

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson42-app.git
cd .\Udemy-Claude-Agent-SDK-lesson42-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

From presentations use `cd .\agent-sdk\lesson42-checkpointing`. Open http://127.0.0.1:3142 and keep the terminal running. Node.js 24+, API credit and model access are required. Windows may require Git Bash.

## Create your .env file

Preserve an existing file. Enter your own model key, then restart. Existing shell values take precedence.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3142
# Windows only, if needed:
# CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe

```

No GitHub token or Managed Agents IDs are required. Secrets, dependencies and teaching media stay outside Git.

## Run the experiments

### Compare restore, preview and created files

Restore edits the existing TypeScript fixture and restores its original bytes. Preview performs only dryRun. Created writes a new note.txt and removes it through real rewind. Inspect all three file snapshots and native results.

```powershell
npm run sample:env -- restore
npm run sample:env -- preview
npm run sample:env -- created
```

### Practise recovery and a restore menu

Validation runs a real Node test before an intentional agent-written bug, observes the failure, rewinds automatically and runs the test again. Menu captures two turns; choose a checkpoint, inspect its pre-turn snapshot, then click Rewind selected checkpoint. The CLI automatically chooses the second checkpoint.

```powershell
npm run sample:env -- validation
npm run sample:env -- menu
npm run sample:env -- restart
```

### Verify the boundaries

Restart reloads IDs and starts a later process while retaining local backups. History proves that recalling an earlier edit still works after restoring files. Untracked uses one exact Bash command on a distinct file never edited by Write/Edit. Invalid attempts a checkpoint from another session. All classroom data is cleaned up after each run.

```powershell
npm run sample:env -- history
npm run sample:env -- untracked
npm run sample:env -- invalid
npm test
```

## How the app was built

### 1. Validate the experiment

Accept only fixed classroom modes. Requests cannot provide arbitrary files, shell commands, resume IDs or checkpoint UUIDs.

Source: `src/modes.ts`, selected lines 3–9. Surrounding code omitted.

```typescript
export function validateConfig(value: unknown): RunConfig {
  const c = value as Record<string, unknown>;
  if (!c || typeof c !== "object" || !MODES.includes(c.mode as never))
    throw new Error("Choose a listed checkpoint experiment.");
  if (Object.keys(c).some((k) => k !== "mode"))
    throw new Error("Only the classroom mode can be configured.");
  return { mode: c.mode as RunConfig["mode"] };
```

### 2. Prepare a disposable TypeScript project

Seed a small TypeScript fixture and a real Node test inside an isolated project, home and SDK config. The original content is independently observed.

Source: `src/workspace.ts`, selected lines 33–38. Surrounding code omitted.

```typescript
await writeFile(join(cwd, "math.mts"), BASE);
  await writeFile(
    join(cwd, "verify.test.mjs"),
    'import{test}from"node:test";import assert from"node:assert/strict";import{add}from"./math.mts";test("adds 2 and 3",()=>assert.equal(add(2,3),5));',
  );
  async function optional(name: string) {
```

### 3. Enable backups and user replay

Enable SDK checkpointing and replay-user-messages. acceptEdits is constrained by a guard to fixed classroom paths and bounded inputs.

Source: `src/worker.ts`, selected lines 24–32. Surrounding code omitted.

```typescript
enableFileCheckpointing: true,
  extraArgs: { "replay-user-messages": null },
  permissionMode: "acceptEdits",
  tools: request.allowShell
    ? ["Read", "Edit", "Write", "Bash"]
    : ["Read", "Edit", "Write"],
  allowedTools: request.allowShell
    ? ["Read", "Edit", "Write", "Bash"]
    : ["Read", "Edit", "Write"],
```

### 4. Guard tracked edit tools

Only the fixed fixtures can be read or edited. The shell demonstration needs its explicit exact-command capability; arbitrary tools and paths are rejected.

Source: `src/policy.ts`, selected lines 17–25. Surrounding code omitted.

```typescript
if (name === "Read")
    return [main, note, resolve(cwd, "untracked.txt")].includes(file);
  if (name === "Edit")
    return (
      file === main &&
      typeof i.old_string === "string" &&
      typeof i.new_string === "string" &&
      i.old_string.length <= 200 &&
      i.new_string.length <= 200 &&
```

### 5. Capture the user checkpoint UUID

Capture the actual replayed user-message UUID once per query, paired with its actual SDK session ID.

Source: `src/worker.ts`, selected lines 95–98. Surrounding code omitted.

```typescript
if (message.type === "user" && message.uuid && !captured) {
      captured = true;
      send("checkpoint", { id: message.uuid, sessionId: message.session_id });
    }
```

### 6. Associate each checkpoint with its pre-turn state

The host labels native checkpoint IDs and stores independently read pre-turn snapshots for teaching. SDK backups, rather than host snapshots, perform restoration.

Source: `src/agent.ts`, selected lines 85–89. Surrounding code omitted.

```typescript
if (type === "checkpoint")
          checkpoints.push({ ...data, label, before: snapshot });
        if (type === "answer") emit({ type: "answer", text: redact(data) });
        if (type === "exception") exceptions.push(redact(data));
        if (type.startsWith("rewind-"))
```

### 7. Open a resumed rewind connection

Use an empty prompt with resume and checkpointing enabled. The control operation runs in a new actual SDK worker.

Source: `src/worker.ts`, selected lines 77–82. Surrounding code omitted.

```typescript
const active = query({
    prompt: request.kind === "rewind" ? "" : request.prompt!,
    options,
  });
  for await (const message of active) {
    if (message.type === "system" && message.subtype === "init")
```

### 8. Preview restoration without writes

Capture the native dry-run result. Preview must not change current file bytes or remove newly created files.

Source: `src/worker.ts`, selected lines 85–88. Surrounding code omitted.

```typescript
const preview = await active.rewindFiles(request.checkpoint!, {
        dryRun: true,
      });
      send("rewind-preview", preview);
```

### 9. Apply real rewind

Only apply when requested and the native preview allows it. Capture native canRewind and skippedLinks data; inspect actual files afterward.

Source: `src/worker.ts`, selected lines 89–93. Surrounding code omitted.

```typescript
if (!request.dryRun && preview.canRewind) {
        const result = await active.rewindFiles(request.checkpoint!);
        send("rewind-applied", result);
      }
      break;
```

### 10. Recover when validation fails

Run the real Node test against the agent-written bug. A failure triggers SDK rewind, followed by another real test run.

Source: `src/agent.ts`, selected lines 158–162. Surrounding code omitted.

```typescript
const failed = await w.test();
      validation.push({ stage: "after edit", ...failed });
      observe("validation", failed);
      if (!failed.passed) await rewind(id, first.id);
      validation.push({ stage: "after recovery", ...(await w.test()) });
```

### 11. Choose one known restore point

Bind the browser choice to known checkpoint IDs for this run. The selected pre-turn state determines which later edits are undone.

Source: `src/agent.ts`, selected lines 174–181. Surrounding code omitted.

```typescript
const choice = chooseSession(
          checkpoints.map((p) => p.id),
          controller.signal,
        );
        emit({
          type: "choose",
          id: choice.id,
          preferred: checkpoints[1].id,
```

### 12. Reload restore identifiers later

Persist and reload the session/checkpoint pair, then rewind in a later worker. Local SDK history and backups remain available.

Source: `src/agent.ts`, selected lines 154–156. Surrounding code omitted.

```typescript
const saved = await w.saveIds({ sessionId: id, checkpointId: first.id });
      observe("restore-manifest-reloaded", saved);
      await rewind(saved.sessionId, saved.checkpointId);
```

### 13. Verify conversation history remains

After files are restored, resume the same conversation and recall the previously written marker without reading the file. File restoration does not erase that history.

Source: `src/agent.ts`, selected lines 197–202. Surrounding code omitted.

```typescript
if (c.mode === "history")
      await call("Recall prior edit after rewind", {
        resume: id,
        prompt:
          "What exact marker did you write with Edit earlier in this conversation? Reply exactly with that prior marker only. Do not read files or use tools.",
      });
```

## Reference topics and limits

- What this app actually runs: Real SDK Read/Edit/Write calls change disposable classroom fixtures. Real rewindFiles controls restore them. Validation uses a real Node child process. The restore menu requires an actual browser choice. NotebookEdit is part of the SDK contract but is not invoked in this lab.
- Preview and link safety: A dry run shows planned changes without modifying files. A real rewind can skip unsafe links or unavailable backups. The app records native results and independently compares file bytes; it does not claim preview alone proves successful restoration.
- Conversation versus files: Rewind restores files without erasing prior prompts, tool results or conversational context. The History test recalls EDITED-42 after the actual file returns to BASE-42.
- Shell and subagent limits: A file changed only through Bash is not tracked. If a main-conversation Write/Edit had already tracked that file, a rewind can restore it. The lab uses a separate untracked file to show this boundary. Subagent edits have analogous limits; this lab does not invoke subagents.
- Local, session-specific restore points: Use checkpoint UUIDs only with their original session and retain the local backups. IDs alone cannot restore files after backups are lost. Directory operations and remote filesystem state are not a complete checkpoint snapshot.
- Conflict with external session stores: The SDK rejects checkpointing combined with sessionStore because file backup blobs are not mirrored by that interface. This lab uses isolated local SDK storage rather than the Lesson 41 adapter.
- Validation and lifetime: The tests check guarded paths and commands, restore-choice capabilities, actual fixture failure/recovery, snapshot hashes and startup handling. All temporary classroom projects, transcripts and backups are removed after evidence collection. Keep Git as an independent project safety net.

## References

- [Official SDK file checkpointing documentation](https://code.claude.com/docs/en/agent-sdk/file-checkpointing)
- [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

Regenerate student pages with `python scripts/build-pages.py`. Run `npm test` for guarded file operations, restore choices, real fixture validation and startup checks.
