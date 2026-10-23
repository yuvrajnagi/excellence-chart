# Survey 2 Handoff Report: Dual-Target Compilation (WebAssembly & Native Desktop)

**Agent**: `teamwork_preview_explorer_survey2_2`  
**Date**: 2026-10-23  
**Scope**: Requirement R2 (Dual-Target Compilation: WebAssembly and Native Desktop), Web Worker Non-Blocking Integration, and SQLite Persistence.

---

## 1. Observation

### 1.1 Environment Tooling Status
- **Rust Toolchain**:
  - `rustc --version` -> `rustc 1.99.1 (58cf8f9c3 2026-10-13)`
  - `cargo --version` -> `cargo 1.99.1 (5f94df478 2026-08-27)`
  - `rustup --version` -> `rustup 1.29.2 (d8c92c676 2026-10-21)`
  - `rustup target list | grep wasm32-unknown-unknown` -> `wasm32-unknown-unknown (installed)`
  - Env file: `$HOME/.cargo/env` provides Cargo binary directory in `PATH`.
- **WASM Packaging Tool**:
  - `wasm-pack --version` -> `wasm-pack 0.13.1` installed at `/home/vscode/.cargo/bin/wasm-pack`.
- **Node & NPM**:
  - `node --version` -> `v22.22.1`
  - `npm --version` -> `9.2.0`
- **Desktop / Tauri Tooling**:
  - `npx @tauri-apps/cli --version` -> `tauri-cli 2.12.4`
  - `npx @tauri-apps/cli info` output:
    ```
    [✔] rustc: 1.99.1 (58cf8f9c3 2026-10-13)
    [✔] cargo: 1.99.1 (5f94df478 2026-08-27)
    [✔] rustup: 1.29.2 (d8c92c676 2026-10-21)
    [✔] Rust toolchain: stable-x86_64-unknown-linux-gnu (default)
    - node: 22.22.1
    - npm: 9.2.0
    [-] Packages: @tauri-apps/cli js: 2.12.4
    [✘] webkit2gtk-4.1: not installed
    [✘] rsvg2: not installed
    ```
  - `apt-cache policy libwebkit2gtk-4.1-dev librsvg2-dev` confirmed package availability in Ubuntu repository:
    - `libwebkit2gtk-4.1-dev`: `2.52.6-0ubuntu0.26.04.1`
    - `librsvg2-dev`: `2.61.3+dfsg-3ubuntu0.1`

### 1.2 Web Worker & Bundler Configuration
- **`apps/web/vite.config.ts`**:
  - Line 34: `worker: { format: "es" }`
  - Vite dev server port: `5173`, proxying `/api` requests to `http://127.0.0.1:3001`.
- **`apps/web/src/App.tsx`**:
  - Line 80:
    ```ts
    const w = new Worker(new URL('./calculation.worker.ts', import.meta.url), { type: 'module' });
    ```
  - Line 81:
    ```ts
    worker.current?.postMessage({
      id: ++request.current,
      ...(sentWorkbook.current === workbook ? {} : { workbook }),
      addresses
    });
    ```
- **`apps/web/src/calculation.worker.ts`**:
  - Lines 4-8:
    ```ts
    self.onmessage = (event: MessageEvent<{id: number; workbook?: Workbook; addresses: CellAddress[]}>) => {
      const { id, workbook, addresses } = event.data;
      try {
        if (workbook) {
          if (engine) engine.updateWorkbook(workbook);
          else engine = createEngine(workbook);
          engine.recalculate();
        }
        self.postMessage({
          id,
          values: Object.fromEntries(addresses.map(at => [`${at.sheetId}/${at.row}:${at.col}`, engine?.value(at) ?? null]))
        });
      } catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
      }
    };
    ```

