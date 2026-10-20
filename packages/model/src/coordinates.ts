import { z } from "zod";
import type { CellAddress, CellInput, CellKey, IdTypes, ResourceLimits, Result, SheetId, TileKey } from "./types.js";

export const GRID_ROWS = 1048576;
export const GRID_COLUMNS = 16384;
export const TILE_ROWS = 128;
export const TILE_COLUMNS = 32;
export const DEFAULT_LIMITS: ResourceLimits = Object.freeze({
  maxSheets: 256, maxAuthoredCells: 2000000, maxFormulaLength: 32768,
  maxAstDepth: 1024, maxArrayCells: 1000000, maxEvaluationSteps: 50000000,
  maxCalculationMs: 30000, maxLambdaDepth: 256,
});
const ids = {
  workbook: z.uuid().brand<"WorkbookId">(), sheet: z.uuid().brand<"SheetId">(),
  style: z.uuid().brand<"StyleId">(), object: z.uuid().brand<"ObjectId">(),
  transaction: z.uuid().brand<"TransactionId">(),
};
export function createId<K extends keyof IdTypes>(kind: K): IdTypes[K] {
  // All five validators accept the same UUID representation; only their brands differ.
  return ids[kind].parse(globalThis.crypto.randomUUID()) as IdTypes[K];
}
export function parseId<K extends keyof IdTypes>(kind: K, input: unknown): Result<IdTypes[K]> {
  const parsed = ids[kind].safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data as IdTypes[K] }
    : { ok: false, error: { code: "INVALID_INPUT", message: "Expected a UUID" } };
}
export function validPosition(row: number, col: number): boolean {
  return Number.isSafeInteger(row) && Number.isSafeInteger(col)
    && row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLUMNS;
}
export function cellKey(row: number, col: number): Result<CellKey> {
  return validPosition(row, col) ? { ok: true, value: `${row}:${col}` }
    : { ok: false, error: { code: "OUT_OF_BOUNDS", message: "Cell is outside the grid" } };
}
export function tileKey(row: number, col: number): Result<TileKey> {
  return validPosition(row, col)
    ? { ok: true, value: `${Math.floor(row / TILE_ROWS)}:${Math.floor(col / TILE_COLUMNS)}` }
    : { ok: false, error: { code: "OUT_OF_BOUNDS", message: "Cell is outside the grid" } };
}
export function parseAddress(text: string, sheetId: SheetId): Result<CellAddress> {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/.exec(text);
  if (!match?.[1] || !match[2]) return { ok: false, error: { code: "INVALID_INPUT", message: "Expected an unqualified A1 address" } };
  let col = 0;
  for (const char of match[1].toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1;
  return validPosition(row, col - 1) ? { ok: true, value: { sheetId, row, col: col - 1 } }
    : { ok: false, error: { code: "OUT_OF_BOUNDS", message: "Address is outside the grid" } };
}
export function formatAddress(address: CellAddress): string {
  if (!validPosition(address.row, address.col)) return "#REF!";
  let column = address.col + 1;
  let letters = "";
  while (column > 0) {
    letters = String.fromCharCode(65 + (column - 1) % 26) + letters;
    column = Math.floor((column - 1) / 26);
  }
  return letters + (address.row + 1);
}
export function parseCellInput(text: string, dateSystem: "1900" | "1904"): CellInput {
  if (text.startsWith("'")) return { kind: "value", value: text.slice(1) };
  if (text.startsWith("=")) return { kind: "formula", source: text };
  if (text === "") return { kind: "value", value: null };
  if (/^(true|false)$/i.test(text)) return { kind: "value", value: text.toLowerCase() === "true" };
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    const value = Number(text);
    return { kind: "value", value: Number.isFinite(value) ? value : { kind: "error", code: "#NUM!" } };
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z)?$/.exec(text);
  if (dateSystem === "1900" && text === "1900-02-29") return { kind: "value", value: 60 };
  if (iso) {
    const year = Number(iso[1]), month = Number(iso[2]), day = Number(iso[3]);
    const hour = Number(iso[4] ?? 0), minute = Number(iso[5] ?? 0), second = Number(iso[6] ?? 0);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, Number((iso[7] ?? "").padEnd(3, "0")));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60) {
      let serial = (date.getTime() - Date.UTC(dateSystem === "1904" ? 1904 : 1899, dateSystem === "1904" ? 0 : 11, dateSystem === "1904" ? 1 : 31)) / 86400000;
      if (dateSystem === "1900" && serial >= 60) serial++;
      return { kind: "value", value: serial };
    }
  }
  return { kind: "value", value: text };
}
