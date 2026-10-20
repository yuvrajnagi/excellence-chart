import type {
  CompatibilityIssue, FileOptions, ResourceLimits, Result, Workbook, WorkbookId
} from "./types.js";
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

