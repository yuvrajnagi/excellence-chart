import { createWorkbook, createId, applyTransaction, parseWorkbook } from "@openexcel/model";
import type { CellStyle, SheetId, WorkbookId, Patch } from "@openexcel/model";
import { styleSchema } from "../../packages/model/src/schemas.js";
import { styleToCSS } from "@openexcel/formatting";
import { exportWorkbook, importWorkbook } from "@openexcel/interop";
import ExcelJS from "exceljs";

console.log("=== STRESS TEST 1: STRIKETHROUGH STYLING ===");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

// 1. Zod schema validation
console.log("\n--- 1.1 Zod Schema Validation ---");
const validStyles: CellStyle[] = [
  { font: { strikethrough: true } },
  { font: { strikethrough: false } },
  { font: { strikethrough: undefined } },
  { font: { strikethrough: true, underline: true, bold: true, italic: true } },
  { font: { strikethrough: true, size: 14, family: "Calibri", color: "#FF0000" } },
];

for (const s of validStyles) {
  const result = styleSchema.safeParse(s);
  assert(result.success, `styleSchema accepts valid strikethrough style: ${JSON.stringify(s.font)}`);
}

// Invalid types
const invalid1 = styleSchema.safeParse({ font: { strikethrough: "yes" } });
assert(!invalid1.success, "styleSchema rejects non-boolean strikethrough string");
const invalid2 = styleSchema.safeParse({ font: { strikethrough: 1 } });
assert(!invalid2.success, "styleSchema rejects non-boolean strikethrough number");

// 2. CSS Generation
console.log("\n--- 1.2 CSS Generation (styleToCSS) ---");
const cssStrike = styleToCSS({ font: { strikethrough: true } });
assert(cssStrike.textDecoration === "line-through", `strikethrough alone produces 'line-through' (got: '${cssStrike.textDecoration}')`);

const cssUnderline = styleToCSS({ font: { underline: true } });
assert(cssUnderline.textDecoration === "underline", `underline alone produces 'underline' (got: '${cssUnderline.textDecoration}')`);

const cssBoth = styleToCSS({ font: { underline: true, strikethrough: true } });
assert(cssBoth.textDecoration === "underline line-through", `underline + strikethrough produces 'underline line-through' (got: '${cssBoth.textDecoration}')`);

const cssNeither = styleToCSS({ font: { bold: true } });
assert(cssNeither.textDecoration === undefined, `neither underline nor strikethrough leaves textDecoration undefined (got: '${cssNeither.textDecoration}')`);

const cssFalseBoth = styleToCSS({ font: { underline: false, strikethrough: false } });
assert(cssFalseBoth.textDecoration === undefined, `false underline and strikethrough leaves textDecoration undefined (got: '${cssFalseBoth.textDecoration}')`);

// 3. Workbook schema with strikethrough
console.log("\n--- 1.3 Workbook Schema & Transaction Serialization ---");
const wbId = createId("workbook") as WorkbookId;
const s1Id = createId("sheet") as SheetId;
let wb = createWorkbook({ id: wbId, sheetId: s1Id, name: "StrikeTest" });

const strikeStyleId = createId("style");
const underlineStyleId = createId("style");
const comboStyleId = createId("style");

const patches: Patch[] = [
  {
    kind: "style",
    styleId: strikeStyleId,
    style: { font: { strikethrough: true, color: "#112233" } },
  },
  {
    kind: "style",
    styleId: underlineStyleId,
    style: { font: { underline: true } },
  },
  {
    kind: "style",
    styleId: comboStyleId,
    style: { font: { underline: true, strikethrough: true, bold: true } },
  },
  {
    kind: "cell",
    at: { sheetId: s1Id, row: 0, col: 0 },
    cell: { input: { kind: "value", value: "Strikethrough Only" }, styleId: strikeStyleId },
  },
  {
    kind: "cell",
    at: { sheetId: s1Id, row: 1, col: 0 },
    cell: { input: { kind: "value", value: "Underline Only" }, styleId: underlineStyleId },
  },
  {
    kind: "cell",
    at: { sheetId: s1Id, row: 2, col: 0 },
    cell: { input: { kind: "value", value: "Both Combined" }, styleId: comboStyleId },
  },
];

const tx = applyTransaction(wb, {
  id: createId("transaction"),
  baseRevision: wb.revision,
  label: "Apply Strikethrough Styles",
  timestamp: new Date().toISOString(),
  patches,
});

assert(tx.ok, "Transaction with strikethrough styles applies successfully");
if (tx.ok) {
  wb = tx.value.workbook;
  const parsedWb = parseWorkbook(wb);
  assert(parsedWb.ok, "Workbook with strikethrough styles passes strict parseWorkbook validation");
}

// 4. XLSX Round-trip and OOXML Font Strike Verification
console.log("\n--- 1.4 XLSX Export / Import Round-trip ---");
async function testXlsxRoundtrip() {
  const xlsxBytes = await exportWorkbook(wb);
  assert(xlsxBytes.byteLength > 0, `Exported XLSX is non-empty (${xlsxBytes.byteLength} bytes)`);

  // Load with ExcelJS to inspect native font properties directly
  const excelWorkbook = new ExcelJS.Workbook();
  await excelWorkbook.xlsx.load(Buffer.from(xlsxBytes));
  const ws = excelWorkbook.getWorksheet(1)!;

  const cellStrike = ws.getCell("A1");
  assert(cellStrike.font?.strike === true, `ExcelJS sees strike=true on cell A1 (got: ${cellStrike.font?.strike})`);

  const cellUnderline = ws.getCell("A2");
  assert(cellUnderline.font?.underline === true && !cellUnderline.font?.strike, `ExcelJS sees underline=true and strike=false on A2`);

  const cellCombo = ws.getCell("A3");
  assert(cellCombo.font?.strike === true && cellCombo.font?.underline === true && cellCombo.font?.bold === true,
    `ExcelJS sees strike=true, underline=true, bold=true on A3`);

  // Import back via OpenExcel importWorkbook
  const importedResult = await importWorkbook(xlsxBytes, { name: "ReimportedStrike" });
  assert(importedResult.workbook !== undefined, "importWorkbook succeeds on exported XLSX");

  const importedWb = importedResult.workbook;
  const impCell0 = importedWb.sheets[importedWb.sheetOrder[0]!]?.tiles["0:0"]?.["0:0"];
  const impStyle0 = impCell0?.styleId ? importedWb.styles[impCell0.styleId] : undefined;
  assert(impStyle0?.font?.strikethrough === true, `Re-imported cell A1 preserves strikethrough: true`);

  const impCell2 = importedWb.sheets[importedWb.sheetOrder[0]!]?.tiles["0:0"]?.["2:0"];
  const impStyle2 = impCell2?.styleId ? importedWb.styles[impCell2.styleId] : undefined;
  assert(impStyle2?.font?.strikethrough === true && impStyle2?.font?.underline === true,
    `Re-imported cell A3 preserves both strikethrough: true and underline: true`);
}

await testXlsxRoundtrip();

console.log(`\nStrikethrough Stress Test Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
