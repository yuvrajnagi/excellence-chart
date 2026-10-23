## 2026-10-23T20:19:20Z
You are teamwork_preview_worker_m2_desktop (Agent 3: Desktop Shell & Persistence Worker).
Your working directory is: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m2_desktop

MANDATORY FIRST STEP:
Read the authoritative user request at:
/workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md
Specifically study the latest request timestamped 2026-10-23T19:00:46Z, Requirement R2: Dual-Target Compilation: Native Desktop and Acceptance Criteria (line 104: "The native desktop application compiles and launches successfully, allowing local workbook creation, editing, and file saving").

Also read:
- /workspaces/excellence-chart/PROJECT.md
- /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_desktop_3/handoff.md
- /workspaces/excellence-chart/crates/openexcel-core

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE BOUNDARIES:
You exclusively own:
- /workspaces/excellence-chart/crates/openexcel-desktop/**
- /workspaces/excellence-chart/apps/desktop/**

TASK OBJECTIVE:
Implement the native Desktop application and SQLite persistence in `crates/openexcel-desktop`:
1. `Cargo.toml`: binary crate depending on `openexcel-core = { path = "../openexcel-core" }`, `rusqlite = { version = "0.31", features = ["bundled"] }`, `serde`, `serde_json`, `clap = { version = "4", features = ["derive"] }`, `tiny_http = "0.12"`, `chrono = "0.4"`, `sha2 = "0.10"`.
2. Implement SQLite persistence in `src/storage.rs`:
   - SQLite WAL mode: `PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;`.
   - Table `workbooks(id TEXT PRIMARY KEY, name TEXT NOT NULL, snapshot TEXT NOT NULL, version INTEGER NOT NULL, revision INTEGER NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, opened TEXT NOT NULL)`.
   - Table `saves(workbook_id TEXT NOT NULL, save_id TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(workbook_id, save_id))`.
   - `BEGIN IMMEDIATE` transactions.
   - Optimistic concurrency control returning `VERSION_CONFLICT` when storage versions do not match.
   - Idempotent retries using SHA-256 digest caching bounded to 100 recent receipts.
3. Implement Local File I/O in `src/file_io.rs`:
   - Atomic saving of native `.openexcel` JSON workbooks via tempfile + `std::fs::rename`.
   - Loading `.openexcel` files from disk into `Workbook`.
4. Implement CLI commands and daemon in `src/main.rs`:
   - `create`: creates a new blank workbook in SQLite or as a file.
   - `save`: saves a workbook snapshot to disk or SQLite.
   - `list`: lists workbooks in SQLite.
   - `serve`: embedded local daemon serving HTTP persistence API (`/api/workbooks`).
5. Configure `apps/desktop/tauri.conf.json` for Tauri v2 native desktop bundle packaging.
6. Verify with `cargo test -p openexcel-desktop` testing SQLite WAL, optimistic concurrency, and local file saving. Run CLI commands to verify they launch and succeed without errors.
7. Deliver a structured handoff report to:
   /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m2_desktop/handoff.md
   Follow Handoff Protocol. Notify orchestrator via send_message when done.
