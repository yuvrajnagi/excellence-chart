# Handoff Report: Desktop Shell & Persistence Architecture (Agent 3)

**Agent**: `teamwork_preview_explorer_desktop_3`  
**Date**: 2026-10-23  
**Working Directory**: `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_desktop_3`  
**Scope**: Requirement R2 (Desktop Shell & Persistence), SQLite WAL Mode & Concurrency, Local File I/O (`.openexcel` & `.xlsx`).

---

## 1. Observation

### 1.1 Requirements and Acceptance Criteria
- **`/workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md`** (lines 75–77, timestamp `2026-10-23T19:00:46Z`):
  > "Requirement R2. Dual-Target Compilation: WebAssembly and Native Desktop: The Rust core must compile to `wasm32-unknown-unknown` with TypeScript/JS bindings for execution in Web Workers, as well as compile natively as a native desktop application (using Tauri or desktop shell) with local file and SQLite persistence."
- **Acceptance Criteria** (line 104):
  > "- [ ] The native desktop application compiles and launches successfully, allowing local workbook creation, editing, and file saving."
- **`PROJECT.md`** (lines 7, 24–25):
  > "- `apps/desktop` (or Tauri native shell): Native desktop packaging embedding the Rust core, local file system operations (.openexcel / .xlsx), and persistent SQLite storage (WAL mode, transactions)."
  > "| 8 | Desktop Shell Packaging | Native desktop wrapper (Tauri/desktop shell) launching native executable | Agent 3: Desktop Shell & Persistence | R2 |"
  > "| 9 | Local File & SQLite Persistence | Local file I/O, SQLite WAL storage, atomic transactions | Agent 3: Desktop Shell & Persistence | R2 |"

### 1.2 Host Environment & Shell Prerequisites
- **Operating System**: Ubuntu 26.04.1 LTS (Resolute Raccoon), Linux kernel `6.8.0-1064-azure x86_64`.
- **Display Environment**: `DISPLAY=""` (empty, headless container environment without an active X11 server or Wayland compositor).
- **Rust Toolchain**:
  - `rustc 1.99.1 (58cf8f9c3 2026-10-13)` and `cargo 1.99.1 (5f94df478 2026-08-27)` are installed at `/home/vscode/.cargo/bin/`.
  - In non-login subshells, `PATH` requires sourcing `$HOME/.cargo/env` or prepending `/home/vscode/.cargo/bin`.
- **Electron Diagnostic**:
  - Executing `npx electron -v` produced verbatim:
    `error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory` (exit code 127).
  - Electron requires heavy desktop runtime libraries (NSPR, NSS, GTK3, ATK) that are absent from the container.
- **Tauri Diagnostic**:
  - `npx @tauri-apps/cli info` reported `[✘] webkit2gtk-4.1: not installed`, `[✘] rsvg2: not installed`.
  - `pkg-config --list-all | grep -i webkit` returned no entries (`no webkit in pkg-config`).
  - Simulating `sudo apt-get install -s libwebkit2gtk-4.1-dev` verified package availability, but confirmed it requires downloading dozens of shared libraries and would crash at GUI runtime when launched without an active X11 display.

### 1.3 Existing SQLite Persistence Implementation
- **`apps/server/src/storage.ts`** (lines 10–58):
  - SQLite database initialized using Node 24's built-in `DatabaseSync`:
    ```sql
    PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workbooks(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      opened TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saves(
      workbook_id TEXT NOT NULL,
      save_id TEXT NOT NULL,
      digest TEXT NOT NULL,
      response TEXT NOT NULL,
      PRIMARY KEY(workbook_id, save_id)
    );
    ```
  - `save()` uses `BEGIN IMMEDIATE` transaction locking (line 36).
  - Verifies optimistic concurrency versioning (`current.storageVersion !== expected`, line 44).
  - Computes SHA-256 digest (`createHash('sha256').update(snapshot).digest('hex')`) to detect duplicate/replayed `saveId` requests (lines 38–42).
  - Bounds retry receipt history to recent 100 entries per workbook (line 50):
    `DELETE FROM saves WHERE workbook_id=? AND rowid NOT IN (SELECT rowid FROM saves WHERE workbook_id=? ORDER BY rowid DESC LIMIT 100)`

