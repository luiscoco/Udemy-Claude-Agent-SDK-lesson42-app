import {
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  access,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const BASE =
  'export const marker = "BASE-42";\nexport function add(a: number, b: number) { return a + b; }\n';
export const BUG =
  'export const marker = "BUG-42";\nexport function add(a: number, b: number) { return a - b; }\n';
export async function prepareWorkspace() {
  const parent = resolve(realpathSync.native(tmpdir()), "claude-sdk42"),
    root = resolve(parent, randomUUID());
  const safe = () => {
    const p = relative(parent, root);
    if (!p || p.startsWith("..") || isAbsolute(p))
      throw new Error("Invalid classroom workspace.");
  };
  safe();
  const cwd = join(root, "project"),
    home = join(root, "home"),
    sdkHome = join(root, "sdk");
  for (const p of [cwd, home, sdkHome]) await mkdir(p, { recursive: true });
  await writeFile(join(cwd, "math.mts"), BASE);
  await writeFile(
    join(cwd, "verify.test.mjs"),
    'import{test}from"node:test";import assert from"node:assert/strict";import{add}from"./math.mts";test("adds 2 and 3",()=>assert.equal(add(2,3),5));',
  );
  async function optional(name: string) {
    try {
      return await readFile(join(cwd, name), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async function snapshot() {
    const main = await optional("math.mts"),
      note = await optional("note.txt"),
      shell = await optional("untracked.txt");
    return {
      main,
      note,
      shell,
      mainHash: createHash("sha256")
        .update(main || "")
        .digest("hex"),
    };
  }
  return {
    cwd,
    home,
    sdkHome,
    snapshot,
    async test() {
      try {
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const r = await exec(process.execPath, ["--test", "verify.test.mjs"], {
          cwd,
          timeout: 20000,
          env,
        });
        return { passed: true, output: r.stdout };
      } catch (e) {
        return {
          passed: false,
          output: (e as { stdout?: string }).stdout || String(e),
        };
      }
    },
    async saveIds(value: unknown) {
      await writeFile(join(root, "restore.json"), JSON.stringify(value));
      return JSON.parse(await readFile(join(root, "restore.json"), "utf8"));
    },
    async inspect() {
      const files: string[] = [];
      async function visit(dir: string) {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) await visit(p);
          else files.push(relative(sdkHome, p));
        }
      }
      await visit(sdkHome);
      return {
        transcripts: files.filter((p) => p.endsWith(".jsonl")),
        backupFiles: files.filter((p) => p.includes("file-history")),
      };
    },
    async cleanup() {
      safe();
      await rm(root, { recursive: true, force: true });
    },
  };
}
