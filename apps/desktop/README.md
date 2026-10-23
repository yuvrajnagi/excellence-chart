# `apps/desktop` — OpenExcel Desktop Shell Packaging

Packaging configuration for bundling OpenExcel as a native desktop application using Tauri v2.

---

## Configuration

- **`tauri.conf.json`**: Desktop shell manifest specifying window dimensions, application metadata, security permissions, and IPC endpoints.
- **Embedded Web View**: Renders the React virtualized spreadsheet interface.
- **Rust Backend**: Directly links to `crates/openexcel-core` and `crates/openexcel-desktop` for native file I/O and SQLite persistence.

---

## Build

```bash
# Package with Tauri CLI
npx @tauri-apps/cli build
```