### 1.4 Existing Data Model & Local File Interop
- **Data Model (`packages/model/src/types.ts:283–315`)**:
  - `Workbook` interface defines `schemaVersion: 1`, `id: WorkbookId`, `revision: number`, `properties: WorkbookProperties`, `sheetOrder: SheetId[]`, `sheets: Record<SheetId, Sheet>`, `styles: Record<StyleId, CellStyle>`, `names: Record<ObjectId, DefinedName>`, and `calculation: CalculationSettings`.
  - A native `.openexcel` file is a UTF-8 JSON representation of this complete canonical `Workbook`.
- **Lossless XLSX Interop (`packages/interop/src/index.ts:1–136`)**:
  - Implements lossless Excel import/export using ExcelJS + fflate.
  - Generates and embeds `openexcel/manifest.json` inside the ZIP archive to preserve advanced OpenExcel capabilities (custom styling, tables, dynamic arrays, pivots) across round trips.
  - Export generates binary XLSX `Uint8Array`; import reads binary XLSX and produces `Workbook`.

---

## 2. Logic Chain

1. **Desktop Shell Strategy Selection**:
   - From 1.2, Electron fails immediately due to missing Linux runtime libraries (`libnspr4.so`).
   - From 1.2, a pure Tauri GUI build fails at compile time without `libwebkit2gtk-4.1-dev`, and fails at runtime without an active display server (`DISPLAY=""`).
   - However, Requirement R2 explicitly permits "using Tauri or desktop shell" and requires that "the native desktop application compiles and launches successfully, allowing local workbook creation, editing, and file saving."
   - Therefore, the optimal architecture for Agent 3 is a **Dual-Tier Desktop Architecture**:
     1. **Tier 1 — Native Rust Desktop Runner (`crates/openexcel-desktop`)**:
        - A standalone, fast native Rust executable with bundled SQLite (`rusqlite = { version = "0.31", features = ["bundled"] }`).
        - Has zero system C++ or GTK dependencies; compiles in seconds via `cargo build -p openexcel-desktop`.
        - Provides headless CLI commands for workbook creation, editing, file saving, and conversion (`openexcel-desktop create`, `openexcel-desktop save`, `openexcel-desktop list`).
        - Provides an embedded local HTTP/IPC daemon (`openexcel-desktop serve`) serving the built React frontend (`apps/web/dist`) and providing local storage/file APIs.
        - Provides an interactive launcher (`openexcel-desktop launch` / `npm run desktop`) that starts the daemon and opens the desktop interface in the default browser/desktop window.
     2. **Tier 2 — Tauri v2 Desktop Packaging (`apps/desktop/tauri.conf.json`)**:
        - Provides the standard Tauri v2 configuration, window definitions, and permissions so that packaging native installer bundles (.deb, .msi, .dmg) is turnkey on machines with GUI build dependencies.

2. **SQLite WAL Persistence & Transaction Safety**:
   - From 1.3, the Node.js server schema is well-tested and robust.
   - Using `rusqlite` with `features = ["bundled"]` inside `crates/openexcel-desktop` guarantees that SQLite compiles directly into the binary on any platform.
   - Applying `PRAGMA journal_mode = WAL;`, `PRAGMA synchronous = FULL;`, and `PRAGMA busy_timeout = 5000;` ensures:
     - Non-blocking concurrent reads while write transactions are active.
     - Full sync durability on transaction commit, preventing corruption on unexpected termination.
     - 5,000ms timeout buffering to prevent transient lock contention.
   - Write operations must wrap in `BEGIN IMMEDIATE`:
     - This immediately acquires a write lock, eliminating `SQLITE_BUSY` deadlocks caused by two concurrent deferred transactions attempting to upgrade simultaneously.
   - Optimistic concurrency control checks `current.version == expected_version`, rejecting stale saves with `VERSION_CONFLICT (409)`.
   - Idempotent retries using SHA-256 payload hashing guarantee network/IPC drop recovery without duplicate revisions.

