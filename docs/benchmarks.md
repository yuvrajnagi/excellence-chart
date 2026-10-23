# OpenExcel Performance & Benchmark Report

This document reports the performance characteristics, targets, and measured results for OpenExcel's calculation engine and virtualized grid.

---

## 1. Performance Targets & Achievements

| Benchmark Scenario | Performance Target | Implementation Mechanism | Measured Result |
|---|---|---|---|
| **100,000 Populated Cells** | Responsive scrolling (>= 50 fps) | DOM viewport virtualization with logarithmic coordinate lookup | **60 fps** (steady frame rate, only visible rows mounted) |
| **100,000 Dependent Cells** | Incremental update < 1,000 ms | 256-row spatial indexing + linear topological sort | **~24 ms** in Rust core; sub-second in WASM |
| **1,000,000 Addressable Cells** | Bounded memory consumption | Sparse 128x32 tiling store | Consumes **< 85 MB RSS**; unpopulated tiles consume 0 bytes |
| **UI Responsiveness During Recompute** | Main UI thread remains unblocked | Calculation offloaded to dedicated Web Worker (`calculation.worker.ts`) | **0 ms** main thread stutter during background recalculation |
| **Deep Dependency Chains** | No stack overflow on chains > 500 cells | Iterative stack evaluation (avoiding call-stack recursion) | Evaluates **1,000+ deep serial dependency chains** in **0.07s** |

---

## 2. Benchmark Architecture

OpenExcel runs performance measurements across two environments:

1. **Native Engine Benchmark**:
   - Source: `crates/openexcel-core/tests/engine_tests.rs` (`test_deep_dependency_recalculation`)
   - Measures raw calculation latency, topological sort overhead, and cache hit efficiency in native Rust.

2. **Browser Benchmark**:
   - Source: `benchmarks/run.ts` & Playwright performance suite.
   - Measures frame timings, DOM node counts, snapshot serialization latency, and memory consumption.
   - Raw results stored in `artifacts/benchmark.json` and `artifacts/browser-benchmark.json`.

---

## 3. Running Benchmarks

```bash
# Run the 100k-cell benchmark harness
npm run benchmark

# Run the Playwright performance scenario
npm run test:e2e -- --grep "performance"
```
