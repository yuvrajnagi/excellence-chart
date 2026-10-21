// Development startup script
// Starts the backend server and Vite dev server concurrently
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env["PORT"] ?? "3001";
const WEB_PORT = process.env["WEB_PORT"] ?? "5173";
const DATA_DIR = process.env["DATA_DIR"] ?? resolve(root, ".data");

console.log(`\n  🟢 OpenExcel Development Server`);
console.log(`  ═══════════════════════════════`);
console.log(`  Backend:   http://127.0.0.1:${PORT}`);
console.log(`  Frontend:  http://127.0.0.1:${WEB_PORT}`);
console.log(`  Data dir:  ${DATA_DIR}\n`);

// Build TypeScript first
console.log("  ⏳ Compiling TypeScript...");
const tsc = spawn("npx", ["--no-install", "tsc", "-b", "--pretty", "false"], {
  cwd: root, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" },
});

tsc.on("close", (code) => {
  if (code !== 0) {
    console.error("  ❌ TypeScript compilation failed");
    process.exit(1);
  }
  console.log("  ✅ TypeScript compiled\n");

  // Start backend server
  const server = spawn("node", ["--import", "tsx", "apps/server/src/index.ts"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT, DATA_DIR,
      STATIC_DIR: resolve(root, "apps/web/dist"),
      NODE_ENV: "development",
    },
  });

  // Start Vite dev server
  const vite = spawn("npx", ["--no-install", "vite", "--config", "apps/web/vite.config.ts"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT, WEB_PORT },
  });

  const cleanup = () => {
    server.kill("SIGTERM");
    vite.kill("SIGTERM");
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  server.on("close", (code) => {
    console.log(`  Server exited with code ${code}`);
    vite.kill("SIGTERM");
    process.exit(code ?? 1);
  });

  vite.on("close", (code) => {
    console.log(`  Vite exited with code ${code}`);
    server.kill("SIGTERM");
    process.exit(code ?? 1);
  });
});
