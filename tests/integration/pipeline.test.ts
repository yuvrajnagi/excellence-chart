import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	aggregate,
	goalSeek,
	pivotRows,
	readRows,
	refreshPivot,
	removeDuplicates,
	sortRange,
	textToColumns,
} from "@openexcel/data";
import { colorScale, formatValue, styleToCSS } from "@openexcel/formatting";
import { adjustFormulaReferences, createEngine } from "@openexcel/formula";
import {
	DEFAULT_INTEROP_LIMITS,
	exportWorkbook,
	importWorkbook,
} from "@openexcel/interop";
import type {
	CellAddress,
	CellKey,
	CellStyle,
	ComputedValue,
	ObjectId,
	Patch,
	PivotDefinition,
	RangeRef,
	Scalar,
	SheetId,
	TableDefinition,
	TileKey,
	Workbook,
	WorkbookId,
} from "@openexcel/model";
import {
	applyTransaction,
	createHistory,
	createId,
	createWorkbook,
	DEFAULT_LIMITS,
	entries,
	getCell,
	hiddenRows,
	matchesFilter,
} from "@openexcel/model";
import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError, WorkbookStore } from "../../apps/server/src/storage.js";

describe("OpenExcel full end-to-end integration pipeline", () => {
	let tempDir: string;
	let dbPath: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "openexcel-integration-"));
		dbPath = join(tempDir, "openexcel-wal.sqlite");
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup error if already removed
		}
	});

	it("executes full pipeline: creation -> tiles -> formulas -> format -> filter & sort -> pivot -> XLSX manifest -> SQLite WAL", async () => {
		// -------------------------------------------------------------------------
		// 1. WORKBOOK CREATION
		// -------------------------------------------------------------------------
		const workbookId = createId("workbook") as WorkbookId;
		const sheet1Id = createId("sheet") as SheetId;
		const summarySheetId = createId("sheet") as SheetId;
		const initialTimestamp = "2026-10-23T06:00:00.000Z";

		let workbook = createWorkbook({
			id: workbookId,
			sheetId: sheet1Id,
			name: "Executive_Financial_Model",
			timestamp: initialTimestamp,
		});

		// Add Summary worksheet to workbook
		const addSheetTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Add Summary Sheet",
			timestamp: initialTimestamp,
			patches: [
				{
					kind: "sheet",
					sheetId: summarySheetId,
					sheet: {
						id: summarySheetId,
						tiles: {},
						properties: {
							...workbook.sheets[sheet1Id]!.properties,
							name: "Summary",
						},
					},
				},
				{
					kind: "sheetOrder",
					order: [sheet1Id, summarySheetId],
				},
			],
		});
		expect(addSheetTx.ok).toBe(true);
		if (!addSheetTx.ok) throw new Error(addSheetTx.error.message);
		workbook = addSheetTx.value.workbook;
		expect(workbook.sheetOrder).toEqual([sheet1Id, summarySheetId]);
		expect(workbook.sheets[summarySheetId]?.properties.name).toBe("Summary");

		// -------------------------------------------------------------------------
		// 2. TILE STORAGE & MULTI-TILE SPARSE REPRESENTATION
		// -------------------------------------------------------------------------
		// Populate data across multiple 128x64 tiles:
		// Tile 0:0 -> Row 0..127, Col 0..63
		// Tile 1:0 -> Row 128..255, Col 0..63
		// Tile 0:1 -> Row 0..127, Col 64..127
		const tilePatches: Patch[] = [
			// Tile 0:0 headers and sales data
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 0, col: 0 },
				cell: { input: { kind: "value", value: "Department" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 0, col: 1 },
				cell: { input: { kind: "value", value: "Representative" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 0, col: 2 },
				cell: { input: { kind: "value", value: "Region" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 0, col: 3 },
				cell: { input: { kind: "value", value: "QuarterlySales" } },
			},
			// Sales rows (Row 1 to Row 4)
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 1, col: 0 },
				cell: { input: { kind: "value", value: "Software" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 1, col: 1 },
				cell: { input: { kind: "value", value: "Alice" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 1, col: 2 },
				cell: { input: { kind: "value", value: "North" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 1, col: 3 },
				cell: { input: { kind: "value", value: 12000 } },
			},

			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 2, col: 0 },
				cell: { input: { kind: "value", value: "Hardware" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 2, col: 1 },
				cell: { input: { kind: "value", value: "Bob" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 2, col: 2 },
				cell: { input: { kind: "value", value: "South" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 2, col: 3 },
				cell: { input: { kind: "value", value: 8500 } },
			},

			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 3, col: 0 },
				cell: { input: { kind: "value", value: "Software" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 3, col: 1 },
				cell: { input: { kind: "value", value: "Carol" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 3, col: 2 },
				cell: { input: { kind: "value", value: "North" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 3, col: 3 },
				cell: { input: { kind: "value", value: 15400 } },
			},

			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 4, col: 0 },
				cell: { input: { kind: "value", value: "Cloud" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 4, col: 1 },
				cell: { input: { kind: "value", value: "Dave" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 4, col: 2 },
				cell: { input: { kind: "value", value: "East" } },
			},
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 4, col: 3 },
				cell: { input: { kind: "value", value: 22100 } },
			},

			// Cells in distant tiles:
			// Tile 1:0 (row 130, col 2)
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 130, col: 2 },
				cell: { input: { kind: "value", value: "DistantTile_1_0" } },
			},
			// Tile 0:1 (row 5, col 70)
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 5, col: 70 },
				cell: { input: { kind: "value", value: "DistantTile_0_1" } },
			},
		];

		const populateTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Populate sparse tiles",
			timestamp: initialTimestamp,
			patches: tilePatches,
		});
		expect(populateTx.ok).toBe(true);
		if (!populateTx.ok) throw new Error(populateTx.error.message);
		workbook = populateTx.value.workbook;

		// Verify tile distribution in sheet1
		const sheet1 = workbook.sheets[sheet1Id]!;
		expect(sheet1.tiles["0:0"]).toBeDefined();
		expect(sheet1.tiles["1:0"]).toBeDefined();
		expect(sheet1.tiles["0:2"]).toBeDefined();
		expect(
			getCell(workbook, { sheetId: sheet1Id, row: 130, col: 2 })?.input,
		).toEqual({ kind: "value", value: "DistantTile_1_0" });
		expect(
			getCell(workbook, { sheetId: sheet1Id, row: 5, col: 70 })?.input,
		).toEqual({ kind: "value", value: "DistantTile_0_1" });

		// -------------------------------------------------------------------------
		// 3. FORMULA EVALUATION (Cross-sheet, Cycles #CIRC!, Dynamic Spills #SPILL!)
		// -------------------------------------------------------------------------
		const formulaPatches: Patch[] = [
			// Sheet1 Total formula in D6 (row 5, col 3)
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 5, col: 3 },
				cell: { input: { kind: "formula", source: "=SUM(D2:D5)" } },
			},

			// Summary sheet cross-sheet reference: '=Sheet1!D6 * 1.10' in B2 (row 1, col 1)
			{
				kind: "cell",
				at: { sheetId: summarySheetId, row: 1, col: 0 },
				cell: { input: { kind: "value", value: "Projected Revenue" } },
			},
			{
				kind: "cell",
				at: { sheetId: summarySheetId, row: 1, col: 1 },
				cell: { input: { kind: "formula", source: "=Sheet1!D6*1.1" } },
			},

			// Circular reference detection on Summary sheet:
			// Cell C1 (row 0, col 2) = '=C2 + 5'
			// Cell C2 (row 1, col 2) = '=C1 * 2'
			{
				kind: "cell",
				at: { sheetId: summarySheetId, row: 0, col: 2 },
				cell: { input: { kind: "formula", source: "=C2+5" } },
			},
			{
				kind: "cell",
				at: { sheetId: summarySheetId, row: 1, col: 2 },
				cell: { input: { kind: "formula", source: "=C1*2" } },
			},

			// Dynamic array spill on Summary sheet:
			// Cell E1 (row 0, col 4) = '=SEQUENCE(3, 2, 10, 5)'
			// Spills over rows 0..2, cols 4..5
			{
				kind: "cell",
				at: { sheetId: summarySheetId, row: 0, col: 4 },
				cell: { input: { kind: "formula", source: "=SEQUENCE(3, 2, 10, 5)" } },
			},
		];

		const formulaTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Add formulas",
			timestamp: initialTimestamp,
			patches: formulaPatches,
		});
		expect(formulaTx.ok).toBe(true);
		if (!formulaTx.ok) throw new Error(formulaTx.error.message);
		workbook = formulaTx.value.workbook;

		const engine = createEngine(workbook);

		// Verify SUM in Sheet1: 12000 + 8500 + 15400 + 22100 = 58000
		const sumResult = engine.value({ sheetId: sheet1Id, row: 5, col: 3 });
		expect(sumResult).toBe(58000);

		// Verify cross-sheet reference in Summary: 58000 * 1.1 = 63800
		const crossSheetResult = engine.value({
			sheetId: summarySheetId,
			row: 1,
			col: 1,
		});
		expect(Number(crossSheetResult)).toBeCloseTo(63800, 2);

		// Verify cycle detection returns #CIRC! without hanging or throwing
		const circResult1 = engine.value({
			sheetId: summarySheetId,
			row: 0,
			col: 2,
		});
		const circResult2 = engine.value({
			sheetId: summarySheetId,
			row: 1,
			col: 2,
		});
		expect(circResult1).toEqual({ kind: "error", code: "#CIRC!" });
		expect(circResult2).toEqual({ kind: "error", code: "#CIRC!" });

		// Verify dynamic array spill:
		// Anchor E1 has SEQUENCE(3, 2, 10, 5)
		// Row 0: E1=10, F1=15
		// Row 1: E2=20, F2=25
		// Row 2: E3=30, F3=35
		const anchorVal = engine.value({ sheetId: summarySheetId, row: 0, col: 4 });
		expect(typeof anchorVal).toBe("object");
		expect(anchorVal).not.toBeNull();
		if (
			typeof anchorVal === "object" &&
			anchorVal &&
			"kind" in anchorVal &&
			anchorVal.kind === "array"
		) {
			expect(anchorVal.rows).toBe(3);
			expect(anchorVal.cols).toBe(2);
			expect(anchorVal.values).toEqual([10, 15, 20, 25, 30, 35]);
		}
		// Verify spilled cells queried directly from engine:
		expect(engine.value({ sheetId: summarySheetId, row: 0, col: 5 })).toBe(15);
		expect(engine.value({ sheetId: summarySheetId, row: 1, col: 4 })).toBe(20);
		expect(engine.value({ sheetId: summarySheetId, row: 1, col: 5 })).toBe(25);
		expect(engine.value({ sheetId: summarySheetId, row: 2, col: 4 })).toBe(30);
		expect(engine.value({ sheetId: summarySheetId, row: 2, col: 5 })).toBe(35);

		// Dynamic spill collision test (#SPILL!):
		// Insert an obstructing value at F2 (row 1, col 5)
		const blockTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Block spill",
			timestamp: initialTimestamp,
			patches: [
				{
					kind: "cell",
					at: { sheetId: summarySheetId, row: 1, col: 5 },
					cell: { input: { kind: "value", value: "OBSTACLE" } },
				},
			],
		});
		expect(blockTx.ok).toBe(true);
		if (!blockTx.ok) throw new Error(blockTx.error.message);
		const blockedWorkbook = blockTx.value.workbook;
		const blockedEngine = createEngine(blockedWorkbook);

		// Anchor should now report #SPILL!
		const blockedResult = blockedEngine.value({
			sheetId: summarySheetId,
			row: 0,
			col: 4,
		});
		expect(blockedResult).toEqual({ kind: "error", code: "#SPILL!" });

		// Clearing the obstructing cell restores normal spill
		const unblockTx = applyTransaction(blockedWorkbook, {
			id: createId("transaction"),
			baseRevision: blockedWorkbook.revision,
			label: "Unblock spill",
			timestamp: initialTimestamp,
			patches: [
				{
					kind: "cell",
					at: { sheetId: summarySheetId, row: 1, col: 5 },
					cell: null,
				},
			],
		});
		expect(unblockTx.ok).toBe(true);
		if (!unblockTx.ok) throw new Error(unblockTx.error.message);
		workbook = unblockTx.value.workbook;
		engine.updateWorkbook(workbook);
		const restoredResult = engine.value({
			sheetId: summarySheetId,
			row: 0,
			col: 4,
		});
		expect(typeof restoredResult).toBe("object");
		if (
			typeof restoredResult === "object" &&
			restoredResult &&
			"kind" in restoredResult
		) {
			expect(restoredResult.kind).toBe("array");
		}

		// -------------------------------------------------------------------------
		// 4. FORMATTING & CONDITIONAL FORMATTING
		// -------------------------------------------------------------------------
		const currencyStyleId = createId("style");
		const headerStyleId = createId("style");

		const formatPatches: Patch[] = [
			{
				kind: "style",
				styleId: currencyStyleId,
				style: {
					numberFormat: "$#,##0.00",
					font: { bold: true, color: "#005500" },
					fill: "#F0FFF0",
					borders: {
						bottom: { style: "double", color: "#003300" },
						top: { style: "thin", color: "#003300" },
					},
				},
			},
			{
				kind: "style",
				styleId: headerStyleId,
				style: {
					font: { bold: true, family: "Arial", size: 12, color: "#FFFFFF" },
					fill: "#107C41",
					horizontal: "center",
				},
			},
			// Apply currency style to Sheet1 D6 (the total sum)
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 5, col: 3 },
				cell: {
					input: { kind: "formula", source: "=SUM(D2:D5)" },
					styleId: currencyStyleId,
				},
			},
			// Apply header style to Sheet1 row 0
			{
				kind: "cell",
				at: { sheetId: sheet1Id, row: 0, col: 0 },
				cell: {
					input: { kind: "value", value: "Department" },
					styleId: headerStyleId,
				},
			},
		];

		const formatTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Apply formatting",
			timestamp: initialTimestamp,
			patches: formatPatches,
		});
		expect(formatTx.ok).toBe(true);
		if (!formatTx.ok) throw new Error(formatTx.error.message);
		workbook = formatTx.value.workbook;

		// Verify formatValue grammar
		const formattedSum = formatValue(58000, "$#,##0.00");
		expect(formattedSum).toBe("$58,000.00");
		expect(formatValue(0.125, "0.00%")).toBe("12.50%");
		expect(formatValue(45678, "yyyy-mm-dd")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		// Verify styleToCSS mapping
		const css = styleToCSS(workbook.styles[currencyStyleId]!);
		expect(css["fontWeight"]).toBe("bold");
		expect(css["color"]).toBe("#005500");
		expect(css["backgroundColor"]).toBe("#F0FFF0");
		expect(css["borderBottom"]).toBe("1px double #003300"); // 'double' style with 1px base in styleToCSS

		// Verify colorScale interpolation
		const midColor = colorScale(50, 0, 100);
		expect(midColor).toBeTruthy();
		expect(midColor.startsWith("#")).toBe(true);

		// -------------------------------------------------------------------------
		// 5. AUTOFILTER HIDDEN ROWS & DATA SORTING
		// -------------------------------------------------------------------------
		// AutoFilter: filter Sheet1 sales where Department == 'Software'
		const filterSpec = {
			range: { top: 0, left: 0, bottom: 4, right: 3 },
			header: true,
			columns: [
				{
					offset: 0,
					combine: "and" as const,
					predicates: [
						{
							kind: "text" as const,
							op: "contains" as const,
							value: "Software",
						},
					],
				},
			],
		};

		const filterTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Add AutoFilter",
			timestamp: initialTimestamp,
			patches: [
				{
					kind: "sheetProperties",
					sheetId: sheet1Id,
					properties: {
						...workbook.sheets[sheet1Id]!.properties,
						filter: filterSpec,
					},
				},
			],
		});
		expect(filterTx.ok).toBe(true);
		if (!filterTx.ok) throw new Error(filterTx.error.message);
		workbook = filterTx.value.workbook;

		const valueReader = {
			value: (at: CellAddress): Scalar => {
				const c = getCell(workbook, at);
				return c?.input.kind === "value" ? c.input.value : null;
			},
		};

		// Row 1 is Software (keep), Row 2 is Hardware (hide), Row 3 is Software (keep), Row 4 is Cloud (hide)
		const hiddenIntervals = hiddenRows(workbook.sheets[sheet1Id]!, valueReader);
		const hiddenSet = new Set<number>();
		for (const interval of hiddenIntervals) {
			for (let r = interval.start; r <= interval.end; r++) hiddenSet.add(r);
		}
		expect(hiddenSet.has(1)).toBe(false); // Alice Software visible
		expect(hiddenSet.has(2)).toBe(true); // Bob Hardware hidden
		expect(hiddenSet.has(3)).toBe(false); // Carol Software visible
		expect(hiddenSet.has(4)).toBe(true); // Dave Cloud hidden

		// Sorting: Sort Sheet1 data range A2:D5 by QuarterlySales (offset 3) DESCENDING
		const dataRange: RangeRef = {
			sheetId: sheet1Id,
			top: 1,
			left: 0,
			bottom: 4,
			right: 3,
		};
		const sortPatches = sortRange(
			workbook,
			dataRange,
			[{ offset: 3, direction: "desc" }],
			valueReader,
		);
		const sortTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Sort Sales Descending",
			timestamp: initialTimestamp,
			patches: sortPatches,
		});
		expect(sortTx.ok).toBe(true);
		if (!sortTx.ok) throw new Error(sortTx.error.message);
		workbook = sortTx.value.workbook;

		// After sort:
		// Row 1 should be Dave (22100)
		// Row 2 should be Carol (15400)
		// Row 3 should be Alice (12000)
		// Row 4 should be Bob (8500)
		expect(
			getCell(workbook, { sheetId: sheet1Id, row: 1, col: 1 })?.input,
		).toEqual({ kind: "value", value: "Dave" });
		expect(
			getCell(workbook, { sheetId: sheet1Id, row: 1, col: 3 })?.input,
		).toEqual({ kind: "value", value: 22100 });
		expect(
			getCell(workbook, { sheetId: sheet1Id, row: 2, col: 1 })?.input,
		).toEqual({ kind: "value", value: "Carol" });
		expect(
			getCell(workbook, { sheetId: sheet1Id, row: 3, col: 1 })?.input,
		).toEqual({ kind: "value", value: "Alice" });
		expect(
			getCell(workbook, { sheetId: sheet1Id, row: 4, col: 1 })?.input,
		).toEqual({ kind: "value", value: "Bob" });
		expect(
			getCell(workbook, { sheetId: sheet1Id, row: 4, col: 3 })?.input,
		).toEqual({ kind: "value", value: 8500 });

		// -------------------------------------------------------------------------
		// 6. PIVOT TABLE AGGREGATION
		// -------------------------------------------------------------------------
		// Create dedicated Pivot worksheet
		const pivotSheetId = createId("sheet") as SheetId;
		const pivotBase = createWorkbook({
			id: workbook.id,
			sheetId: pivotSheetId,
			name: "Pivot",
			timestamp: initialTimestamp,
		}).sheets[pivotSheetId]!;
		const addPivotSheetTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Add Pivot Sheet",
			timestamp: initialTimestamp,
			patches: [
				{
					kind: "sheet",
					sheetId: pivotSheetId,
					sheet: {
						...pivotBase,
						properties: {
							...pivotBase.properties,
							name: "PivotSales",
						},
					},
				},
				{
					kind: "sheetOrder",
					order: [...workbook.sheetOrder, pivotSheetId],
				},
			],
		});
		expect(addPivotSheetTx.ok).toBe(true);
		if (!addPivotSheetTx.ok) throw new Error(addPivotSheetTx.error.message);
		workbook = addPivotSheetTx.value.workbook;

		// Pivot definition: Source Sheet1 A1:D5, row group: Department (offset 0), value: QuarterlySales (offset 3) SUM
		const pivotDef: PivotDefinition = {
			id: createId("object"),
			name: "DepartmentalSalesPivot",
			source: { sheetId: sheet1Id, top: 0, left: 0, bottom: 4, right: 3 },
			destination: { sheetId: pivotSheetId, row: 0, col: 0 },
			rows: [0], // Department
			columns: [],
			values: [{ offset: 3, aggregate: "sum", label: "TotalSales" }],
			filters: [],
			rowTotals: true,
			columnTotals: false,
		};

		const pivotReader = {
			value: (at: CellAddress): Scalar => {
				const c = getCell(workbook, at);
				return c?.input.kind === "value" ? c.input.value : null;
			},
		};

		const pivotPatches = refreshPivot(workbook, pivotDef, pivotReader);
		const pivotTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Materialize Pivot Table",
			timestamp: initialTimestamp,
			patches: pivotPatches,
		});
		expect(pivotTx.ok).toBe(true);
		if (!pivotTx.ok) throw new Error(pivotTx.error.message);
		workbook = pivotTx.value.workbook;

		// Check pivot table outputs in PivotSales sheet:
		// Header row: Department | sum | Grand Total
		expect(
			getCell(workbook, { sheetId: pivotSheetId, row: 0, col: 0 })?.input,
		).toEqual({ kind: "value", value: "Department" });
		expect(
			getCell(workbook, { sheetId: pivotSheetId, row: 0, col: 1 })?.input,
		).toEqual({ kind: "value", value: "sum" });
		expect(
			getCell(workbook, { sheetId: pivotSheetId, row: 0, col: 2 })?.input,
		).toEqual({ kind: "value", value: "Grand Total" });

		// Pivot rows contain aggregated sums:
		// Cloud: 22100
		// Software: Alice (12000) + Carol (15400) = 27400
		// Hardware: Bob (8500)
		// Find Software row and verify sum 27400
		let softwareFound = false;
		for (let r = 1; r <= 3; r++) {
			const dept = getCell(workbook, {
				sheetId: pivotSheetId,
				row: r,
				col: 0,
			})?.input;
			if (dept && "value" in dept && dept.value === "Software") {
				softwareFound = true;
				const val = getCell(workbook, {
					sheetId: pivotSheetId,
					row: r,
					col: 1,
				})?.input;
				expect(val).toEqual({ kind: "value", value: 27400 });
			}
		}
		expect(softwareFound).toBe(true);

		// -------------------------------------------------------------------------
		// 7. LOSSLESS XLSX EXPORT WITH EMBEDDED SHA-256 MANIFEST & RE-IMPORT
		// -------------------------------------------------------------------------
		// Build calculation cache for all formula cells in workbook
		const pipelineEngine = createEngine(workbook);
		const exportCacheValues: Record<string, Record<CellKey, Scalar>> = {};

		for (const sId of workbook.sheetOrder) {
			exportCacheValues[sId] = {};
			for (const { at, cell } of entries(workbook, {
				sheetId: sId,
				top: 0,
				left: 0,
				bottom: 200,
				right: 100,
			})) {
				if (cell.input.kind === "formula") {
					const v = pipelineEngine.value(at);
					exportCacheValues[sId]![`${at.row}:${at.col}`] =
						typeof v === "object" && v && "kind" in v && v.kind === "array"
							? (v.values[0] ?? null)
							: (v as Scalar);
				}
			}
		}

		const exportResult = await exportWorkbook(workbook, {
			file: { format: "xlsx", csvEscapeFormulas: true },
			cache: { revision: workbook.revision, values: exportCacheValues },
			limits: DEFAULT_INTEROP_LIMITS,
		});
		expect(exportResult.ok).toBe(true);
		if (!exportResult.ok) throw new Error(exportResult.error.message);

		const xlsxBytes = exportResult.value.bytes;
		expect(xlsxBytes.length).toBeGreaterThan(1000);
		// Standard ZIP signature: 0x50 0x4B 0x03 0x04 ("PK\x03\x04")
		expect(xlsxBytes[0]).toBe(0x50);
		expect(xlsxBytes[1]).toBe(0x4b);

		// Inspect archive contents with fflate
		const archiveFiles = unzipSync(xlsxBytes);
		expect(archiveFiles["openexcel/workbook.json"]).toBeDefined();
		expect(archiveFiles["openexcel/manifest.json"]).toBeDefined();

		// Verify SHA-256 manifest
		const manifestJson = JSON.parse(
			strFromU8(archiveFiles["openexcel/manifest.json"]!),
		);
		expect(manifestJson.version).toBe(1);
		expect(manifestJson.parts).toBeDefined();
		expect(typeof manifestJson.parts).toBe("object");

		// Verify cryptographic SHA-256 integrity: hash of 'xl/workbook.xml' must match manifest
		if (archiveFiles["xl/workbook.xml"]) {
			const calculatedDigest = createHash("sha256")
				.update(archiveFiles["xl/workbook.xml"])
				.digest("hex");
			expect(manifestJson.parts["xl/workbook.xml"]).toBe(calculatedDigest);
		}

		// Re-import the exported XLSX archive
		const importResult = await importWorkbook(xlsxBytes, {
			format: "xlsx",
			workbookId: createId("workbook") as WorkbookId,
			firstSheetId: createId("sheet") as SheetId,
			name: "Imported_Financial_Model",
			timestamp: initialTimestamp,
			parseCsvFormulas: false,
			limits: DEFAULT_INTEROP_LIMITS,
		});
		expect(importResult.ok).toBe(true);
		if (!importResult.ok) throw new Error(importResult.error.message);

		const importedWorkbook = importResult.value.workbook;
		// Manifest matched -> zero lossy conversion warnings on standard round-trip
		expect(importResult.value.issues).toEqual([]);

		// Check sheets restored
		expect(importedWorkbook.sheetOrder.length).toBe(3);
		const restoredSheet1 = Object.values(importedWorkbook.sheets).find(
			(s) => s.properties.name === "Sheet1",
		)!;
		const restoredSummary = Object.values(importedWorkbook.sheets).find(
			(s) => s.properties.name === "Summary",
		)!;
		const restoredPivot = Object.values(importedWorkbook.sheets).find(
			(s) => s.properties.name === "PivotSales",
		)!;
		expect(restoredSheet1).toBeDefined();
		expect(restoredSummary).toBeDefined();
		expect(restoredPivot).toBeDefined();

		// Check cell values and formulas preserved
		const restoredD6 = getCell(importedWorkbook, {
			sheetId: restoredSheet1.id,
			row: 5,
			col: 3,
		});
		expect(restoredD6?.input).toEqual({
			kind: "formula",
			source: "=SUM(D2:D5)",
		});
		expect(restoredD6?.styleId).toBeDefined();

		const restoredCross = getCell(importedWorkbook, {
			sheetId: restoredSummary.id,
			row: 1,
			col: 1,
		});
		expect(restoredCross?.input).toEqual({
			kind: "formula",
			source: "=Sheet1!D6*1.1",
		});

		// -------------------------------------------------------------------------
		// 8. SQLITE WAL PERSISTENCE & CRASH RECOVERY
		// -------------------------------------------------------------------------
		const store = new WorkbookStore(dbPath);

		// Verify WAL mode is configured
		const journalMode = (
			store.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
		).journal_mode;
		expect(journalMode.toLowerCase()).toBe("wal");

		// Create workbook record in SQLite
		const createRecord = store.create(workbook);
		expect(createRecord.storageVersion).toBe(1);
		expect(createRecord.workbook.id).toBe(workbook.id);

		// Save updated revision with saveId
		const saveId1 = randomUUID();
		const updatedWorkbook: Workbook = {
			...workbook,
			revision: workbook.revision + 1,
			properties: { ...workbook.properties, name: "Executive_Model_V2" },
		};

		const saveResponse = store.save(updatedWorkbook, 1, saveId1);
		expect(saveResponse.storageVersion).toBe(2);
		expect(saveResponse.id).toBe(workbook.id);

		// Idempotent retry with identical saveId and snapshot returns existing response
		const retryResponse = store.save(updatedWorkbook, 1, saveId1);
		expect(retryResponse.storageVersion).toBe(2);

		// Optimistic concurrency conflict: attempting to save with stale version (1 instead of 2) throws 409
		expect(() => {
			store.save(updatedWorkbook, 1, randomUUID());
		}).toThrow(HttpError);

		// Simulate crash / restart: close connection and instantiate new store from disk
		store.close();
		const restartedStore = new WorkbookStore(dbPath);

		const reloaded = restartedStore.get(workbook.id);
		expect(reloaded.storageVersion).toBe(2);
		expect(reloaded.workbook.properties.name).toBe("Executive_Model_V2");
		expect(reloaded.workbook.sheetOrder.length).toBe(3);

		// Verify cell contents survived SQLite WAL commit
		const reloadedCell = getCell(reloaded.workbook, {
			sheetId: sheet1Id,
			row: 5,
			col: 3,
		});
		expect(reloadedCell?.input).toEqual({
			kind: "formula",
			source: "=SUM(D2:D5)",
		});
		restartedStore.close();
	});
});

