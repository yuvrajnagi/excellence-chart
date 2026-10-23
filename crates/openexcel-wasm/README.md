# `openexcel-wasm`

WebAssembly bindings for the OpenExcel Rust calculation engine, powered by `wasm-bindgen` and optimized with `wasm-opt`.

---

## Capabilities

- **Direct Wasm Engine**: Exposes `WasmEngine` class to JavaScript and TypeScript with zero-copy where feasible.
- **Non-Blocking Web Worker Bridge**: Allows offloading all formula evaluations, dependency updates, and spills to a background Web Worker without blocking the main browser UI thread.
- **Type-Safe Definitions**: Generates `.d.ts` declarations and ESM bundle for direct consumption in modern web packagers (Vite, Webpack, Rollup).
- **Console Panic Hook**: Includes `console_error_panic_hook` for detailed Rust stack traces in the browser developer console.

---

## Build Commands

Compile WebAssembly package to `packages/formula-wasm`:

```bash
# Debug build
wasm-pack build crates/openexcel-wasm --target web --out-dir ../../packages/formula-wasm

# Optimized production release (with wasm-opt)
wasm-pack build crates/openexcel-wasm --target web --release --out-dir ../../packages/formula-wasm
```

---

## TypeScript Usage

```typescript
import init, { WasmEngine } from 'packages/formula-wasm';

await init();

const engine = new WasmEngine();
engine.updateWorkbook(JSON.stringify(workbookData));
const recalcStats = engine.recalculate();
const valuesJson = engine.getComputedValues(JSON.stringify([
  { sheetId: "Sheet1", row: 0, col: 0 }
]));
const values = JSON.parse(valuesJson);
```
