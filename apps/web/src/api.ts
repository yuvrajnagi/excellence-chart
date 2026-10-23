import type {
  CompatibilityIssue,
  FileOptions,
  Workbook,
  WorkbookId,
} from '@openexcel/model';

export type { CompatibilityIssue, FileOptions, Workbook, WorkbookId };

export interface ApiErrorDetail {
  readonly code:
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'VERSION_CONFLICT'
    | 'SAVE_ID_REUSED'
    | 'PAYLOAD_TOO_LARGE'
    | 'UNSUPPORTED_MEDIA'
    | 'RESOURCE_LIMIT'
    | 'IO_ERROR'
    | 'ORIGIN_REJECTED'
    | 'INTERNAL';
  readonly message: string;
  readonly requestId: string;
  readonly currentVersion?: number;
  readonly fields?: readonly { readonly path: string; readonly message: string }[];
}

export interface ApiError {
  readonly error: ApiErrorDetail;
}

export interface WorkbookSummary {
  readonly id: WorkbookId;
  readonly name: string;
  readonly storageVersion: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly openedAt: string;
}

export interface WorkbookEnvelope {
  readonly workbook: Workbook;
  readonly storageVersion: number;
  readonly savedAt: string;
}

export type CreateWorkbookRequest =
  | { readonly kind: 'blank'; readonly name: string }
  | { readonly kind: 'snapshot'; readonly workbook: Workbook; readonly name: string };

export interface ListWorkbooksQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly order?: 'recent' | 'updated';
}

export interface ListWorkbooksResponse {
  readonly items: readonly WorkbookSummary[];
  readonly nextCursor?: string;
}

export interface SaveWorkbookRequest {
  readonly saveId: string;
  readonly storageVersion?: number;
  readonly workbook: Workbook;
}

export interface SaveWorkbookResponse {
  readonly id: WorkbookId;
  readonly storageVersion: number;
  readonly savedRevision: number;
  readonly savedAt: string;
  readonly saveId: string;
}

export interface DuplicateWorkbookRequest {
  readonly name: string;
}

export interface ImportHttpOptions {
  readonly format: 'xlsx' | 'csv' | 'tsv';
  readonly name: string;
  readonly delimiter?: ',' | ';' | '\\t';
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
  readonly status: 'ok';
  readonly apiVersion: 1;
  readonly workbookSchemaVersion: 1;
  readonly limits: unknown;
  readonly maxBodyBytes: number;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string | undefined;
  readonly details?: unknown;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | undefined;
      requestId?: string | undefined;
      details?: unknown;
      cause?: unknown;
    }
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ApiRequestError';
    this.status = options.status;
    this.code = options.code ?? (options.status === 0 ? 'NETWORK_ERROR' : 'HTTP_ERROR');
    this.requestId = options.requestId;
    this.details = options.details;
    this.isRetryable =
      options.status === 0 ||
      options.status === 408 ||
      options.status === 429 ||
      options.status >= 500;
  }
}

