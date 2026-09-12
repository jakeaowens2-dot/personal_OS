const { execFileSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const name = `personal-os-assistant-test-${process.pid}`;
const docker = (args, options = {}) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
try {
  docker([
    "run",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=assistant-test-only",
    "-v",
    `${root}:/workspace:ro`,
    "-d",
    "postgres:17",
  ]);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready.");
  const output = docker([
    "exec",
    name,
    "psql",
    "-U",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "/workspace/scripts/assistant-db.test.sql",
  ]);
  console.log(output.slice(output.lastIndexOf("result")));
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  try {
    docker(["rm", "-f", name]);
  } catch {}
}
