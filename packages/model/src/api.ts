import type {
  CompatibilityIssue, FileOptions, ResourceLimits, Workbook, WorkbookId
} from "./types.js";
import { z } from "zod";
import {
  compatibilityIssueSchema, fileOptionsSchema, parseBoundary, resourceLimitsSchema,
  workbookSchema,
} from "./schemas.js";
export interface ApiError {
  readonly error: {
    readonly code: "INVALID_INPUT" | "NOT_FOUND" | "VERSION_CONFLICT"
      | "SAVE_ID_REUSED" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA"
      | "RESOURCE_LIMIT" | "IO_ERROR" | "ORIGIN_REJECTED" | "INTERNAL";
    readonly message: string;
    readonly requestId: string;
    readonly currentVersion?: number;
    readonly fields?: readonly { readonly path: string; readonly message: string }[];
  };
}
export interface WorkbookSummary {
  readonly id: WorkbookId; readonly name: string;
  readonly storageVersion: number; readonly revision: number;
  readonly createdAt: string; readonly updatedAt: string; readonly openedAt: string;
}
export interface WorkbookEnvelope {
  readonly workbook: Workbook;
  readonly storageVersion: number;
  readonly savedAt: string;
}
export type CreateWorkbookRequest =
  | { readonly kind: "blank"; readonly name: string }
  | { readonly kind: "snapshot"; readonly workbook: Workbook; readonly name: string };
export interface ListWorkbooksQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly order: "recent" | "updated";
}
export interface ListWorkbooksResponse {
  readonly items: readonly WorkbookSummary[];
  readonly nextCursor?: string;
}
export interface SaveWorkbookRequest {
  readonly saveId: string;
  readonly workbook: Workbook;
}
export interface SaveWorkbookResponse {
  readonly id: WorkbookId; readonly storageVersion: number;
  readonly savedRevision: number; readonly savedAt: string; readonly saveId: string;
}
export interface DuplicateWorkbookRequest {
  readonly name: string;
}
export interface ImportHttpOptions {
  readonly format: "xlsx" | "csv" | "tsv";
  readonly name: string;
  readonly delimiter?: "," | ";" | "\\t";
  readonly parseCsvFormulas: boolean;
}
export interface ImportHttpResponse {
  readonly workbook: Workbook;
  readonly issues: readonly CompatibilityIssue[];
}
export interface ExportRequest {
  readonly storageVersion: number;
  readonly file: FileOptions;
  readonly calculation: { readonly nowMs: number; readonly randomSeed: number };
}
export interface ExportResponse {
  readonly token: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly expiresAt: string;
  readonly issues: readonly CompatibilityIssue[];
}
export interface HealthResponse {
  readonly status: "ok";
  readonly apiVersion: 1;
  readonly workbookSchemaVersion: 1;
  readonly limits: ResourceLimits;
  readonly maxBodyBytes: number;
}

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = integer.positive();
const text = z.string();
const timestamp = z.iso.datetime({ offset: true });
const summarySchema = z.strictObject({
  id: z.uuid().brand<"WorkbookId">(), name: text.min(1), storageVersion: positive,
  revision: integer, createdAt: timestamp, updatedAt: timestamp, openedAt: timestamp,
});
const apiErrorSchema = z.strictObject({ error: z.strictObject({
  code: z.enum(["INVALID_INPUT", "NOT_FOUND", "VERSION_CONFLICT", "SAVE_ID_REUSED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA", "RESOURCE_LIMIT", "IO_ERROR", "ORIGIN_REJECTED", "INTERNAL"]),
  message: text, requestId: text, currentVersion: positive.optional(),
  fields: z.array(z.strictObject({ path: text, message: text })).optional(),
}) }) as z.ZodType<ApiError>;
const createSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("blank"), name: text.min(1) }),
  z.strictObject({ kind: z.literal("snapshot"), workbook: workbookSchema, name: text.min(1) }),
]);
const listQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
  order: z.enum(["recent", "updated"]).default("recent"),
});
const listResponseSchema = z.strictObject({
  items: z.array(summarySchema), nextCursor: z.string().min(1).max(512).optional(),
});
const saveRequestSchema = z.strictObject({ saveId: z.uuid(), workbook: workbookSchema });
const saveResponseSchema = z.strictObject({
  id: z.uuid().brand<"WorkbookId">(), storageVersion: positive, savedRevision: integer,
  savedAt: timestamp, saveId: z.uuid(),
});
const importOptionsSchema = z.strictObject({
  format: z.enum(["xlsx", "csv", "tsv"]), name: text.min(1),
  delimiter: z.enum([",", ";", "\\t"]).optional(), parseCsvFormulas: z.boolean(),
});
const exportRequestSchema = z.strictObject({
  storageVersion: positive, file: fileOptionsSchema,
  calculation: z.strictObject({
    nowMs: z.number().int().min(0).max(8_640_000_000_000_000),
    randomSeed: z.number().int().min(0).max(0xffff_ffff),
  }),
});
const envelopeSchema = z.strictObject({
  workbook: workbookSchema, storageVersion: positive, savedAt: timestamp,
});
const duplicateSchema = z.strictObject({ name: text.min(1) });
const importResponseSchema = z.strictObject({
  workbook: workbookSchema, issues: z.array(compatibilityIssueSchema),
});
const exportResponseSchema = z.strictObject({
  token: text.min(1), filename: text.min(1), mediaType: text.min(1), bytes: integer,
  expiresAt: timestamp, issues: z.array(compatibilityIssueSchema),
});
const healthSchema = z.strictObject({
  status: z.literal("ok"), apiVersion: z.literal(1), workbookSchemaVersion: z.literal(1),
  limits: resourceLimitsSchema, maxBodyBytes: positive,
});

export const parseCreateWorkbookRequest = (input: unknown) => parseBoundary(createSchema, input);
export const parseSaveWorkbookRequest = (input: unknown) => parseBoundary(saveRequestSchema, input);
export const parseImportHttpOptions = (input: unknown) => parseBoundary(importOptionsSchema, input);
export const parseExportRequest = (input: unknown) => parseBoundary(exportRequestSchema, input);
export const parseListWorkbooksQuery = (input: unknown) => parseBoundary(listQuerySchema, input);
export const parseWorkbookEnvelope = (input: unknown) => parseBoundary(envelopeSchema, input);
export const parseApiError = (input: unknown) => parseBoundary(apiErrorSchema, input);
export const parseDuplicateWorkbookRequest = (input: unknown) => parseBoundary(duplicateSchema, input);
export const parseListWorkbooksResponse = (input: unknown) => parseBoundary(listResponseSchema, input);
export const parseSaveWorkbookResponse = (input: unknown) => parseBoundary(saveResponseSchema, input);
export const parseImportHttpResponse = (input: unknown) => parseBoundary(importResponseSchema, input);
export const parseExportResponse = (input: unknown) => parseBoundary(exportResponseSchema, input);
export const parseHealthResponse = (input: unknown) => parseBoundary(healthSchema, input);