describe("Dynamic spill lifecycle and cross-sheet topological recomputation", () => {
	it("handles transitive invalidation across 3 sheets and downstream spill consumers", () => {
		const sheetA = createId("sheet") as SheetId;
		const sheetB = createId("sheet") as SheetId;
		const sheetC = createId("sheet") as SheetId;

		let workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId: sheetA,
			name: "Transitive_Model",
			timestamp: "2026-10-23T06:00:00Z",
		});

		const setupTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Setup 3 sheets",
			timestamp: "2026-10-23T06:00:00Z",
			patches: [
				{
					kind: "sheet",
					sheetId: sheetB,
					sheet: {
						...workbook.sheets[sheetA]!,
						id: sheetB,
						properties: {
							...workbook.sheets[sheetA]!.properties,
							name: "SheetB",
						},
					},
				},
				{
					kind: "sheet",
					sheetId: sheetC,
					sheet: {
						...workbook.sheets[sheetA]!,
						id: sheetC,
						properties: {
							...workbook.sheets[sheetA]!.properties,
							name: "SheetC",
						},
					},
				},
				{ kind: "sheetOrder", order: [sheetA, sheetB, sheetC] },
				// SheetA!A1 = 50
				{
					kind: "cell",
					at: { sheetId: sheetA, row: 0, col: 0 },
					cell: { input: { kind: "value", value: 50 } },
				},
				// SheetB!A1 = =Sheet1!A1 * 2 (= 100)
				{
					kind: "cell",
					at: { sheetId: sheetB, row: 0, col: 0 },
					cell: { input: { kind: "formula", source: "=Sheet1!A1*2" } },
				},
				// SheetB!B1:B3 = =SEQUENCE(3, 1, SheetB!A1, 10)
				{
					kind: "cell",
					at: { sheetId: sheetB, row: 0, col: 1 },
					cell: {
						input: { kind: "formula", source: "=SEQUENCE(3, 1, A1, 10)" },
					},
				},
				// SheetC!A1 = =SUM(SheetB!B1:B3)
				{
					kind: "cell",
					at: { sheetId: sheetC, row: 0, col: 0 },
					cell: { input: { kind: "formula", source: "=SUM(SheetB!B1:B3)" } },
				},
			],
		});
		expect(setupTx.ok).toBe(true);
		if (!setupTx.ok) throw new Error(setupTx.error.message);
		workbook = setupTx.value.workbook;

		const engine = createEngine(workbook);

		// SheetA!A1 = 50
		// SheetB!A1 = 100
		// SheetB!B1:B3 = [100, 110, 120]
		// SheetC!A1 = SUM([100, 110, 120]) = 330
		expect(engine.value({ sheetId: sheetC, row: 0, col: 0 })).toBe(330);

		// Mutate SheetA!A1 from 50 to 100
		const editTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Update root dependency",
			timestamp: "2026-10-23T06:01:00Z",
			patches: [
				{
					kind: "cell",
					at: { sheetId: sheetA, row: 0, col: 0 },
					cell: { input: { kind: "value", value: 100 } },
				},
			],
		});
		expect(editTx.ok).toBe(true);
		if (!editTx.ok) throw new Error(editTx.error.message);
		workbook = editTx.value.workbook;

		engine.updateWorkbook(workbook);

		// SheetB!A1 becomes 200
		// SheetB!B1:B3 becomes [200, 210, 220]
		// SheetC!A1 should recalculate to 630
		expect(engine.value({ sheetId: sheetC, row: 0, col: 0 })).toBe(630);
	});

	it("detects complex multi-cell self-reference cycle without crashing", () => {
		const sheetId = createId("sheet") as SheetId;
		let workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId,
			name: "Cycle_Detection",
			timestamp: "2026-10-23T06:00:00Z",
		});

		// 4-cell cyclic ring: A1 -> B1 -> C1 -> D1 -> A1
		const cycleTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Ring cycle",
			timestamp: "2026-10-23T06:00:00Z",
			patches: [
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 0 },
					cell: { input: { kind: "formula", source: "=B1+1" } },
				},
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 1 },
					cell: { input: { kind: "formula", source: "=C1+1" } },
				},
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 2 },
					cell: { input: { kind: "formula", source: "=D1+1" } },
				},
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 3 },
					cell: { input: { kind: "formula", source: "=A1+1" } },
				},
			],
		});
		expect(cycleTx.ok).toBe(true);
		if (!cycleTx.ok) throw new Error(cycleTx.error.message);
		workbook = cycleTx.value.workbook;

		const engine = createEngine(workbook);
		expect(engine.value({ sheetId, row: 0, col: 0 })).toEqual({
			kind: "error",
			code: "#CIRC!",
		});
		expect(engine.value({ sheetId, row: 0, col: 1 })).toEqual({
			kind: "error",
			code: "#CIRC!",
		});
		expect(engine.value({ sheetId, row: 0, col: 2 })).toEqual({
			kind: "error",
			code: "#CIRC!",
		});
		expect(engine.value({ sheetId, row: 0, col: 3 })).toEqual({
			kind: "error",
			code: "#CIRC!",
		});
	});
});

