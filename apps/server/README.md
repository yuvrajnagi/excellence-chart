# `apps/server` — OpenExcel Node.js API & Worker Service

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg?logo=node.js)](file:///workspaces/excellence-chart/apps/server)
[![Worker Threads](https://img.shields.io/badge/isolation-Worker%20Threads%20(512MB)-orange.svg)](file:///workspaces/excellence-chart/apps/server/src/jobs.ts)
[![Tests Passing](https://img.shields.io/badge/Tests-5%2F5%20Passing-brightgreen.svg)](file:///workspaces/excellence-chart/apps/server/test/server.test.ts)

The standalone Node.js service backend for OpenExcel. Built with zero external HTTP frameworks using native `node:http` and `node:sqlite`, it provides document persistence, optimistic concurrency control, and sandboxed background worker threads for CPU-intensive file import and export operations.

---

## Architectural Highlights

### 1. Sandboxed Worker Threads for File I/O
Parsing multi-megabyte XLSX workbooks or untrusted CSV files can block the event loop or consume excessive heap. `apps/server` isolates all file processing into dedicated worker threads ([`src/jobs.ts`](file:///workspaces/excellence-chart/apps/server/src/jobs.ts)):
- **Memory Capping**: Each worker thread is strictly bounded to `maxOldGenerationSizeMb: 512`.
- **Execution Deadline**: Hard 30-second execution timeout prevents denial-of-service from adversarial files or decompression bombs.
- **Worker Isolation**: Unhandled exceptions in the worker terminate only the worker thread, leaving the main HTTP server unaffected.

### 2. Transactional SQLite Persistence
- **Storage Layer**: Backed by `node:sqlite` with Write-Ahead Logging (`WAL`).
- **Optimistic Concurrency Control**: Validates incoming `If-Match: <version>` headers on saves, rejecting stale modifications with HTTP 409 `VERSION_CONFLICT`.
- **Receipt History**: Retains the last 100 save receipts per workbook to ensure idempotent retries under unstable network conditions.

### 3. Local Origin Security Enforcement
- Strictly rejects cross-origin requests (`Origin` header mismatch) to prevent unauthorized websites from mutating local spreadsheet files.
- Restricts request payloads to a maximum of 128 MiB (`MAX_BODY`).

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status, API version, and payload limits |
| `GET` | `/api/workbooks` | List stored workbooks with pagination (`limit`, `cursor`, `order`) |
| `POST` | `/api/workbooks` | Create a blank workbook or store an initial snapshot |
| `GET` | `/api/workbooks/:id` | Fetch full workbook JSON by ID |
| `PUT` | `/api/workbooks/:id` | Update workbook state with `If-Match: <version>` validation |
| `DELETE` | `/api/workbooks/:id` | Delete a workbook |
| `POST` | `/api/workbooks/import` | Upload and import XLSX or CSV file (multipart or binary) |
| `POST` | `/api/workbooks/:id/export`| Dispatch background XLSX export job and return download token |
| `GET` | `/api/export/:token` | Download generated XLSX export binary |

---

## Directory Structure

```text
apps/server/
├── package.json          # Node package manifest
├── tsconfig.json         # TypeScript configuration
├── src/
│   ├── index.ts          # Server entry point & process signal handling
│   ├── app.ts            # Native HTTP request router & middleware
│   ├── storage.ts        # SQLite storage engine & OCC transaction logic
│   ├── jobs.ts           # Sandboxed worker thread pool manager
│   ├── import-worker.ts  # Worker thread entry for XLSX/CSV imports
│   └── export-worker.ts  # Worker thread entry for XLSX export generation
└── test/
    └── server.test.ts    # Comprehensive HTTP & persistence test suite
```

---

## Running & Testing

```bash
# Run standalone server
node --experimental-sqlite apps/server/dist/index.js

# Run automated HTTP and storage integration tests
npm test apps/server/test/server.test.ts
```

Environment variables:
- `PORT`: HTTP port to bind (default `3001`).
- `HOST`: Host interface (default `127.0.0.1`).
- `DATA_DIR`: Directory for SQLite storage files (default `.data`).
- `STATIC_DIR`: Directory of Web UI assets to serve (default `apps/web/dist`).
