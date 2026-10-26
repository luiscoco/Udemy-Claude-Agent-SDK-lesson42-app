import { renderMarkdown } from "./markdown.js";
import type { LabEvent, Observation, Catalog } from "./protocol.js";
declare const Prism: { highlightElement(e: Element): void };
const get = (id: string) => document.getElementById(id)!;
const run = get("run") as HTMLButtonElement,
  select = get("observation-select") as HTMLSelectElement,
  picker = get("session-picker") as HTMLSelectElement;
const rows: LabEvent[] = [],
  observations: Observation[] = [];
let capability = "",
  complete = false,
  catalog: Catalog = { checkpoints: [], messages: [] };
function json(id: string, v: unknown) {
  get(id).textContent = JSON.stringify(v, null, 2);
  Prism.highlightElement(get(id));
}
function preview() {
  const entry = catalog.messages.find((s) => s.checkpointId === picker.value);
  json("messages", entry || {});
}
picker.onchange = preview;
select.onchange = () =>
  json("selected-observation", observations[Number(select.value)]);
(get("resume-session") as HTMLButtonElement).onclick = async () => {
  const response = await fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: capability, checkpointId: picker.value }),
  });
  get("choice-status").textContent = await response.text();
  if (response.ok) {
    capability = "";
    (get("resume-session") as HTMLButtonElement).disabled = true;
  }
};
function show(e: LabEvent) {
  rows.push(e);
  if (e.type === "options") json("options", e.options);
  if (e.type === "catalog") {
    catalog = e.catalog;
    json("catalog", catalog.checkpoints);
    picker.replaceChildren();
    for (const s of catalog.checkpoints) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.title.slice(0, 80) + " · " + s.id;
      picker.append(o);
    }
    preview();
  }
  if (e.type === "choose") {
    capability = e.id;
    picker.value = e.preferred;
    get("choice-status").textContent =
      "Choose a captured restore point and click Rewind selected checkpoint.";
    (get("resume-session") as HTMLButtonElement).disabled = false;
    preview();
  }
  if (e.type === "answer") {
    const p = document.createElement("article");
    renderMarkdown(p, e.text);
    get("conversation").append(p);
  }
  if (e.type === "result") {
    const tr = document.createElement("tr");
    for (const value of [
      e.record.index,
      e.record.label,
      e.record.pid,
      e.record.status,
      e.record.sessionId,
      e.record.text,
    ]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.append(td);
    }
    get("result-history").append(tr);
    const card = document.createElement("article");
    card.className = "branch-card";
    const title = document.createElement("h3");
    title.textContent = e.record.label;
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = "session_id: " + e.record.sessionId;
    const text = document.createElement("div");
    renderMarkdown(text, e.record.text);
    card.append(title, meta, text);
    get("branch-cards").append(card);
    json("latest-result", e.record);
  }
  if (e.type === "observation") {
    observations.push(e.record);
    const o = document.createElement("option");
    o.value = String(observations.length - 1);
    o.textContent = `${e.record.sequence} · ${e.record.atMs} ms · ${e.record.kind}`;
    select.append(o);
    select.value = o.value;
    json("selected-observation", e.record);
  }
  if (e.type === "evidence") {
    json("evidence", e);
    for (const [id, value] of [
      ["file-before", e.before],
      ["file-edited", e.afterEdit],
      ["file-after", e.after],
    ] as const) {
      const state = value as {
        main: string | null;
        note: string | null;
        shell: string | null;
      };
      get(id).textContent =
        (state.main || "// math.mts missing") +
        "\n// note.txt: " +
        (state.note ?? "not present") +
        "\n// untracked.txt: " +
        (state.shell ?? "not present");
      Prism.highlightElement(get(id));
    }
    json("storage", {
      before: e.before,
      afterEdit: e.afterEdit,
      after: e.after,
      checkpoints: e.checkpoints,
      rewinds: e.rewinds,
      validation: e.validation,
      storage: e.storage,
      exceptions: e.exceptions,
    });
    complete = true;
  }
  if (e.type === "error") get("status").textContent = e.text;
}
run.onclick = async () => {
  for (const id of ["file-before", "file-edited", "file-after"])
    get(id).textContent = "";
  rows.length = 0;
  observations.length = 0;
  complete = false;
  capability = "";
  catalog = { checkpoints: [], messages: [] };
  select.replaceChildren();
  picker.replaceChildren();
  get("conversation").replaceChildren();
  get("branch-cards").replaceChildren();
  get("result-history").replaceChildren();
  for (const id of [
    "options",
    "messages",
    "catalog",
    "latest-result",
    "selected-observation",
    "evidence",
    "storage",
  ])
    json(id, {});
  (get("resume-session") as HTMLButtonElement).disabled = true;
  get("choice-status").textContent =
    "Select a captured checkpoint to inspect its pre-turn snapshot.";
  run.disabled = true;
  get("status").textContent = "Running real SDK processes…";
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: (get("mode") as HTMLSelectElement).value }),
    });
    if (!response.ok || !response.body) throw new Error(await response.text());
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (frame.startsWith("data: ")) show(JSON.parse(frame.slice(6)));
      }
      if (done) break;
    }
    if (complete)
      get("status").textContent = "Complete · actual SDK evidence ready";
  } catch (e) {
    get("status").textContent = e instanceof Error ? e.message : "Run failed.";
  } finally {
    run.disabled = false;
  }
};
get("download").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "lesson42-actual-events.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const c = await (await fetch("/api/config")).json();
run.disabled = !c.ready;
get("configuration").textContent = c.ready
  ? `Model: ${c.model} · SDK ${c.typescriptVersion} · key configured privately on server`
  : "Configure .env and restart. See How to run.";