### 1.3 Persistence & Database Schema
- **`apps/server/src/storage.ts`**:
  - Lines 14-16:
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
      PRIMARY KEY(workbook_id,save_id)
    );
    ```
  - Lines 34-53: Atomic saves using `BEGIN IMMEDIATE`, SHA-256 snapshot hashing for idempotent retries, optimistic concurrency version checking (`current.storageVersion !== expected`), and version bumping.

### 1.4 Prototype Compilation Verification
- **WASM compilation verified via `wasm-pack build --target web`**:
  - Compiled Rust crate with `wasm-bindgen = "0.2"` to WebAssembly.
  - Emitted `test_wasm.d.ts` (type definitions), `test_wasm.js` (ES module loader with default `init`), and `test_wasm_bg.wasm`.
  - Executed inside Node.js module successfully: `add(10, 20): 30`, `calculate(50): 150`.
- **SQLite desktop persistence verified via `rusqlite`**:
  - Compiled and executed Rust unit test using `rusqlite = { version = "0.31", features = ["bundled"] }`.
  - Executed WAL mode, table creation, optimistic concurrency conflict detection (`VERSION_CONFLICT`), and idempotent save receipts in 0.00s (`test tests::test_desktop_sqlite_persistence ... ok`).

---

## 2. Logic Chain

1. **Target Compilation Feasibility**:
   - From 1.1, `rustc 1.99.1`, `cargo 1.99.1`, `wasm-pack 0.13.1`, and the `wasm32-unknown-unknown` target are installed and functional.
   - From 1.4, `wasm-pack build --target web` compiles Rust code with zero errors into ES modules and `.wasm` binaries.
   - Therefore, the Rust core can compile directly to `wasm32-unknown-unknown` with type-safe TypeScript declarations generated automatically.

2. **Web Worker Non-Blocking Recalculation**:
   - From 1.2, `apps/web/vite.config.ts` sets `worker: { format: "es" }`, and `App.tsx` instantiates the worker as an ES module (`new Worker(..., { type: 'module' })`).
   - From 1.4, `wasm-pack` with `--target web` outputs an ES module with `export default function __wbg_init()`.
   - In `calculation.worker.ts`, importing the WASM module and awaiting `init()` runs entirely within the dedicated Web Worker thread.
   - Recalculation of 100,000 cells occurs inside the worker thread. As results finish, the worker posts a structured message containing the computed values for visible viewport addresses.
   - Because calculation and WASM execution happen strictly off the UI thread, the React UI, virtualized scroll listener, and DOM renderer remain uninterrupted at 60 FPS without main-thread blocking.

3. **Native Desktop Target Architecture & Headless Reliability**:
   - Requirement R2 mandates compiling natively as a desktop application with local file and SQLite persistence.
   - Acceptance criteria require: "The native desktop application compiles and launches successfully, allowing local workbook creation, editing, and file saving."
   - From 1.1, `npx @tauri-apps/cli` is v2.12.4. In Linux desktop environments, Tauri uses WebKitGTK (`libwebkit2gtk-4.1-dev`), whereas in headless server/CI environments, display servers are not present.
   - From 1.4, `rusqlite` with `features = ["bundled"]` compiles the complete SQLite engine into the native binary without requiring system SQLite packages.
   - Therefore, `crates/openexcel-desktop` should be architected as a native application that provides:
     1. A native CLI/headless mode (`openexcel-desktop --headless` or `cargo run -p openexcel-desktop -- ...`) capable of creating workbooks, importing/exporting files, and executing SQLite persistence headless in CI.
     2. A Tauri desktop shell embedding the built web assets (`apps/web/dist`) with native windowing and menus when a display is present.
     3. An exhaustive test suite (`cargo test -p openexcel-desktop`) verifying local SQLite persistence, optimistic locking, and local file I/O independent of display servers.

---

## 3. Caveats

1. **Linux WebKitGTK Dependency for Tauri GUI**: Running the full graphical Tauri window on Linux requires `libwebkit2gtk-4.1-dev` and `librsvg2-dev` (and an X11/Wayland display server or `xvfb-run`). In headless CI containers, testing the desktop target must support headless execution flags and `cargo test -p openexcel-desktop`.
2. **Serialization Overhead at WASM Boundary**: Passing very large JSON trees between JS and WASM on every keystroke can incur serialization cost. The Rust WASM engine should accept incremental delta patches or maintain workbook state internally across turns (as the existing TypeScript engine in `packages/formula` does with `updateWorkbook`), only returning the visible viewport addresses requested by the UI.
3. **Environment Shell Sourcing**: Terminal commands invoking `cargo` or `wasm-pack` require `. "$HOME/.cargo/env"` or `PATH="$HOME/.cargo/bin:$PATH"` in the subshell if running non-login interactive shells.

---

## 4. Conclusion & Architectural Specification

### 4.1 Cargo Workspace Layout
Place all Rust components in a top-level Cargo workspace:
```
/workspaces/excellence-chart/
├── Cargo.toml                       # Workspace manifest
├── crates/
│   ├── openexcel-core/              # Pure Rust spreadsheet engine (no-wasm, no-os-specific deps)
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── grid.rs              # SparseMatrix / tile cell storage
│   │   │   ├── parser.rs            # Pratt formula parser & AST
│   │   │   ├── graph.rs             # Dependency graph, DFS cycle detection (#CIRC!)
│   │   │   ├── spill.rs             # Dynamic array spill evaluation (#SPILL!)
│   │   │   ├── functions/           # Complete 88 Excel functions
│   │   │   └── engine.rs            # Core Engine struct
│   │   └── tests/                   # Native cargo test suites for all 88 functions
│   ├── openexcel-wasm/              # WebAssembly bindings layer
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs               # #[wasm_bindgen] WasmEngine, batch evaluator
│   │       └── types.rs             # Serde JSON bridging structures
│   └── openexcel-desktop/           # Native Desktop binary and SQLite persistence
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs              # Dual-mode desktop entry (Tauri GUI / headless CLI)
│           ├── storage.rs           # rusqlite WAL persistence matching apps/server
│           └── lib.rs
└── packages/
    └── formula-wasm/                # Generated TypeScript/WASM package for Web Worker
        ├── package.json
        └── pkg/                     # wasm-pack build output (.wasm, .js, .d.ts)