describe("Data tools and CSV formula injection resistance", () => {
	it("escapes leading formula characters on CSV export and handles deduplication & text splitting", async () => {
		const sheetId = createId("sheet") as SheetId;
		let workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId,
			name: "Data_Tools_Test",
			timestamp: "2026-10-23T06:00:00Z",
		});

		const setupTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "CSV and Data tools setup",
			timestamp: "2026-10-23T06:00:00Z",
			patches: [
				// Formula-like literal text vulnerable to CSV injection: =SUM(1,2), @EXEC, -cmd, +test
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 0 },
					cell: { input: { kind: "value", value: "=SUM(1,2)" } },
				},
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 1 },
					cell: { input: { kind: "value", value: "@EXEC_CMD" } },
				},
				{
					kind: "cell",
					at: { sheetId, row: 1, col: 0 },
					cell: { input: { kind: "value", value: "-DANGEROUS" } },
				},
				{
					kind: "cell",
					at: { sheetId, row: 1, col: 1 },
					cell: { input: { kind: "value", value: "+SAFE_LITERAL" } },
				},

				// Delimited string for textToColumns: row 5, col 0
				{
					kind: "cell",
					at: { sheetId, row: 5, col: 0 },
					cell: { input: { kind: "value", value: "Alpha;Beta;Gamma;Delta" } },
				},

				// Duplicate rows for removeDuplicates: row 10..13
				{
					kind: "cell",
					at: { sheetId, row: 10, col: 0 },
					cell: { input: { kind: "value", value: "UniqueKeyA" } },
				},
				{
					kind: "cell",
					at: { sheetId, row: 11, col: 0 },
					cell: { input: { kind: "value", value: "UniqueKeyB" } },
				},
				{
					kind: "cell",
					at: { sheetId, row: 12, col: 0 },
					cell: { input: { kind: "value", value: "UniqueKeyA" } },
				}, // duplicate
				{
					kind: "cell",
					at: { sheetId, row: 13, col: 0 },
					cell: { input: { kind: "value", value: "UniqueKeyC" } },
				},
			],
		});
		expect(setupTx.ok).toBe(true);
		if (!setupTx.ok) throw new Error(setupTx.error.message);
		workbook = setupTx.value.workbook;

		// 1. CSV Export escaping
		const csvExport = await exportWorkbook(workbook, {
			file: {
				format: "csv",
				sheetId,
				range: { top: 0, left: 0, bottom: 1, right: 1 },
				csvEscapeFormulas: true,
			},
			cache: { revision: workbook.revision, values: {} },
			limits: DEFAULT_INTEROP_LIMITS,
		});
		expect(csvExport.ok).toBe(true);
		if (!csvExport.ok) throw new Error(csvExport.error.message);

		const csvText = new TextDecoder().decode(csvExport.value.bytes);
		// Formula characters (=, @, -, +) must be prepended with single quote (')
		expect(csvText).toContain('"\'=SUM(1,2)"');
		expect(csvText).toContain('"\'@EXEC_CMD"');
		expect(csvText).toContain('"\'-DANGEROUS"');
		expect(csvText).toContain('"\'+SAFE_LITERAL"');

		const reader = {
			value: (at: CellAddress): Scalar => {
				const c = getCell(workbook, at);
				return c?.input.kind === "value" ? c.input.value : null;
			},
		};

		// 2. Text to columns splitting on semicolon
		const splitPatches = textToColumns(
			workbook,
			{ sheetId, top: 5, left: 0, bottom: 5, right: 0 },
			";",
			reader,
		);
		const splitTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Text to columns",
			timestamp: "2026-10-23T06:00:00Z",
			patches: splitPatches,
		});
		expect(splitTx.ok).toBe(true);
		if (!splitTx.ok) throw new Error(splitTx.error.message);
		workbook = splitTx.value.workbook;

		expect(getCell(workbook, { sheetId, row: 5, col: 0 })?.input).toEqual({
			kind: "value",
			value: "Alpha",
		});
		expect(getCell(workbook, { sheetId, row: 5, col: 1 })?.input).toEqual({
			kind: "value",
			value: "Beta",
		});
		expect(getCell(workbook, { sheetId, row: 5, col: 2 })?.input).toEqual({
			kind: "value",
			value: "Gamma",
		});
		expect(getCell(workbook, { sheetId, row: 5, col: 3 })?.input).toEqual({
			kind: "value",
			value: "Delta",
		});

		// 3. Remove duplicates
		const dedupPatches = removeDuplicates(
			workbook,
			{ sheetId, top: 10, left: 0, bottom: 13, right: 0 },
			[0],
			reader,
		);
		const dedupTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Remove duplicates",
			timestamp: "2026-10-23T06:00:00Z",
			patches: dedupPatches,
		});
		expect(dedupTx.ok).toBe(true);
		if (!dedupTx.ok) throw new Error(dedupTx.error.message);
		workbook = dedupTx.value.workbook;

		// UniqueKeyA, UniqueKeyB, UniqueKeyC, and 4th row should now be empty/null
		expect(getCell(workbook, { sheetId, row: 10, col: 0 })?.input).toEqual({
			kind: "value",
			value: "UniqueKeyA",
		});
		expect(getCell(workbook, { sheetId, row: 11, col: 0 })?.input).toEqual({
			kind: "value",
			value: "UniqueKeyB",
		});
		expect(getCell(workbook, { sheetId, row: 12, col: 0 })?.input).toEqual({
			kind: "value",
			value: "UniqueKeyC",
		});
		expect(getCell(workbook, { sheetId, row: 13, col: 0 })).toBeUndefined();
	});

	it("validates pivot table error handling on overlapping destination and source", () => {
		const sheetId = createId("sheet") as SheetId;
		const workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId,
			name: "Pivot_Overlap_Test",
			timestamp: "2026-10-23T06:00:00Z",
		});

		const reader = { value: () => 10 };
		const invalidOverlapPivot: PivotDefinition = {
			id: createId("object"),
			name: "OverlappingPivot",
			source: { sheetId, top: 0, left: 0, bottom: 5, right: 5 },
			destination: { sheetId, row: 2, col: 2 }, // overlaps source!
			rows: [0],
			columns: [],
			values: [{ offset: 1, aggregate: "sum", label: "Sum" }],
			filters: [],
			rowTotals: false,
			columnTotals: false,
		};

		expect(() => {
			refreshPivot(workbook, invalidOverlapPivot, reader);
		}).toThrow(/Pivot output overlaps its source/i);
	});

	it("converges Goal Seek on non-linear equations within strict tolerance", () => {
		// Solve x^2 - 49 = 0 -> target 49 for f(x) = x^2, starting from x=1
		const target = 49;
		const result = goalSeek((x) => x * x, target, 1, 1e-6, 100);
		expect(result.converged).toBe(true);
		expect(result.value).toBeCloseTo(7, 3);
		expect(result.result).toBeCloseTo(49, 3);

		// Non-convergent horizontal constant function f(x) = 10, target = 100
		const nonConvergent = goalSeek(() => 10, 100, 0, 1e-6, 50);
		expect(nonConvergent.converged).toBe(false);
	});
});