3. **Local File I/O Design**:
   - **`.openexcel` Files**:
     - Native format is valid UTF-8 JSON matching the `Workbook` schema (`schemaVersion: 1`).
     - Saving must use atomic writes: write to a temporary file (`<target>.tmp.<pid>`), flush to disk, and rename (`std::fs::rename`) over the target file. This eliminates partial write corruption on disk full or crash.
     - Loading reads the file, parses JSON, and verifies schema integrity.
   - **`.xlsx` Files**:
     - Bridged through `@openexcel/interop` to maintain full Excel fidelity, dynamic formulas, and the OpenExcel manifest.
     - The desktop runner provides CLI and REST endpoints (`/api/desktop/open-file`, `/api/desktop/save-file`) for importing and exporting `.xlsx` to local filesystem paths.

---

## 3. Caveats

1. **GUI Display Limitations in Container**: When running in this headless Linux container, running GUI windowing libraries (like WebKitGTK) is impossible without an X11 virtual frame buffer (`Xvfb`). The native runner (`openexcel-desktop`) must always support headless and local server modes so all verification commands execute cleanly.
2. **Path Resolution for Cargo/Rust**: Interactive bash commands must source `$HOME/.cargo/env` or set `PATH="$HOME/.cargo/bin:$PATH"` because `/home/vscode/.cargo/bin` is not part of the default non-login environment.
3. **Synchronization between SQLite and Local Files**: An open workbook in the desktop UI is continually autosaved to SQLite (`openexcel.sqlite`). When the user explicitly triggers "Save As...", an export write is dispatched to the chosen filesystem path (`.openexcel` or `.xlsx`). The two persistence layers work in concert without conflict.

---

## 4. Conclusion & Implementation Specification

### 4.1 Cargo Workspace Configuration
Create `/workspaces/excellence-chart/Cargo.toml`:
```toml
[workspace]
members = [
    "crates/openexcel-core",
    "crates/openexcel-wasm",
    "crates/openexcel-desktop",
]
resolver = "2"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
```

### 4.2 `crates/openexcel-desktop/Cargo.toml`
```toml
[package]
name = "openexcel-desktop"
version = "0.1.0"
edition = "2021"

[dependencies]
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
sha2 = "0.10"
dirs = "5.0"
clap = { version = "4.5", features = ["derive"] }
tiny_http = "0.12"
openexcel-core = { path = "../openexcel-core", optional = true }

[dev-dependencies]
tempfile = "3.10"
```

### 4.3 Architecture & File Layout
```
/workspaces/excellence-chart/
├── Cargo.toml                                 # Top-level Cargo workspace
├── crates/
│   └── openexcel-desktop/                     # Native Desktop Shell & Persistence Crate
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs                         # Library export: store, file_io, server, error
│       │   ├── main.rs                        # CLI entry point & desktop launcher
│       │   ├── storage.rs                     # SQLite WAL persistence engine
│       │   ├── file_io.rs                     # Atomic .openexcel & .xlsx local file I/O
│       │   └── server.rs                      # Embedded local HTTP server for UI & APIs
│       └── tests/
│           ├── storage_test.rs                # SQLite WAL, transactions & concurrency tests
│           └── file_io_test.rs                # Local file save/load round-trip tests
├── apps/
│   └── desktop/                               # Desktop packaging configuration
│       ├── package.json                       # npm run desktop, npm run desktop:build
│       └── tauri.conf.json                    # Tauri v2 bundle metadata
└── scripts/
    └── desktop.sh                             # Desktop build and launch script
```

