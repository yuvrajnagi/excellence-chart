import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const compiler = spawn(process.execPath, ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"], {
  cwd: root,
  stdio: "inherit",
});
const [compileCode] = await once(compiler, "exit");
if (compileCode !== 0) process.exit(typeof compileCode === "number" ? compileCode : 1);

const children = [
  spawn(process.execPath, ["node_modules/typescript/bin/tsc", "-b", "--watch", "--preserveWatchOutput"], {
    cwd: root, stdio: "inherit",
  }),
  spawn(process.execPath, ["--watch", "apps/server/dist/main.js"], {
    cwd: root, stdio: "inherit",
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"], {
    cwd: root, stdio: "inherit",
  }),
];
let closing = false;
async function close(code) {
  if (closing) return;
  closing = true;
  const exits = children.filter((child) => child.exitCode === null).map(async (child) => {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  });
  await Promise.all(exits);
  process.exitCode = code;
}
process.once("SIGINT", () => void close(130));
process.once("SIGTERM", () => void close(143));
for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    void close(1);
  });
  child.once("exit", (code) => {
    if (!closing) void close(code ?? 1);
  });
}
