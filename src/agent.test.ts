import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { prepareWorkspace, BASE, BUG } from "./workspace.js";
import { allowedTool, SHELL_COMMAND } from "./policy.js";
import { validateConfig } from "./modes.js";
import { chooseCheckpoint, applyControl } from "./controls.js";
test("Read and Edit are confined to the classroom files", () => {
  assert.ok(allowedTool("C:/lab", "Read", { file_path: "math.mts" }));
  assert.ok(
    allowedTool("C:/lab", "Edit", {
      file_path: "math.mts",
      old_string: "BASE-42",
      new_string: "EDITED-42",
    }),
  );
  assert.ok(
    !allowedTool("C:/lab", "Edit", {
      file_path: "../outside.mts",
      old_string: "BASE-42",
      new_string: "EDITED-42",
    }),
  );
});
test("Write accepts only the known bug or created fixture", () => {
  assert.ok(
    allowedTool("C:/lab", "Write", { file_path: "math.mts", content: BUG }),
  );
  assert.ok(
    allowedTool("C:/lab", "Write", {
      file_path: "note.txt",
      content: "CREATED-42",
    }),
  );
  assert.ok(
    !allowedTool("C:/lab", "Write", {
      file_path: "untracked.txt",
      content: "CREATED-42",
    }),
  );
});
test("shell demonstration requires an explicit exact command capability", () => {
  assert.ok(!allowedTool("C:/lab", "Bash", { command: SHELL_COMMAND }));
  assert.ok(allowedTool("C:/lab", "Bash", { command: SHELL_COMMAND }, true));
  assert.ok(
    !allowedTool(
      "C:/lab",
      "Bash",
      { command: SHELL_COMMAND + "; echo extra" },
      true,
    ),
  );
});
test("arbitrary SDK options and paths are rejected", () => {
  assert.deepEqual(validateConfig({ mode: "restore" }), { mode: "restore" });
  for (const v of [
    { mode: "unknown" },
    { mode: "restore", cwd: "/private" },
    { mode: "restore", checkpoint: "other" },
  ])
    assert.throws(() => validateConfig(v));
});
test("restore selection accepts only known checkpoint IDs", async () => {
  const c = chooseCheckpoint(["first", "second"], new AbortController().signal);
  assert.throws(() => applyControl({ id: c.id, checkpointId: "other" }));
  assert.ok(applyControl({ id: c.id, checkpointId: "second" }));
  assert.equal(await c.selection, "second");
  assert.equal(applyControl({ id: c.id, checkpointId: "second" }), false);
});
test("cancelled restore selection is removed", async () => {
  const ac = new AbortController(),
    c = chooseCheckpoint(["first"], ac.signal);
  ac.abort();
  await assert.rejects(c.selection);
  assert.equal(applyControl({ id: c.id, checkpointId: "first" }), false);
});
test("the real fixture test detects a bug and passes after recovery", async () => {
  const w = await prepareWorkspace();
  try {
    assert.ok((await w.test()).passed);
    await writeFile(join(w.cwd, "math.mts"), BUG);
    assert.equal((await w.test()).passed, false);
    await writeFile(join(w.cwd, "math.mts"), BASE);
    assert.ok((await w.test()).passed);
  } finally {
    await w.cleanup();
  }
});
test("snapshot hashes detect edits and created files", async () => {
  const w = await prepareWorkspace();
  try {
    const first = await w.snapshot();
    await writeFile(join(w.cwd, "math.mts"), BUG);
    await writeFile(join(w.cwd, "note.txt"), "CREATED-42");
    const last = await w.snapshot();
    assert.notEqual(first.mainHash, last.mainHash);
    assert.equal(last.note, "CREATED-42");
    assert.equal(first.note, null);
  } finally {
    await w.cleanup();
  }
});
test("restore manifest reload preserves the session-checkpoint pair", async () => {
  const w = await prepareWorkspace();
  try {
    const ids = { sessionId: "s", checkpointId: "c" };
    assert.deepEqual(await w.saveIds(ids), ids);
  } finally {
    await w.cleanup();
  }
});