export interface ApiClientConfig {
  baseUrl?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class ApiClient {
  readonly baseUrl: string;
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly timeoutMs: number;
  readonly defaultHeaders: Record<string, string>;
  readonly fetchFn: typeof fetch;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? '/api').replace(/\/+$/, '');
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 300;
    this.maxDelayMs = config.maxDelayMs ?? 3000;
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.defaultHeaders = config.headers ?? {};
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(
    endpoint: string,
    init: RequestInit = {},
    customRetries?: number
  ): Promise<T> {
    const url = endpoint.startsWith('http://') || endpoint.startsWith('https://')
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const maxRetries = customRetries ?? this.maxRetries;
    let attempt = 0;

    while (true) {
      if (init.signal?.aborted) {
        throw new ApiRequestError('Request aborted', {
          status: 0,
          code: 'CANCELLED',
          cause: init.signal.reason,
        });
      }

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (this.timeoutMs > 0) {
        timer = setTimeout(() => {
          controller.abort(new Error(`Request timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);
      }

      const onAbort = () => {
        controller.abort(init.signal?.reason);
      };

      if (init.signal) {
        init.signal.addEventListener('abort', onAbort, { once: true });
      }

      const headers: Record<string, string> = {
        ...this.defaultHeaders,
        ...(init.headers as Record<string, string> | undefined),
      };

      try {
        const response = await this.fetchFn(url, {
          ...init,
          headers,
          signal: controller.signal,
        });

        if (timer) clearTimeout(timer);
        if (init.signal) init.signal.removeEventListener('abort', onAbort);

        if (!response.ok) {
          let errorPayload: unknown;
          let errorMessage = `HTTP error ${response.status}: ${response.statusText}`;
          let errorCode: string | undefined;
          let requestId: string | undefined;

          try {
            const raw = await response.text();
            if (raw) {
              try {
                errorPayload = JSON.parse(raw);
                if (
                  errorPayload &&
                  typeof errorPayload === 'object' &&
                  'error' in errorPayload &&
                  typeof (errorPayload as ApiError).error === 'object'
                ) {
                  const apiErr = (errorPayload as ApiError).error;
                  errorMessage = apiErr.message || errorMessage;
                  errorCode = apiErr.code;
                  requestId = apiErr.requestId;
                }
              } catch {
                errorMessage = raw;
              }
            }
          } catch {
            // Ignore response reading errors
          }

          const apiError = new ApiRequestError(errorMessage, {
            status: response.status,
            ...(errorCode === undefined ? {} : { code: errorCode }),
            ...(requestId === undefined ? {} : { requestId }),
            ...(errorPayload === undefined ? {} : { details: errorPayload }),
          });

          if (apiError.isRetryable && attempt < maxRetries && !init.signal?.aborted) {
            const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
            const backoff = Math.min(
              this.maxDelayMs,
              this.baseDelayMs * Math.pow(2, attempt) + Math.random() * 100
            );
            const delay = retryAfterMs !== null ? retryAfterMs : backoff;
            attempt++;
            await sleep(delay);
            continue;
          }

          throw apiError;
        }

        if (response.status === 204) {
          return { ok: true } as unknown as T;
        }

        const contentType = response.headers.get('Content-Type') ?? '';
        if (contentType.includes('application/json')) {
          return (await response.json()) as T;
        }
        return (await response.text()) as unknown as T;
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (init.signal) init.signal.removeEventListener('abort', onAbort);

        if (err instanceof ApiRequestError) {
          throw err;
        }

        const isAbort =
          (err instanceof Error && err.name === 'AbortError') ||
          init.signal?.aborted;

        if (isAbort) {
          throw new ApiRequestError('Request aborted or timed out', {
            status: 0,
            code: 'CANCELLED',
            cause: err,
          });
        }

        const isNetworkError = err instanceof TypeError || (err instanceof Error && err.message.includes('fetch'));

        if (isNetworkError && attempt < maxRetries && !init.signal?.aborted) {
          const delay = Math.min(
            this.maxDelayMs,
            this.baseDelayMs * Math.pow(2, attempt) + Math.random() * 100
          );
          attempt++;
          await sleep(delay);
          continue;
        }

        throw new ApiRequestError(
          err instanceof Error ? err.message : 'Unknown network error',
          {
            status: 0,
            code: 'NETWORK_ERROR',
            cause: err,
          }
        );
      }
    }
  }

  async createWorkbook(
    request: CreateWorkbookRequest | { name: string; workbook?: Workbook } | string
  ): Promise<WorkbookEnvelope> {
    let payload: CreateWorkbookRequest;
    if (typeof request === 'string') {
      payload = { kind: 'blank', name: request };
    } else if ('kind' in request) {
      payload = request;
    } else if (request.workbook) {
      payload = { kind: 'snapshot', name: request.name, workbook: request.workbook };
    } else {
      payload = { kind: 'blank', name: request.name };
    }

    return this.request<WorkbookEnvelope>('/workbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async listWorkbooks(query?: ListWorkbooksQuery): Promise<ListWorkbooksResponse> {
    const params = new URLSearchParams();
    if (query?.limit !== undefined) {
      params.set('limit', String(query.limit));
    }
    if (query?.cursor) {
      params.set('cursor', query.cursor);
    }
    if (query?.order) {
      params.set('order', query.order);
    }

    const queryStr = params.toString();
    const endpoint = queryStr ? `/workbooks?${queryStr}` : '/workbooks';
    return this.request<ListWorkbooksResponse>(endpoint, {
      method: 'GET',
    });
  }

  async getWorkbook(id: string): Promise<WorkbookEnvelope> {
    return this.request<WorkbookEnvelope>(`/workbooks/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }

  async saveWorkbook(
    id: string,
    request: SaveWorkbookRequest | { workbook: Workbook; saveId?: string; storageVersion?: number }
  ): Promise<SaveWorkbookResponse> {
    const payload: SaveWorkbookRequest = {
      saveId: request.saveId ?? generateUuid(),
      workbook: request.workbook,
    };

    return this.request<SaveWorkbookResponse>(`/workbooks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(request.storageVersion ?? 0) },
      body: JSON.stringify(payload),
    });
  }

  async deleteWorkbook(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/workbooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async importFile(
    file: File | Blob | ArrayBuffer | Uint8Array,
    options: ImportHttpOptions
  ): Promise<ImportHttpResponse> {
    const formData = new FormData();

    let blob: Blob;
    if (file instanceof Blob) {
      blob = file;
    } else if (file instanceof Uint8Array) {
      blob = new Blob([file as unknown as BlobPart]);
    } else {
      blob = new Blob([file]);
    }

    formData.append('file', blob, options.name);
    formData.append('name', options.name);
    formData.append('format', options.format);
    formData.append('parseCsvFormulas', String(options.parseCsvFormulas));
    if (options.delimiter) {
      formData.append('delimiter', options.delimiter);
    }

    const params = new URLSearchParams({
      name: options.name,
      format: options.format,
      parseCsvFormulas: String(options.parseCsvFormulas),
    });
    if (options.delimiter) {
      params.set('delimiter', options.delimiter);
    }

    return this.request<ImportHttpResponse>(`/workbooks/import?${params.toString()}`, {
      method: 'POST',
      body: formData,
    });
  }

  async exportFile(id: string, request: ExportRequest): Promise<ExportResponse> {
    return this.request<ExportResponse>(`/workbooks/${encodeURIComponent(id)}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  async downloadExport(token: string): Promise<Blob> {
    const url = `${this.baseUrl}/export/${encodeURIComponent(token)}`;
    const response = await this.fetchFn(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new ApiRequestError(`Failed to download exported file: HTTP ${response.status}`, {
        status: response.status,
      });
    }

    return response.blob();
  }
}

export const defaultApiClient = new ApiClient();

export const createWorkbook = (
  request: CreateWorkbookRequest | { name: string; workbook?: Workbook } | string
): Promise<WorkbookEnvelope> => defaultApiClient.createWorkbook(request);

export const listWorkbooks = (query?: ListWorkbooksQuery): Promise<ListWorkbooksResponse> =>
  defaultApiClient.listWorkbooks(query);

export const getWorkbook = (id: string): Promise<WorkbookEnvelope> =>
  defaultApiClient.getWorkbook(id);

export const saveWorkbook = (
  id: string,
  request: SaveWorkbookRequest | { workbook: Workbook; saveId?: string; storageVersion?: number }
): Promise<SaveWorkbookResponse> => defaultApiClient.saveWorkbook(id, request);

export const deleteWorkbook = (id: string): Promise<{ ok: boolean }> =>
  defaultApiClient.deleteWorkbook(id);

export const importFile = (
  file: File | Blob | ArrayBuffer | Uint8Array,
  options: ImportHttpOptions
): Promise<ImportHttpResponse> => defaultApiClient.importFile(file, options);

export const exportFile = (id: string, request: ExportRequest): Promise<ExportResponse> =>
  defaultApiClient.exportFile(id, request);

export const downloadExport = (token: string): Promise<Blob> =>
  defaultApiClient.downloadExport(token);

export default defaultApiClient;
