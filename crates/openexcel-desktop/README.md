# `openexcel-desktop`

[![Crate](https://img.shields.io/badge/crate-openexcel--desktop-blue.svg)](file:///workspaces/excellence-chart/crates/openexcel-desktop)
[![Storage](https://img.shields.io/badge/storage-SQLite%20WAL-lightgrey.svg)](file:///workspaces/excellence-chart/crates/openexcel-desktop/src/storage.rs)
[![Tests Passing](https://img.shields.io/badge/Tests-10%2F10%20Passing-brightgreen.svg)](file:///workspaces/excellence-chart/crates/openexcel-desktop/tests)

The standalone native desktop runner, embedded HTTP daemon, and persistent storage engine for OpenExcel. Built in Rust with bundled SQLite, `clap` CLI parsing, and `tiny-http`, it delivers zero-configuration local execution, atomic transaction semantics, and local file system interoperability.

---

## Architectural Highlights

### 1. SQLite WAL Persistence Engine
All workbook records are stored in a local SQLite database configured for high-concurrency and durability:
- **`PRAGMA journal_mode = WAL`**: Write-Ahead Logging allows readers to proceed without blocking writers, and writers do not block readers.
- **`PRAGMA synchronous = FULL`**: Guarantees WAL log flushes to disk on every commit, preventing state corruption on power failure.
- **`PRAGMA busy_timeout = 5000`**: Automatically waits up to 5 seconds during lock contention rather than immediately failing.
- **`BEGIN IMMEDIATE` Transactions**: Acquires write intent immediately at the start of mutating transactions, preventing transaction deadlocks.

### 2. Optimistic Concurrency Control (OCC)
To eliminate silent overwrites when multiple tabs or processes access the same workbook:
- Updates require an `If-Match: <version>` header or integer storage version parameter.
- If the database version exceeds the caller's version, the server aborts the transaction with HTTP 409 `VERSION_CONFLICT` and includes the latest version in the response.

### 3. Idempotent Save Receipts
Network retries or repeated save requests are safely deduplicated:
- The server stores the last 100 save receipts per workbook.
- If a save request carries a known `saveId` or matches the computed SHA-256 content hash of the previous snapshot, the operation returns the existing version without creating duplicate revisions.

### 4. Embedded HTTP Server Daemon
The crate includes a lightweight multi-threaded HTTP server using `tiny-http`:
- Serves the OpenExcel REST API under `/api/*`.
- Serves static Web UI assets (HTML, JS, CSS, WASM) from `apps/web/dist` or precompiled release folders.
- Provides CORS preflight handling and Content Security Policy headers.

---

## CLI Reference

Build the release binary:
```bash
cargo build --release -p openexcel-desktop
```

### 1. Create a Workbook
```bash
# Create in local SQLite storage
./target/release/openexcel-desktop create --name "Q3_Forecast" --db-path "openexcel.sqlite"

# Or create as a local .openexcel JSON file
./target/release/openexcel-desktop create --name "Q3_Forecast" --out "Q3_Forecast.openexcel"
```

### 2. List Workbooks
```bash
./target/release/openexcel-desktop list --limit 20 --db-path "openexcel.sqlite"
```

### 3. Save / Export Workbook Snapshot
```bash
# Export from SQLite to a local .openexcel file
./target/release/openexcel-desktop save --id "<workbook_id>" --file "backup.openexcel" --db-path "openexcel.sqlite"
```

### 4. Run the Embedded Web Server
```bash
./target/release/openexcel-desktop serve \
  --port 3001 \
  --host 127.0.0.1 \
  --db-path "openexcel.sqlite" \
  --static-dir "dist-release/web"
```

---

## REST API Specification

| Method | Endpoint | Description | Headers / Query Params |
|---|---|---|---|
| `GET` | `/api/health` | Healthcheck and schema versions | Response: `{ status: "ok", apiVersion: 1 }` |
| `GET` | `/api/workbooks` | List workbooks | Query: `limit=50&cursor=0&order=recent` |
| `POST` | `/api/workbooks` | Create blank or import snapshot | Body: `{ kind: "blank", name: "Budget" }` |
| `GET` | `/api/workbooks/:id` | Fetch workbook JSON | Response: `{ workbook, storageVersion }` |
| `PUT` | `/api/workbooks/:id` | Save workbook with OCC | Header: `If-Match: <version>`, Body: `{ workbook, saveId }` |
| `DELETE` | `/api/workbooks/:id` | Delete workbook | Response: `{ ok: true }` |
| `GET` | `/*` | Static file server | Serves HTML, JS bundles, and WASM |

---

## Testing

Run all native storage, file I/O, and HTTP server integration tests:

```bash
cargo test -p openexcel-desktop
```

### Test Suites:
- [`tests/storage_test.rs`](file:///workspaces/excellence-chart/crates/openexcel-desktop/tests/storage_test.rs): WAL verification, atomic transactions, optimistic locking conflict detection, and idempotent receipt history.
- [`tests/file_io_test.rs`](file:///workspaces/excellence-chart/crates/openexcel-desktop/tests/file_io_test.rs): Atomic file writing, `.openexcel` JSON persistence, and corrupted file rejection.
- [`tests/server_test.rs`](file:///workspaces/excellence-chart/crates/openexcel-desktop/tests/server_test.rs): Full embedded HTTP server CRUD lifecycle and concurrency checks.
