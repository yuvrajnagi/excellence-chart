import { describe, expect, it } from "vitest";
import {
  parseApiError, parseCreateWorkbookRequest, parseDuplicateWorkbookRequest,
  parseExportRequest, parseExportResponse, parseHealthResponse, parseImportHttpOptions,
  parseImportHttpResponse, parseListWorkbooksQuery, parseListWorkbooksResponse,
  parseSaveWorkbookRequest, parseSaveWorkbookResponse, parseWorkbookEnvelope,
} from "../src/api.js";
import { DEFAULT_LIMITS, createWorkbook, createId } from "../src/index.js";

const timestamp = "2026-10-20T12:00:00.000Z";
const workbook = createWorkbook({
  id: createId("workbook"), sheetId: createId("sheet"), name: "Test", timestamp,
});

describe("API boundary parsers", () => {
  it("parses create variants and rejects unknown or extra fields", () => {
    expect(parseCreateWorkbookRequest({ kind: "blank", name: "Book" }).ok).toBe(true);
    expect(parseCreateWorkbookRequest({ kind: "snapshot", name: "Copy", workbook }).ok).toBe(true);
    expect(parseCreateWorkbookRequest({ kind: "blank", name: "Book", extra: true }).ok).toBe(false);
    expect(parseCreateWorkbookRequest({ kind: "other", name: "Book" }).ok).toBe(false);
  });

  it("applies list query defaults and rejects invalid bounds", () => {
    const parsed = parseListWorkbooksQuery({});
    expect(parsed.ok && parsed.value).toEqual({ limit: 50, order: "recent" });
    expect(parseListWorkbooksQuery({ limit: 101 }).ok).toBe(false);
    expect(parseListWorkbooksQuery({ unexpected: true }).ok).toBe(false);
  });

  it("validates requests, responses, errors, and health strictly", () => {
    const id = createId("workbook");
    expect(parseSaveWorkbookRequest({ saveId: createId("transaction"), workbook }).ok).toBe(true);
    expect(parseSaveWorkbookRequest({ saveId: "not-a-uuid", workbook }).ok).toBe(false);
    expect(parseDuplicateWorkbookRequest({ name: "Copy", extra: 1 }).ok).toBe(false);
    expect(parseImportHttpOptions({ format: "csv", name: "Import", parseCsvFormulas: false }).ok).toBe(true);
    expect(parseExportRequest({
      storageVersion: 1,
      file: { format: "xlsx", csvEscapeFormulas: true },
      calculation: { nowMs: Date.parse(timestamp), randomSeed: 1 },
    }).ok).toBe(true);
    expect(parseWorkbookEnvelope({ workbook, storageVersion: 1, savedAt: timestamp }).ok).toBe(true);
    expect(parseWorkbookEnvelope({ workbook, storageVersion: 1, savedAt: timestamp, extra: true }).ok).toBe(false);
    expect(parseApiError({ error: { code: "NOT_FOUND", message: "Missing", requestId: "r1" } }).ok).toBe(true);
    expect(parseApiError({ error: { code: "NOT_FOUND", message: "Missing", requestId: "r1", extra: 1 } }).ok).toBe(false);
    expect(parseListWorkbooksResponse({ items: [], nextCursor: "abc" }).ok).toBe(true);
    expect(parseSaveWorkbookResponse({ id, storageVersion: 1, savedRevision: 0, savedAt: timestamp, saveId: createId("transaction") }).ok).toBe(true);
    expect(parseImportHttpResponse({ workbook, issues: [] }).ok).toBe(true);
    expect(parseExportResponse({ token: "opaque", filename: "book.xlsx", mediaType: "application/xlsx", bytes: 0, expiresAt: timestamp, issues: [] }).ok).toBe(true);
    expect(parseHealthResponse({ status: "ok", apiVersion: 1, workbookSchemaVersion: 1, limits: DEFAULT_LIMITS, maxBodyBytes: 1000 }).ok).toBe(true);
    expect(parseHealthResponse({ status: "ok", apiVersion: 1, workbookSchemaVersion: 1, limits: DEFAULT_LIMITS, maxBodyBytes: 1000, extra: true }).ok).toBe(false);
  });
});