```

### 4.2 Workspace `Cargo.toml`
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

[profile.wasm-release]
inherits = "release"
opt-level = "s"
lto = true
```

### 4.3 `crates/openexcel-wasm/Cargo.toml`
```toml
[package]
name = "openexcel-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
openexcel-core = { path = "../openexcel-core" }
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde-wasm-bindgen = "0.6"
console_error_panic_hook = "0.1"
```

### 4.4 `crates/openexcel-desktop/Cargo.toml`
```toml
[package]
name = "openexcel-desktop"
version = "0.1.0"
edition = "2021"

[dependencies]
openexcel-core = { path = "../openexcel-core" }
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
sha2 = "0.10"
dirs = "5.0"
```

### 4.5 WASM Engine API Design (`crates/openexcel-wasm/src/lib.rs`)
```rust
use wasm_bindgen::prelude::*;
use openexcel_core::Engine;

#[wasm_bindgen]
pub struct WasmEngine {
    engine: Engine,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(workbook_json: &str) -> Result<WasmEngine, JsValue> {
        console_error_panic_hook::set_once();
        let engine = Engine::from_json(workbook_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(WasmEngine { engine })
    }

    #[wasm_bindgen(js_name = updateWorkbook)]
    pub fn update_workbook(&mut self, workbook_json: &str) -> Result<(), JsValue> {
        self.engine.update_from_json(workbook_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn recalculate(&mut self) -> Result<(), JsValue> {
        self.engine.recalculate()
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Evaluates requested viewport addresses in batch and returns JSON: Record<string, ComputedValue>
    #[wasm_bindgen(js_name = evaluateAddresses)]
    pub fn evaluate_addresses(&self, addresses_json: &str) -> Result<String, JsValue> {
        self.engine.evaluate_addresses_json(addresses_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
```

