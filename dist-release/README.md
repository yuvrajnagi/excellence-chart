# OpenExcel Release Distribution

This directory contains the self-contained, precompiled release bundle of OpenExcel, pairing the native Rust desktop binary with the optimized Web UI and WebAssembly calculation engine.

---

## Directory Contents

- **`bin/openexcel-desktop`**: 4.1 MB native release binary compiled with Rust 1.99.1, featuring embedded SQLite WAL storage and HTTP server daemon.
- **`web/`**: Production React 19 single-page application bundle with DOM-virtualized grid (1,048,576 rows × 16,384 columns), ribbon toolbar, and live SVG charts.
- **`run.sh`**: Single-command startup shell script.

---

## How to Run

Launch on default port `3001`:

```bash
./run.sh
```

Launch on a custom port and database path:

```bash
./run.sh 8080 my_custom_data.sqlite
```

Then open **`http://localhost:3001`** (or your specified port) in any modern web browser.
