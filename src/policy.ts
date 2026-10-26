import { resolve } from "node:path";
import { BUG } from "./workspace.js";
export const SHELL_COMMAND = "printf 'SHELL-42' > untracked.txt";
export function safeShellTarget(cwd: string, value: unknown) {
  const i = value as { command?: unknown };
  if (!i || typeof i.command !== "string") return false;
  if (i.command === SHELL_COMMAND) return true;
  const prefix = "printf 'SHELL-42' > ";
  if (!i.command.startsWith(prefix)) return false;
  let path = i.command.slice(prefix.length).trim();
  if (
    (path.startsWith('"') && path.endsWith('"')) ||
    (path.startsWith("'") && path.endsWith("'"))
  )
    path = path.slice(1, -1);
  return resolve(cwd, path) === resolve(cwd, "untracked.txt");
}
export function allowedTool(
  cwd: string,
  name: string,
  value: unknown,
  allowShell = false,
) {
  if (!value || typeof value !== "object") return false;
  const i = value as Record<string, unknown>;
  if (name === "Bash") return allowShell && safeShellTarget(cwd, i);
  if (typeof i.file_path !== "string") return false;
  const file = resolve(cwd, i.file_path),
    main = resolve(cwd, "math.mts"),
    note = resolve(cwd, "note.txt");
  if (name === "Read")
    return [main, note, resolve(cwd, "untracked.txt")].includes(file);
  if (name === "Edit")
    return (
      file === main &&
      typeof i.old_string === "string" &&
      typeof i.new_string === "string" &&
      i.old_string.length <= 200 &&
      i.new_string.length <= 200 &&
      ["BASE-42", "EDITED-42", "SECOND-42"].some((v) =>
        (i.new_string as string).includes(v),
      )
    );
  if (name === "Write")
    return (
      typeof i.content === "string" &&
      ((file === main && i.content.trim() === BUG.trim()) ||
        (file === note && i.content.trim() === "CREATED-42"))
    );
  return false;
}