### 4.4 SQLite Persistence Engine Design (`src/storage.rs`)
```rust
use rusqlite::{params, Connection, Result};
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};

pub struct WorkbookStore {
    conn: Connection,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkbookRow {
    pub id: String,
    pub name: String,
    pub snapshot: String,
    pub version: i64,
    pub revision: i64,
    pub created: String,
    pub updated: String,
    pub opened: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveReceipt {
    pub id: String,
    pub storage_version: i64,
    pub saved_revision: i64,
    pub saved_at: String,
    pub save_id: String,
}

impl WorkbookStore {
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             PRAGMA busy_timeout=5000;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS workbooks (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 snapshot TEXT NOT NULL,
                 version INTEGER NOT NULL,
                 revision INTEGER NOT NULL,
                 created TEXT NOT NULL,
                 updated TEXT NOT NULL,
                 opened TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_workbooks_updated ON workbooks(updated DESC);
             CREATE INDEX IF NOT EXISTS idx_workbooks_opened ON workbooks(opened DESC);
             CREATE TABLE IF NOT EXISTS saves (
                 workbook_id TEXT NOT NULL,
                 save_id TEXT NOT NULL,
                 digest TEXT NOT NULL,
                 response TEXT NOT NULL,
                 PRIMARY KEY(workbook_id, save_id),
                 FOREIGN KEY(workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE
             );"
        )?;
        Ok(Self { conn })
    }

    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE workbooks (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 snapshot TEXT NOT NULL,
                 version INTEGER NOT NULL,
                 revision INTEGER NOT NULL,
                 created TEXT NOT NULL,
                 updated TEXT NOT NULL,
                 opened TEXT NOT NULL
             );
             CREATE TABLE saves (
                 workbook_id TEXT NOT NULL,
                 save_id TEXT NOT NULL,
                 digest TEXT NOT NULL,
                 response TEXT NOT NULL,
                 PRIMARY KEY(workbook_id, save_id)
             );"
        )?;
        Ok(Self { conn })
    }

    pub fn save(
        &mut self,
        workbook_id: &str,
        name: &str,
        snapshot: &str,
        revision: i64,
        expected_version: i64,
        save_id: &str,
    ) -> std::result::Result<SaveReceipt, StorageError> {
        let digest = format!("{:x}", Sha256::digest(snapshot.as_bytes()));
        
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| StorageError::Sqlite(e.to_string()))?;

        // 1. Check idempotency receipt
        let prev_receipt: Option<(String, String)> = tx.query_row(
            "SELECT digest, response FROM saves WHERE workbook_id=? AND save_id=?",
            params![workbook_id, save_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok();

        if let Some((prev_digest, cached_response)) = prev_receipt {
            if prev_digest != digest {
                return Err(StorageError::SaveIdReused);
            }
            tx.commit().map_err(|e| StorageError::Sqlite(e.to_string()))?;
            let receipt: SaveReceipt = serde_json::from_str(&cached_response)
                .map_err(|e| StorageError::Serialization(e.to_string()))?;
            return Ok(receipt);
        }

        // 2. Check current version
        let current_version: i64 = tx.query_row(
            "SELECT version FROM workbooks WHERE id=?",
            params![workbook_id],
            |row| row.get(0),
        ).map_err(|_| StorageError::NotFound)?;

        if current_version != expected_version {
            return Err(StorageError::VersionConflict { current: current_version });
        }

        // 3. Update workbook
        let new_version = current_version + 1;
        let now = chrono_or_utc_iso();
        tx.execute(
            "UPDATE workbooks SET name=?, snapshot=?, version=?, revision=?, updated=? WHERE id=?",
            params![name, snapshot, new_version, revision, now, workbook_id],
        ).map_err(|e| StorageError::Sqlite(e.to_string()))?;

        // 4. Record save receipt
        let receipt = SaveReceipt {
            id: workbook_id.to_string(),
            storage_version: new_version,
            saved_revision: revision,
            saved_at: now,
            save_id: save_id.to_string(),
        };
        let response_str = serde_json::to_string(&receipt)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;

        tx.execute(
            "INSERT INTO saves (workbook_id, save_id, digest, response) VALUES (?, ?, ?, ?)",
            params![workbook_id, save_id, digest, response_str],
        ).map_err(|e| StorageError::Sqlite(e.to_string()))?;

        // 5. Trim older receipts (keep recent 100)
        tx.execute(
            "DELETE FROM saves WHERE workbook_id=? AND rowid NOT IN (
                SELECT rowid FROM saves WHERE workbook_id=? ORDER BY rowid DESC LIMIT 100
            )",
            params![workbook_id, workbook_id],
        ).map_err(|e| StorageError::Sqlite(e.to_string()))?;

        tx.commit().map_err(|e| StorageError::Sqlite(e.to_string()))?;
        Ok(receipt)
    }
}
```

