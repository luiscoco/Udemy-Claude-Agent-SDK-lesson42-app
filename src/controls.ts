import { randomUUID } from "node:crypto";
const pending = new Map<
  string,
  { ids: Set<string>; resolve: (id: string) => void }
>();
export function chooseSession(ids: string[], signal: AbortSignal) {
  const id = randomUUID();
  let remove = () => {};
  const selection = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      remove();
      reject(new Error("Session selection timed out."));
    }, 120000);
    const abort = () => {
      remove();
      reject(new Error("Session selection cancelled."));
    };
    remove = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      pending.delete(id);
    };
    pending.set(id, {
      ids: new Set(ids),
      resolve: (value) => {
        remove();
        resolve(value);
      },
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  return { id, selection, dispose: remove };
}
export function applyControl(value: unknown) {
  const c = value as { id?: unknown; sessionId?: unknown };
  if (!c || typeof c.id !== "string" || typeof c.sessionId !== "string")
    throw new Error("Provide a run capability and session ID.");
  const p = pending.get(c.id);
  if (!p) return false;
  if (!p.ids.has(c.sessionId))
    throw new Error("Select a session listed for this classroom run.");
  p.resolve(c.sessionId);
  return true;
}
