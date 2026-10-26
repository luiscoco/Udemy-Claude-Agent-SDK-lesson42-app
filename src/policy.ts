import { resolve } from "node:path";
import { BUG } from "./workspace.js";
export const SHELL_COMMAND = "printf 'SHELL-42' > untracked.txt";
export function allowedTool(
  cwd: string,
  name: string,
  value: unknown,
  allowShell = false,
) {
  if (!value || typeof value !== "object") return false;
  const i = value as Record<string, unknown>;
  if (name === "Bash") return allowShell && i.command === SHELL_COMMAND;
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