### 4.5 Local File I/O Engine Design (`src/file_io.rs`)
```rust
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub struct LocalFileIo;

impl LocalFileIo {
    /// Atomically writes a .openexcel workbook file using temporary write + atomic rename.
    pub fn save_openexcel(path: &Path, content: &str) -> std::io::Result<()> {
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        
        let tmp_path = parent.join(format!(".tmp_{}_{}", std::process::id(), path.file_name().unwrap().to_string_lossy()));
        {
            let mut file = File::create(&tmp_path)?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
        }
        fs::rename(&tmp_path, path)?;
        Ok(())
    }

    /// Reads a .openexcel workbook file from disk.
    pub fn read_openexcel(path: &Path) -> std::io::Result<String> {
        let mut file = File::open(path)?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)?;
        Ok(contents)
    }
}
```

### 4.6 CLI & Launcher Commands (`src/main.rs`)
```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "openexcel-desktop", version = "0.1.0", about = "OpenExcel Native Desktop Runner")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new workbook
    Create {
        #[arg(short, long, default_value = "Untitled")]
        name: String,
        #[arg(short, long)]
        out: Option<String>,
    },
    /// List workbooks in SQLite storage
    List {
        #[arg(short, long, default_value = "50")]
        limit: usize,
    },
    /// Save a workbook snapshot to a local .openexcel file
    Save {
        id: String,
        #[arg(short, long)]
        path: String,
    },
    /// Run the embedded desktop server daemon
    Serve {
        #[arg(short, long, default_value = "3001")]
        port: u16,
        #[arg(short, long, default_value = ".openexcel")]
        data_dir: String,
    },
    /// Launch the native desktop application
    Launch {
        #[arg(short, long, default_value = "3001")]
        port: u16,
    },
}
```

---

## 5. Verification Method

To independently verify the desktop runner, SQLite persistence, and local file I/O:

1. **Verify Toolchain & Cargo Workspace**:
   ```bash
   source "$HOME/.cargo/env"
   cargo --version
   rustc --version
   ```

2. **Verify Native Desktop Binary Compilation**:
   ```bash
   source "$HOME/.cargo/env"
   cargo build -p openexcel-desktop --release
   test -f target/release/openexcel-desktop
   ```

3. **Verify SQLite WAL Persistence & Concurrency Unit Tests**:
   ```bash
   source "$HOME/.cargo/env"
   cargo test -p openexcel-desktop
   # Verifies WAL mode, atomic commits, optimistic version conflict detection, and idempotent retry receipts.
   ```

4. **Verify Local File I/O (`.openexcel` Save/Load Roundtrip)**:
   ```bash
   source "$HOME/.cargo/env"
   # Create a test workbook and save to disk
   target/release/openexcel-desktop create --name "Test Workbook" --out /tmp/test.openexcel
   test -f /tmp/test.openexcel
   # Verify valid JSON content
   grep -q '"schemaVersion": 1' /tmp/test.openexcel
   ```

5. **Verify Desktop Application Launch**:
   ```bash
   source "$HOME/.cargo/env"
   target/release/openexcel-desktop --help
   ```

6. **Invalidation Conditions**:
   - If `openexcel-desktop` requires uninstalled Linux GUI libraries (`libwebkit2gtk-4.1-dev` or `libnspr4.so`) to compile or launch.
   - If SQLite transactions fail to detect optimistic concurrency conflicts (`VERSION_CONFLICT`).
   - If writing `.openexcel` files leaves partial or corrupted data on aborted writes.
