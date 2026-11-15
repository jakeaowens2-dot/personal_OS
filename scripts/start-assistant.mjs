import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = process.env.PERSONAL_ASSISTANT_PORT || "3016";
const mode = process.env.PERSONAL_ASSISTANT_NEXT_MODE === "start" ? "start" : "dev";
console.log(`Personal assistant (${mode}): http://localhost:${port}/assistant`);
console.log(
  "Uses this machine's ChatGPT Codex login. Keep this process running while chatting.",
);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    ),
    mode,
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
      TZ: "America/Los_Angeles",
      PERSONAL_ASSISTANT_LOCAL: "1",
    },
  },
);
// Next 16 points the tracked declaration at .next/dev during local startup.
// The project already includes dev types through tsconfig; restore the stable
// generated import so opening the desktop app does not dirty the repository.
async function restoreStableNextDeclaration() {
  if (mode !== "dev") return;
  const path = join(root, "next-env.d.ts");
  try {
    const current = await readFile(path, "utf8");
    const stable = current.replace("./.next/dev/types/routes.d.ts", "./.next/types/routes.d.ts");
    if (stable !== current) await writeFile(path, stable);
  } catch (error) {
    console.warn("Could not restore next-env.d.ts after local startup:", error.message);
  }
}
if (mode === "dev") {
  const declarationTimer = setInterval(() => void restoreStableNextDeclaration(), 750);
  setTimeout(() => clearInterval(declarationTimer), 6_000);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  void restoreStableNextDeclaration();
  process.exitCode = code ?? 0;
});
