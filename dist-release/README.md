# OpenExcel Release Distribution

[![Release](https://img.shields.io/badge/bundle-dist--release-blue.svg)](file:///workspaces/excellence-chart/dist-release)
[![Binary](https://img.shields.io/badge/binary-openexcel--desktop%20(4.1MB)-orange.svg)](file:///workspaces/excellence-chart/dist-release/bin)
[![UI](https://img.shields.io/badge/UI-React%2019%20%2B%20WASM-61DAFB.svg)](file:///workspaces/excellence-chart/dist-release/web)

A self-contained, precompiled release distribution of OpenExcel. It packages the native Rust desktop daemon, the production React 19 single-page application, and the WebAssembly calculation engine into a single runnable bundle requiring zero installation of Node.js or Rust tooling.

---

## Directory Contents

```text
dist-release/
├── README.md               # This documentation guide
├── run.sh                  # Single-command startup launcher script
├── bin/
│   └── openexcel-desktop   # 4.1MB native release binary (Linux x86_64)
└── web/                    # Production Web UI static bundle
    ├── index.html          # Application entry point
    └── assets/             # Bundled JS, CSS, and Web Worker assets
```

---

## How to Run

### 1. Default Startup
Launch OpenExcel on the default port `3001`:

```bash
./dist-release/run.sh
```

Open **`http://localhost:3001`** (or `http://127.0.0.1:3001`) in your browser.

### 2. Custom Port and Database Location
Pass an optional port number and SQLite database file path:

```bash
# Listen on port 8080 with a custom database file
./dist-release/run.sh 8080 /path/to/my_data.sqlite
```

---

## Runtime Behavior

When `run.sh` executes:
1. **Desktop Daemon Initialized**: The native `openexcel-desktop` server starts and binds to the specified port.
2. **SQLite WAL Persistence**: Opens (or creates) the SQLite database file in Write-Ahead Logging (`WAL`) mode with full fsync synchronization (`synchronous = FULL`).
3. **Embedded Static Server**: Serves production Web UI assets directly from `dist-release/web/`.
4. **WASM Calculation Engine**: As spreadsheets are opened and edited in the browser, formula recalculations run in a dedicated Web Worker powered by the WebAssembly calculation module.
5. **Optimistic Versioning**: All saves and auto-persists use HTTP `If-Match` ETags, guarding against multi-tab overwrites.

---

## Smoke Testing the Release Build

To verify that the release bundle is working properly:

```bash
# 1. Start the server in the background
./dist-release/run.sh 3999 &
SERVER_PID=$!

# Wait 1 second for startup
sleep 1

# 2. Check health endpoint
curl -s http://127.0.0.1:3999/api/health | grep '"status":"ok"'

# 3. List workbooks
curl -s http://127.0.0.1:3999/api/workbooks

# 4. Terminate background server
kill $SERVER_PID
```
