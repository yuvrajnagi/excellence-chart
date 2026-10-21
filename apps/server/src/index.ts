import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createId, createWorkbook, parseWorkbook } from "@openexcel/model";
import type { Workbook } from "@openexcel/model";

const port = Number(process.env.PORT ?? 3001);
const dataDir = resolve(process.env.DATA_DIR ?? process.env.OPENEXCEL_DATA_DIR ?? ".data");
const file = join(dataDir, "workbook.json");
let workbook: Workbook | undefined;

async function load() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(file)) return;
  try { const parsed = parseWorkbook(JSON.parse(await readFile(file, "utf8"))); workbook = parsed.ok ? parsed.value : undefined; }
  catch { workbook = undefined; }
}
async function save() { if (workbook) await writeFile(file, JSON.stringify(workbook), "utf8"); }
const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); };
const readBody = async (req: import("node:http").IncomingMessage) => { let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 10_000_000) throw new Error("Payload too large"); } return JSON.parse(body || "{}") as unknown; };

await load();
const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
    if (req.url === "/api/health" && req.method === "GET") return json(res, 200, { status: "ok", apiVersion: 1, workbookSchemaVersion: 1 });
    if (req.url === "/api/workbook" && req.method === "GET") return json(res, 200, { workbook: workbook ?? (workbook = createWorkbook({ id: createId("workbook"), sheetId: createId("sheet"), name: "Untitled workbook", timestamp: new Date().toISOString() })) });
    if (req.url === "/api/workbook" && req.method === "PUT") { const body = await readBody(req); const parsed = parseWorkbook((body as { workbook?: unknown }).workbook ?? body); if (!parsed.ok) return json(res, 400, { error: parsed.error }); workbook = parsed.value; await save(); return json(res, 200, { saved: true, revision: workbook.revision }); }
    return json(res, 404, { error: "Not found" });
  } catch (error) { return json(res, 500, { error: error instanceof Error ? error.message : "Internal error" }); }
});
server.listen(port, "0.0.0.0", () => console.log(`OpenExcel API listening on http://127.0.0.1:${port}`));
