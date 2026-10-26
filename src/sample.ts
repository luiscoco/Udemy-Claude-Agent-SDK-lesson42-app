import { runAgent, validateConfig } from "./agent.js";
await runAgent(
  validateConfig({ mode: process.argv[2] || "restore" }),
  (e) => {
    if (e.type === "result" || e.type === "evidence")
      console.log(JSON.stringify(e));
  },
  new AbortController(),
  true,
);
