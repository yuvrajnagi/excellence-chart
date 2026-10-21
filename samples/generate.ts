import { mkdir, writeFile } from "node:fs/promises";
import { applyTransaction, createId, createWorkbook } from "@openexcel/model";
import type { Patch } from "@openexcel/model";
import { exportWorkbook } from "@openexcel/interop";

const timestamp = new Date().toISOString();
const sheetId = createId("sheet");
let workbook = createWorkbook({ id: createId("workbook"), sheetId, name: "Excel_Compatibility_Challenge", timestamp });
const patches: Patch[] = [
  [0, 0, "Revenue"], [0, 1, "Costs"], [0, 2, "Profit"], [1, 0, 125000], [1, 1, 70000],
  [1, 2, "=A2-B2"], [2, 0, 150000], [2, 1, 82000], [2, 2, "=A3-B3"],
  [3, 0, 175000], [3, 1, 91000], [3, 2, "=A4-B4"], [5, 0, "Total"], [5, 2, "=SUM(C2:C4)"],
].map(([row, col, value]) => ({ kind: "cell", at: { sheetId, row: row as number, col: col as number }, cell: { input: typeof value === "string" && value.startsWith("=") ? { kind: "formula", source: value } : { kind: "value", value: value as number | string } } }));
const result = applyTransaction(workbook, { id: createId("transaction"), baseRevision: workbook.revision, label: "Create compatibility challenge", timestamp, patches });
if (!result.ok) throw new Error(result.error.message);
workbook = result.value.workbook;
await mkdir("examples", { recursive: true });
await writeFile("examples/Excel_Compatibility_Challenge.json", JSON.stringify(workbook, null, 2));
const cache = { revision: workbook.revision, values: { [sheetId]: { "1:2": 55000, "2:2": 68000, "3:2": 84000, "5:2": 207000 } } };
const exported = await exportWorkbook(workbook, { file: { format: "xlsx", csvEscapeFormulas: true }, cache, limits: (await import("@openexcel/interop")).DEFAULT_INTEROP_LIMITS });
if (!exported.ok) throw new Error(exported.error.message);
await writeFile("examples/Excel_Compatibility_Challenge.xlsx", exported.value.bytes);
console.log("Generated examples/Excel_Compatibility_Challenge.xlsx");
