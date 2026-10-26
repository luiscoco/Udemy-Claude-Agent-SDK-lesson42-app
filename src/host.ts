import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { WorkerRequest } from "./worker.js";
export function runWorker(
  request: WorkerRequest,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  onEvent: (type: string, value: any) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./worker.ts", import.meta.url)),
      ],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    const lines = createInterface({ input: child.stdout });
    let ended = false;
    const abort = () => {
      if (!ended) child.stdin.write('{"cancel":true}\n');
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdin.write(JSON.stringify(request) + "\n");
    if (signal.aborted) abort();
    lines.on("line", (line) => {
      try {
        const row = JSON.parse(line);
        onEvent(row.type, row.value);
      } catch {
        reject(new Error("Invalid SDK worker event."));
      }
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      ended = true;
      signal.removeEventListener("abort", abort);
      lines.close();
      code === 0
        ? resolve()
        : reject(new Error("SDK worker exited before completing the request."));
    });
  });
}