describe("Cryptographic manifest verification and transaction history undo/redo", () => {
	it("detects XLSX manifest tampering when native parts are altered without updating OpenExcel manifest", async () => {
		const sheetId = createId("sheet") as SheetId;
		let workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId,
			name: "Manifest_Tamper_Test",
			timestamp: "2026-10-23T06:00:00Z",
		});

		const initTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Initial value",
			timestamp: "2026-10-23T06:00:00Z",
			patches: [
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 0 },
					cell: { input: { kind: "value", value: 42 } },
				},
			],
		});
		expect(initTx.ok).toBe(true);
		if (!initTx.ok) throw new Error(initTx.error.message);
		workbook = initTx.value.workbook;

		const exported = await exportWorkbook(workbook, {
			file: { format: "xlsx", csvEscapeFormulas: true },
			cache: { revision: workbook.revision, values: {} },
			limits: DEFAULT_INTEROP_LIMITS,
		});
		expect(exported.ok).toBe(true);
		if (!exported.ok) throw new Error(exported.error.message);

		// Tamper with xl/worksheets/sheet1.xml
		const files = unzipSync(exported.value.bytes);
		expect(files["xl/worksheets/sheet1.xml"]).toBeDefined();
		const originalXml = strFromU8(files["xl/worksheets/sheet1.xml"]!);
		files["xl/worksheets/sheet1.xml"] = strToU8(
			originalXml.replace("<v>42</v>", "<v>99</v>"),
		);

		// Re-pack and import
		const tamperedZip = zipSync(files);
		const imported = await importWorkbook(tamperedZip, {
			format: "xlsx",
			workbookId: createId("workbook") as WorkbookId,
			firstSheetId: createId("sheet") as SheetId,
			name: "Tampered_Import",
			timestamp: "2026-10-23T06:00:00Z",
			parseCsvFormulas: false,
			limits: DEFAULT_INTEROP_LIMITS,
		});
		expect(imported.ok).toBe(true);
		if (!imported.ok) throw new Error(imported.error.message);

		// Should generate warning that manifest was invalid or native parts changed
		expect(
			imported.value.issues.some((issue) =>
				issue.message.includes("Stale or unverifiable"),
			),
		).toBe(true);
	});

	it("records transaction history and accurately performs undo and redo", () => {
		const sheetId = createId("sheet") as SheetId;
		let workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId,
			name: "History_Test",
			timestamp: "2026-10-23T06:00:00Z",
		});

		const history = createHistory({ maxEntries: 10, maxBytes: 100_000 });

		// Step 1: Write "Hello" to A1
		const tx1 = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Write Hello",
			timestamp: "2026-10-23T06:00:00Z",
			patches: [
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 0 },
					cell: { input: { kind: "value", value: "Hello" } },
				},
			],
		});
		expect(tx1.ok).toBe(true);
		if (!tx1.ok) throw new Error(tx1.error.message);
		history.record(tx1.value.commit);
		workbook = tx1.value.workbook;
		expect(getCell(workbook, { sheetId, row: 0, col: 0 })?.input).toEqual({
			kind: "value",
			value: "Hello",
		});

		// Step 2: Write "World" to A1
		const tx2 = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Write World",
			timestamp: "2026-10-23T06:01:00Z",
			patches: [
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 0 },
					cell: { input: { kind: "value", value: "World" } },
				},
			],
		});
		expect(tx2.ok).toBe(true);
		if (!tx2.ok) throw new Error(tx2.error.message);
		history.record(tx2.value.commit);
		workbook = tx2.value.workbook;
		expect(getCell(workbook, { sheetId, row: 0, col: 0 })?.input).toEqual({
			kind: "value",
			value: "World",
		});

		// Undo step 2 -> should restore "Hello"
		const undoHeader = {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Undo",
			timestamp: "2026-10-23T06:02:00Z",
			history: "record" as const,
			validation: "enforce" as const,
		};
		const undo1 = history.undo(workbook, undoHeader);
		expect(undo1.ok).toBe(true);
		if (!undo1.ok) throw new Error(undo1.error.message);
		workbook = undo1.value.workbook;
		expect(getCell(workbook, { sheetId, row: 0, col: 0 })?.input).toEqual({
			kind: "value",
			value: "Hello",
		});

		// Redo step 2 -> should re-apply "World"
		const redoHeader = {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Redo",
			timestamp: "2026-10-23T06:03:00Z",
			history: "record" as const,
			validation: "enforce" as const,
		};
		const redo1 = history.redo(workbook, redoHeader);
		expect(redo1.ok).toBe(true);
		if (!redo1.ok) throw new Error(redo1.error.message);
		workbook = redo1.value.workbook;
		expect(getCell(workbook, { sheetId, row: 0, col: 0 })?.input).toEqual({
			kind: "value",
			value: "World",
		});
	});

	it("resolves structured table references (=SUM(Table1[Column1]), [@Column1]) in calculation engine", () => {
		const sheetId = createId("sheet") as SheetId;
		const tableId = createId("object") as ObjectId;
		const col1Id = createId("object") as ObjectId;
		const col2Id = createId("object") as ObjectId;
		const col3Id = createId("object") as ObjectId;

		const tableDef: TableDefinition = {
			id: tableId,
			name: "SalesTable",
			range: { top: 0, left: 0, bottom: 3, right: 2 },
			columns: [
				{ id: col1Id, name: "Quarter" },
				{ id: col2Id, name: "Units" },
				{ id: col3Id, name: "Total" },
			],
			totalsRow: false,
		};

		let workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId,
			name: "Structured_Refs_Test",
			timestamp: "2026-10-23T06:00:00Z",
		});

		workbook = {
			...workbook,
			sheets: {
				...workbook.sheets,
				[sheetId]: {
					...workbook.sheets[sheetId]!,
					properties: {
						...workbook.sheets[sheetId]!.properties,
						tables: [tableDef],
					},
				},
			},
		};

		const patches: Patch[] = [
			{ kind: "cell", at: { sheetId, row: 0, col: 0 }, cell: { input: { kind: "value", value: "Quarter" } } },
			{ kind: "cell", at: { sheetId, row: 0, col: 1 }, cell: { input: { kind: "value", value: "Units" } } },
			{ kind: "cell", at: { sheetId, row: 0, col: 2 }, cell: { input: { kind: "value", value: "Total" } } },
			{ kind: "cell", at: { sheetId, row: 1, col: 0 }, cell: { input: { kind: "value", value: "Q1" } } },
			{ kind: "cell", at: { sheetId, row: 1, col: 1 }, cell: { input: { kind: "value", value: 100 } } },
			{ kind: "cell", at: { sheetId, row: 1, col: 2 }, cell: { input: { kind: "formula", source: "=[@Units]*2" } } },
			{ kind: "cell", at: { sheetId, row: 2, col: 0 }, cell: { input: { kind: "value", value: "Q2" } } },
			{ kind: "cell", at: { sheetId, row: 2, col: 1 }, cell: { input: { kind: "value", value: 200 } } },
			{ kind: "cell", at: { sheetId, row: 2, col: 2 }, cell: { input: { kind: "formula", source: "=[@Units]*2" } } },
			{ kind: "cell", at: { sheetId, row: 3, col: 0 }, cell: { input: { kind: "value", value: "Q3" } } },
			{ kind: "cell", at: { sheetId, row: 3, col: 1 }, cell: { input: { kind: "value", value: 300 } } },
			{ kind: "cell", at: { sheetId, row: 3, col: 2 }, cell: { input: { kind: "formula", source: "=[@Units]*2" } } },
			{ kind: "cell", at: { sheetId, row: 0, col: 4 }, cell: { input: { kind: "formula", source: "=SUM(SalesTable[Units])" } } },
			{ kind: "cell", at: { sheetId, row: 1, col: 4 }, cell: { input: { kind: "formula", source: "=SUM(SalesTable[Total])" } } },
		];

		const tx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Seed structured refs",
			timestamp: "2026-10-23T06:01:00Z",
			patches,
		});
		expect(tx.ok).toBe(true);
		if (!tx.ok) throw new Error(tx.error.message);
		workbook = tx.value.workbook;

		const engine = createEngine(workbook);
		expect(engine.value({ sheetId, row: 1, col: 2 })).toEqual({ kind: "array", rows: 1, cols: 1, values: [200] });
		expect(engine.value({ sheetId, row: 2, col: 2 })).toEqual({ kind: "array", rows: 1, cols: 1, values: [400] });
		expect(engine.value({ sheetId, row: 3, col: 2 })).toEqual({ kind: "array", rows: 1, cols: 1, values: [600] });

		expect(engine.value({ sheetId, row: 0, col: 4 })).toBe(600);
		expect(engine.value({ sheetId, row: 1, col: 4 })).toBe(1200);
	});

	it("executes Goal Seek driving dynamic formula recalculation with createEngine", () => {
		const sheetId = createId("sheet") as SheetId;
		let workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId,
			name: "GoalSeek_Engine_Test",
			timestamp: "2026-10-23T06:00:00Z",
		});

		const patches: Patch[] = [
			{ kind: "cell", at: { sheetId, row: 0, col: 0 }, cell: { input: { kind: "value", value: 50 } } },
			{ kind: "cell", at: { sheetId, row: 1, col: 0 }, cell: { input: { kind: "value", value: 200 } } },
			{ kind: "cell", at: { sheetId, row: 2, col: 0 }, cell: { input: { kind: "value", value: 0.1 } } },
			{ kind: "cell", at: { sheetId, row: 3, col: 0 }, cell: { input: { kind: "formula", source: "=A1*A2*(1-A3)" } } },
		];

		const tx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Seed scenario",
			timestamp: "2026-10-23T06:01:00Z",
			patches,
		});
		expect(tx.ok).toBe(true);
		if (!tx.ok) throw new Error(tx.error.message);
		workbook = tx.value.workbook;

		const engine0 = createEngine(workbook);
		expect(engine0.value({ sheetId, row: 3, col: 0 })).toBeCloseTo(9000);

		const targetRevenue = 18000;
		const seekResult = goalSeek(
			(testPrice: number) => {
				const candidateTx = applyTransaction(workbook, {
					id: createId("transaction"),
					baseRevision: workbook.revision,
					label: "GoalSeek Step",
					timestamp: "2026-10-23T06:02:00Z",
					patches: [
						{
							kind: "cell",
							at: { sheetId, row: 0, col: 0 },
							cell: { input: { kind: "value", value: testPrice } },
						},
					],
				});
				if (!candidateTx.ok) throw new Error(candidateTx.error.message);
				const evalEngine = createEngine(candidateTx.value.workbook);
				const computed = evalEngine.value({ sheetId, row: 3, col: 0 });
				return typeof computed === "number" ? computed : 0;
			},
			targetRevenue,
			50,
		);

		expect(seekResult.converged).toBe(true);
		expect(seekResult.value).toBeCloseTo(100, 4);

		const finalTx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Apply GoalSeek result",
			timestamp: "2026-10-23T06:03:00Z",
			patches: [
				{
					kind: "cell",
					at: { sheetId, row: 0, col: 0 },
					cell: { input: { kind: "value", value: seekResult.value } },
				},
			],
		});
		expect(finalTx.ok).toBe(true);
		if (!finalTx.ok) throw new Error(finalTx.error.message);
		const finalEngine = createEngine(finalTx.value.workbook);
		expect(finalEngine.value({ sheetId, row: 3, col: 0 })).toBeCloseTo(18000, 2);
	});

	it("correctly computes hidden rows for table AutoFilter while preserving headers and totals", () => {
		const sheetId = createId("sheet") as SheetId;
		const tableId = createId("object") as ObjectId;
		const deptColId = createId("object") as ObjectId;
		const salaryColId = createId("object") as ObjectId;

		const tableDef: TableDefinition = {
			id: tableId,
			name: "EmployeeTable",
			range: { top: 0, left: 0, bottom: 4, right: 1 },
			columns: [
				{ id: deptColId, name: "Department" },
				{ id: salaryColId, name: "Salary" },
			],
			totalsRow: true,
			filter: {
				range: { top: 0, left: 0, bottom: 3, right: 1 },
				header: true,
				columns: [
					{
						offset: 0,
						combine: "and",
						predicates: [{ kind: "values", values: ["Engineering"] }],
					},
				],
			},
		};

		let workbook = createWorkbook({
			id: createId("workbook") as WorkbookId,
			sheetId,
			name: "Table_Filter_Test",
			timestamp: "2026-10-23T06:00:00Z",
		});

		workbook = {
			...workbook,
			sheets: {
				...workbook.sheets,
				[sheetId]: {
					...workbook.sheets[sheetId]!,
					properties: {
						...workbook.sheets[sheetId]!.properties,
						tables: [tableDef],
					},
				},
			},
		};

		const patches: Patch[] = [
			{ kind: "cell", at: { sheetId, row: 0, col: 0 }, cell: { input: { kind: "value", value: "Department" } } },
			{ kind: "cell", at: { sheetId, row: 0, col: 1 }, cell: { input: { kind: "value", value: "Salary" } } },
			{ kind: "cell", at: { sheetId, row: 1, col: 0 }, cell: { input: { kind: "value", value: "Engineering" } } },
			{ kind: "cell", at: { sheetId, row: 1, col: 1 }, cell: { input: { kind: "value", value: 100000 } } },
			{ kind: "cell", at: { sheetId, row: 2, col: 0 }, cell: { input: { kind: "value", value: "Marketing" } } },
			{ kind: "cell", at: { sheetId, row: 2, col: 1 }, cell: { input: { kind: "value", value: 80000 } } },
			{ kind: "cell", at: { sheetId, row: 3, col: 0 }, cell: { input: { kind: "value", value: "Engineering" } } },
			{ kind: "cell", at: { sheetId, row: 3, col: 1 }, cell: { input: { kind: "value", value: 120000 } } },
			{ kind: "cell", at: { sheetId, row: 4, col: 0 }, cell: { input: { kind: "value", value: "Total" } } },
			{ kind: "cell", at: { sheetId, row: 4, col: 1 }, cell: { input: { kind: "value", value: 300000 } } },
		];

		const tx = applyTransaction(workbook, {
			id: createId("transaction"),
			baseRevision: workbook.revision,
			label: "Seed employee data",
			timestamp: "2026-10-23T06:01:00Z",
			patches,
		});
		expect(tx.ok).toBe(true);
		if (!tx.ok) throw new Error(tx.error.message);
		workbook = tx.value.workbook;

		const reader = {
			value: (at: CellAddress) => {
				const cell = getCell(workbook, at);
				return cell?.input.kind === "value" ? cell.input.value : null;
			},
		};

		expect(workbook.sheets[sheetId]!.properties.filter).toBeUndefined();
		const intervals = hiddenRows(workbook.sheets[sheetId]!, reader);
		expect(intervals).toEqual([{ start: 2, end: 2 }]);
	});
});
