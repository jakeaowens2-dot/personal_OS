import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = process.env.PERSONAL_ASSISTANT_PORT || "3016";
console.log(`Personal assistant: http://localhost:${port}/assistant`);
console.log(
  "Uses this machine's ChatGPT Codex login. Keep this process running while chatting.",
);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    ),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      TZ: "America/Chicago",
      PERSONAL_ASSISTANT_LOCAL: "1",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
