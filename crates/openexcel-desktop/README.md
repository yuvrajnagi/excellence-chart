# `openexcel-desktop`

Standalone native desktop runner and persistent SQLite storage server for OpenExcel.

---

## Capabilities

- **SQLite WAL Storage Engine**: High-performance persistence backed by bundled SQLite in Write-Ahead Logging (WAL) mode with `synchronous = FULL` and immediate transactions.
- **Optimistic Concurrency Control**: Header-based version checking (`If-Match: <version>`) prevents concurrent overwrite races and detects stale modifications (HTTP 409 `VERSION_CONFLICT`).
- **Idempotent Saves**: SHA-256 snapshot hashing eliminates duplicate history records on network retries.
- **Embedded Web Server**: Lightweight HTTP daemon powered by `tiny-http` serving both the REST API and the production Web UI.
- **Local File System I/O**: Direct file commands to open and save native `.openexcel` and `.xlsx` workbooks.
- **Cross-Platform CLI**: Command-line interface built with `clap` for scripting and desktop automation.

---

## CLI Usage

```bash
# Build the native binary
cargo build --release -p openexcel-desktop

# 1. Create a workbook
./target/release/openexcel-desktop create --name "Q3_Budget" --db-path "openexcel.sqlite"

# 2. List workbooks
./target/release/openexcel-desktop list --db-path "openexcel.sqlite"

# 3. Serve the web application
./target/release/openexcel-desktop serve --port 3001 --static-dir "dist-release/web" --db-path "openexcel.sqlite"

# 4. Save a snapshot to local file
./target/release/openexcel-desktop save --id "wb_12345" --file "budget.openexcel"
```

---

## Testing

```bash
cargo test -p openexcel-desktop
```
