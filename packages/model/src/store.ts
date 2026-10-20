import type {
  AppliedTransaction, Cell, CellAddress, CellKey, Commit, Edit, Patch, RangeRef,
  ResourceLimits, Result, Sheet, SheetId, Tile, TileKey, Transaction, Workbook, WorkbookId,
} from "./types.js";
import { DEFAULT_LIMITS, TILE_COLUMNS, TILE_ROWS, validPosition } from "./coordinates.js";
import { editSchema, freeze, parseBoundary, transactionSchema, validateWorkbookState } from "./schemas.js";

const emptyCell = (cell: Cell): boolean => cell.input.kind === "value" && cell.input.value === null
  && cell.styleId === undefined && cell.note === undefined;
const keyOf = (row: number, col: number): CellKey => `${row}:${col}`;
const tileOf = (row: number, col: number): TileKey => `${Math.floor(row / TILE_ROWS)}:${Math.floor(col / TILE_COLUMNS)}`;

export function createWorkbook(options: {
  readonly id: WorkbookId; readonly sheetId: SheetId; readonly name: string; readonly timestamp: string;
}): Workbook {
  return freeze({
    schemaVersion: 1, id: options.id, revision: 0,
    properties: {
      name: options.name, dateSystem: "1900", locale: "en-US", author: "", description: "",
      createdAt: options.timestamp, modifiedAt: options.timestamp, activeSheetId: options.sheetId,
      theme: { name: "OpenExcel", fontFamily: "Arial", colors: ["#FFFFFF", "#000000", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000"] },
      namedStyles: {},
    },
    sheetOrder: [options.sheetId],
    sheets: {
      [options.sheetId]: {
        id: options.sheetId, tiles: {},
        properties: {
          name: "Sheet1", hidden: false, defaultRowHeight: 24, defaultColumnWidth: 100,
          rowInfo: {}, columnInfo: {}, groups: [], merges: [], conditionalFormats: [],
          validations: [], tables: [], pivots: [], charts: [],
          view: {
            freezeRows: 0, freezeColumns: 0, zoom: 100, scrollRow: 0, scrollColumn: 0,
            active: { row: 0, col: 0 }, selection: [{ top: 0, left: 0, bottom: 0, right: 0 }], gridlines: true,
          },
        },
      },
    },
    styles: {}, names: [],
  });
}
export function getCell(workbook: Workbook, at: CellAddress): Cell | undefined {
  if (!validPosition(at.row, at.col)) return undefined;
  return workbook.sheets[at.sheetId]?.tiles[tileOf(at.row, at.col)]?.[keyOf(at.row, at.col)];
}
export function* entries(workbook: Workbook, range: RangeRef): Iterable<{ readonly at: CellAddress; readonly cell: Cell }> {
  const sheet = workbook.sheets[range.sheetId];
  if (!sheet || !validPosition(range.top, range.left) || !validPosition(range.bottom, range.right)
    || range.top > range.bottom || range.left > range.right) return;
  for (const [tileKey, tile] of Object.entries(sheet.tiles)) {
    if (!tile) continue;
    const [tr = -1, tc = -1] = tileKey.split(":").map(Number);
    if ((tr + 1) * TILE_ROWS <= range.top || tr * TILE_ROWS > range.bottom
      || (tc + 1) * TILE_COLUMNS <= range.left || tc * TILE_COLUMNS > range.right) continue;
    for (const [key, cell] of Object.entries(tile)) {
      if (!cell) continue;
      const [row = -1, col = -1] = key.split(":").map(Number);
      if (row >= range.top && row <= range.bottom && col >= range.left && col <= range.right)
        yield { at: { sheetId: range.sheetId, row, col }, cell };
    }
  }
}
function canonicalWorkbook(w: Workbook): Workbook {
  const sheets: Record<string, Sheet> = { ...w.sheets };
  let changed = false;
  for (const [id, sheet] of Object.entries(sheets)) {
    const tiles: Partial<Record<TileKey, Tile>> = { ...sheet.tiles };
    let sheetChanged = false;
    for (const [tk, tile] of Object.entries(sheet.tiles)) {
      if (!tile) continue;
      const cells: Partial<Record<CellKey, Cell>> = { ...tile };
      let tileChanged = false;
      for (const [ck, cell] of Object.entries(tile)) if (cell && emptyCell(cell)) { delete cells[ck as CellKey]; tileChanged = true; }
      if (!Object.keys(cells).length) { delete tiles[tk as TileKey]; sheetChanged = true; }
      else if (tileChanged) { tiles[tk as TileKey] = cells; sheetChanged = true; }
    }
    if (sheetChanged) { sheets[id] = { ...sheet, tiles }; changed = true; }
  }
  return changed ? { ...w, sheets } : w;
}
export function parseWorkbook(input: unknown, limits: ResourceLimits = DEFAULT_LIMITS): Result<Workbook> {
  const parsed = validateWorkbookState(input, limits);
  return parsed.ok ? { ok: true, value: freeze(canonicalWorkbook(parsed.value)) } : parsed;
}
export function validateEdit(input: unknown): Result<Edit> {
  return parseBoundary(editSchema, input);
}

export function applyTransaction(workbook: Workbook, transaction: Transaction): Result<AppliedTransaction> {
  const parsed = parseBoundary(transactionSchema, transaction);
  if (!parsed.ok) return parsed;
  const tx = parsed.value;
  if (tx.baseRevision !== workbook.revision) return { ok: false, error: { code: "CONFLICT", message: "Transaction base revision is stale" } };
  if (!Number.isSafeInteger(workbook.revision + 1)) return { ok: false, error: { code: "RESOURCE_LIMIT", message: "Revision cannot increase safely" } };
  // These maps are transaction-local builders. Each sheet index and touched tile is copied once.
  const sheets: Record<string, Sheet> = { ...workbook.sheets };
  const tileStores = new Map<string, Partial<Record<TileKey, Tile>>>();
  const tiles = new Map<string, Partial<Record<CellKey, Cell>>>();
  const styles = { ...workbook.styles };
  let properties = workbook.properties, sheetOrder = workbook.sheetOrder, names = workbook.names;
  const inverse: Patch[] = [];
  const changedCells = new Map<string, CellAddress>(), changedSheets = new Set<SheetId>();
  let structure = false, stylesChanged = false, namesChanged = false;
  const missing = (): Result<AppliedTransaction> => ({ ok: false, error: { code: "NOT_FOUND", message: "Patch references missing sheet" } });
  for (const patch of tx.patches) {
    switch (patch.kind) {
      case "cell": {
        const sheet = sheets[patch.at.sheetId];
        if (!sheet) return missing();
        const tk = tileOf(patch.at.row, patch.at.col), ck = keyOf(patch.at.row, patch.at.col);
        inverse.push({ kind: "cell", at: patch.at, cell: sheet.tiles[tk]?.[ck] ?? null });
        let store = tileStores.get(sheet.id);
        if (!store) { store = { ...sheet.tiles }; tileStores.set(sheet.id, store); sheets[sheet.id] = { ...sheet, tiles: store }; }
        const identity = `${sheet.id}/${tk}`;
        let tile = tiles.get(identity);
        if (!tile) { tile = { ...store[tk] }; tiles.set(identity, tile); }
        if (patch.cell === null || emptyCell(patch.cell)) delete tile[ck];
        else tile[ck] = patch.cell;
        if (Object.keys(tile).length === 0) delete store[tk]; else store[tk] = tile;
        changedCells.set(`${sheet.id}/${ck}`, patch.at); changedSheets.add(sheet.id);
        break;
      }
      case "sheet": {
        if (patch.sheet !== null && patch.sheet.id !== patch.sheetId) return { ok: false, error: { code: "INVALID_INPUT", message: "Sheet patch ID mismatch" } };
        inverse.push({ kind: "sheet", sheetId: patch.sheetId, sheet: sheets[patch.sheetId] ?? null });
        if (patch.sheet === null) delete sheets[patch.sheetId]; else sheets[patch.sheetId] = patch.sheet;
        tileStores.delete(patch.sheetId);
        for (const key of tiles.keys()) if (key.startsWith(`${patch.sheetId}/`)) tiles.delete(key);
        changedSheets.add(patch.sheetId); structure = true; break;
      }
      case "sheetProperties": {
        const sheet = sheets[patch.sheetId]; if (!sheet) return missing();
        inverse.push({ kind: "sheetProperties", sheetId: sheet.id, properties: sheet.properties });
        sheets[sheet.id] = { ...sheet, properties: patch.properties }; changedSheets.add(sheet.id); structure = true; break;
      }
      case "sheetOrder":
        inverse.push({ kind: "sheetOrder", order: sheetOrder }); sheetOrder = patch.order; structure = true; break;
      case "workbookProperties":
        inverse.push({ kind: "workbookProperties", properties }); properties = patch.properties; break;
      case "style":
        inverse.push({ kind: "style", styleId: patch.styleId, style: styles[patch.styleId] ?? null });
        if (patch.style === null) delete styles[patch.styleId]; else styles[patch.styleId] = patch.style;
        stylesChanged = true; break;
      case "names":
        inverse.push({ kind: "names", names }); names = patch.names; namesChanged = true; break;
      default: {
        const exhaustive: never = patch; return exhaustive;
      }
    }
  }
  // The timestamp write is the last authored change and therefore the first inverse.
  inverse.push({ kind: "workbookProperties", properties });
  const candidate = canonicalWorkbook({
    ...workbook, revision: workbook.revision + 1, sheets, styles, sheetOrder, names,
    properties: { ...properties, modifiedAt: tx.timestamp },
  });
  const validated = validateWorkbookState(candidate);
  if (!validated.ok) return validated;
  const commit: Commit = freeze({
    transaction: tx, revision: candidate.revision, inverse: inverse.reverse(),
    changes: { cells: [...changedCells.values()], sheets: [...changedSheets], structure, names: namesChanged, styles: stylesChanged },
  });
  return { ok: true, value: freeze({ workbook: candidate, commit }) };
}