### 4.6 Web Worker Implementation (`apps/web/src/calculation.worker.ts`)
```ts
import initWasm, { WasmEngine } from '@openexcel/formula-wasm';
import type { Workbook, CellAddress, ComputedValue } from '@openexcel/model';

let wasmInitPromise: Promise<unknown> | null = null;
let engine: WasmEngine | undefined;

function ensureWasm(): Promise<unknown> {
  if (!wasmInitPromise) {
    wasmInitPromise = initWasm();
  }
  return wasmInitPromise;
}

self.onmessage = async (event: MessageEvent<{
  id: number;
  workbook?: Workbook;
  addresses: CellAddress[];
}>) => {
  const { id, workbook, addresses } = event.data;
  try {
    await ensureWasm();
    if (workbook) {
      const json = JSON.stringify(workbook);
      if (engine) {
        engine.updateWorkbook(json);
      } else {
        engine = new WasmEngine(json);
      }
      engine.recalculate();
    }
    
    if (!engine) {
      self.postMessage({ id, values: {} });
      return;
    }

    const jsonResult = engine.evaluateAddresses(JSON.stringify(addresses));
    const values = JSON.parse(jsonResult) as Record<string, ComputedValue>;
    self.postMessage({ id, values });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
```

### 4.7 Build Commands Summary
| Target | Command | Output Artifact |
|---|---|---|
| **Core Unit Tests** | `cargo test -p openexcel-core` | Evaluates all 88 functions & cycle detection natively |
| **WASM Build** | `wasm-pack build crates/openexcel-wasm --target web --out-dir ../../packages/formula-wasm/pkg` | `openexcel_wasm.js`, `openexcel_wasm_bg.wasm`, `.d.ts` |
| **Desktop Tests** | `cargo test -p openexcel-desktop` | Validates SQLite WAL schema, versioning, and file saving |
| **Desktop Build** | `cargo build -p openexcel-desktop --release` | Native desktop binary `target/release/openexcel-desktop` |
| **Web Build** | `npm run build` | Bundles React UI + ES module calculation worker |

---

## 5. Verification Method

To independently verify the tooling, compilation, bindings, and persistence:

1. **Verify Tooling Chain**:
   ```bash
   source "$HOME/.cargo/env"
   cargo --version
   rustc --version
   rustup target list | grep "wasm32-unknown-unknown (installed)"
   wasm-pack --version
   node --version
   npm --version
   ```

2. **Verify WASM Compilation & Bindings**:
   ```bash
   source "$HOME/.cargo/env"
   wasm-pack build crates/openexcel-wasm --target web --out-dir ../../packages/formula-wasm/pkg
   test -f packages/formula-wasm/pkg/openexcel_wasm.js
   test -f packages/formula-wasm/pkg/openexcel_wasm_bg.wasm
   test -f packages/formula-wasm/pkg/openexcel_wasm.d.ts
   ```

3. **Verify Web Worker Integration**:
   ```bash
   npm run build
   # Verify vite builds apps/web/dist with calculation.worker bundle referencing wasm
   ```

4. **Verify Native Desktop SQLite Persistence**:
   ```bash
   source "$HOME/.cargo/env"
   cargo test -p openexcel-desktop
   # Executes in-memory SQLite WAL verification, optimistic concurrency tests, and save receipts
   ```

5. **Verify Native Desktop Binary Execution**:
   ```bash
   source "$HOME/.cargo/env"
   cargo run -p openexcel-desktop -- --help
   ```

6. **Invalidation Conditions**:
   - If `wasm-pack` fails to generate `.d.ts` TypeScript types.
   - If worker recalculation causes UI scroll frame drops >16.6ms (blocking main thread).
   - If `openexcel-desktop` cannot create or persist workbooks in SQLite.
