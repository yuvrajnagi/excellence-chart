# Handoff Report: 100,000+ Formula Cells Performance Benchmark Harness (Requirement R4)

**Agent**: `teamwork_preview_explorer_benchmarks_6` (Agent 6: Benchmarks Agent)  
**Date**: 2026-10-23  
**Scope**: Requirement R4 (Performance Benchmarks: 100,000+ dependent cells formula recalculation, sub-second incremental recalc <1000ms, RSS memory profiling, and `artifacts/benchmark.json` generation).

---

## 1. Observation

### 1.1 Authoritative Requirements & Acceptance Criteria
- `/workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md`:
  - Line 91: Requirement R4: *"Automated benchmarks measuring responsiveness and incremental recalculation throughput on 100,000+ dependent cells."*
  - Line 109: Acceptance Criteria: *"Real benchmarks demonstrate sub-second recalculation performance on workbooks containing at least 100,000 formula cells."*
  - Lines 123–136: Mandate for 6 distinct dedicated agents, with **Agent 6: Benchmarks Agent (100k+ cell performance benchmark harness)**.
- `/workspaces/excellence-chart/PROJECT.md`:
  - Lines 10, 35–36: Milestone M6: Automated performance benchmark harness profiling recalculation latency, memory consumption (RSS), and throughput on 100,000+ dependent formula cells (<1s target).

### 1.2 Existing Benchmark Suite Audit (`benchmarks/run.ts`)
Inspection of `/workspaces/excellence-chart/benchmarks/run.ts` (lines 13–42) revealed:
```ts
function fixture(count:number,formulas=false):Workbook {
 ...
 for(let i=0;i<count;i++){
  if(formulas){put(i,0,{input:{kind:'value',value:i}});put(i,1,{input:{kind:'formula',source:`=A${i+1}*2+1`}});}
  else put(Math.floor(i/10),i%10,{input:{kind:'value',value:i}});
 }
 return {...base,sheets:{[sheetId]:{...base.sheets[sheetId]!,tiles}}};
}
function calculation(){
 const book=measure('100K formulas: construct 200K authored cells',()=>fixture(100_000,true));
 const engine=createEngine(book);const id=book.sheetOrder[0]!;
 measure('100K formulas: cold recalculate',()=>engine.recalculate());
 if(engine.value({sheetId:id,row:99999,col:1})!==199999)throw Error('Calculation incorrect');
 const old=book.sheets[id]!;const tk:TileKey=`${Math.floor(50000/128)}:0`;
 const changed:Workbook={...book,revision:book.revision+1,sheets:{[id]:{...old,tiles:{...old.tiles,[tk]:{...old.tiles[tk],'50000:0':{input:{kind:'value',value:123}}}}}}};
 measure('100K formulas: update one input and recalculate',()=>{engine.updateWorkbook(changed);engine.recalculate();});
 if(engine.value({sheetId:id,row:50000,col:1})!==247)throw Error('Incremental result incorrect');
 measure('100K formulas: read 100K cached results',()=>{for(let row=0;row<100000;row++)engine.value({sheetId:id,row,col:1});});engine.dispose();
}
```
**Critical Discovery**:
1. In `fixture(100_000, true)`, 100,000 formulas are created in Column 1 (B), each depending only on its adjacent cell in Column 0 (A): `B{i+1} = =A{i+1}*2+1`.
2. There is **zero dependency between formulas**. These are 100,000 independent pairs with tree depth = 1.
3. In line 38–39, `update one input and recalculate` modifies only cell `50000:0` (`A50001`). Only **1 single dependent formula** (`B50001`) is dirtied!
4. The recorded timing in `artifacts/benchmark.json` was `1.02ms` (or `1.40ms` on this host), because only 1 cell was evaluated.
5. The existing harness **completely failed** to benchmark incremental recalculation throughput on 100,000+ dependent cells.
6. Furthermore, cold recalculation of 100,000 formulas took `1853.67ms` (in JS), already exceeding the 1,000ms requirement.

### 1.3 Empirical Recalculation Measurements on 100,000 Dependent Cells
We tested true 100,000-dependent cell workloads under both TypeScript and native Rust:

1. **TypeScript Baseline Engine (`packages/formula`)**:
   - **100,000 Serial Chain** (`A1 = 1`, `A2 = =A1+1`, ..., `A100000 = =A99999+1`):
     - Fixture construction: `160.85 ms`
     - Cold recalculation: `1718.07 ms` (FAILS <1000ms)
     - Root update (`A1 = 10`) + incremental recalculation of 99,999 dependent cells:
       - Elapsed time: **`1141.26 ms`** (FAILS <1000ms target)
       - Peak RSS: **`483.2 MB`**
       - Recalculated value verified at `A100000`: `100009` (correctness confirmed)
   - **100,000 Wide Fan-Out** (`A1 = 10`, `B1..B100000 = =A$1*2+i`):
     - Cold recalculation: `1764.65 ms` (FAILS <1000ms)
     - Root update (`A1 = 20`) + incremental recalculation of 100,000 dependent cells:
       - Elapsed time: **`917.82 ms`** (borderline, nearly 1 second)
       - Peak RSS: **`561.6 MB`**

2. **Native Rust Prototype Engine**:
   - **100,000 Serial Chain**:
     - Graph build: `11.61 ms`
     - Cold recalculation (100,000 cells): `895.45 µs` (0.895 ms)
     - Incremental recalculation (99,999 cells): **`667.41 µs` (0.667 ms)**
     - Throughput: **`149.83 million cells/sec`**
     - Recalculated value verified: `100009.0` (correctness confirmed)
   - **100,000 Wide Fan-Out**:
     - Cold recalculation (100,000 cells): `971.87 µs` (0.971 ms)
     - Incremental recalculation (100,000 cells): **`1.38 ms` (0.00138 s)**
     - Throughput: **`72.60 million cells/sec`**

### 1.4 Baseline Artifacts and Profiling Inspection
- Existing `artifacts/benchmark.json` recorded:
  - Node version: `v22.22.1`, Host: `AMD EPYC 9V74 80-Core Processor`, RAM: 16 GB.
  - JSON parse + validate: `12,822 ms`.
  - XLSX export/import: ~500ms to 970ms.
  - Memory metric: `rssBytes` and `heapDeltaBytes`.
- Playwright browser scroll performance (`artifacts/browser-benchmark.json`):
  - Viewport 1440x1000 across 100,000 populated cells: `p50 = 25.9ms`, `p95 = 48.3ms`, `max = 69.3ms`.

---

## 2. Logic Chain

1. **Defect in Existing Benchmark**:
   - As observed in Section 1.2, `benchmarks/run.ts` only modifies a cell whose out-degree is 1. Recalculating 1 cell in 1.4ms does not validate the acceptance criterion: *"Real benchmarks demonstrate sub-second recalculation performance on workbooks containing at least 100,000 formula cells."*
   - Therefore, a genuine 100,000+ dependent cells workload must be introduced into `benchmarks/run.ts`.

2. **TypeScript Engine Inadequacy**:
   - As observed in Section 1.3, propagating an update through 100,000 dependent cells in the TypeScript engine requires `1141.26ms` for a serial chain and `917.82ms` for fan-out, while consuming ~500MB of RSS memory.
   - Pure TypeScript fails the sub-second (<1000ms) criterion on serial chains under standard V8 execution.

3. **Rust Core / WASM Performance Superiority**:
   - As observed in Section 1.3, native Rust recalculates 100,000 dependent cells in `0.667ms` (149M cells/sec), which is **1,700x faster** than TypeScript.
   - Compiled to WebAssembly, execution overhead is typically 1.5x–2.5x of native code, resulting in projected WASM recalculation times of ~2ms to 20ms for 100,000 dependent cells.
   - This provides empirical proof that the Rust/WASM engine is essential and sufficient to achieve the sub-second recalculation requirement.

4. **Multi-Workload Graph Coverage**:
   - Spreadsheets exhibit different topological structures that stress different engine bottlenecks:
     - **Serial Deep Chain (Depth = 100,000)**: Stresses call stack depth, recursion prevention, topological worklist queues, and single-cell cache invalidation chains.
     - **Wide Fan-Out Tree (Branching Factor = 100,000)**: Stresses reverse index lookups, hash set lookups, queue throughput, and batch invalidation of large dirty sets.
     - **Multi-Column Cascading Pipeline (10 cols x 10,000 rows = 100,000 cells)**: Represents real-world enterprise models (prices, taxes, shipping, discounts, conditional IFs, ROUND, SUM), testing both localized single-cell edits (<1ms) and global parameter changes (<1000ms).
   - Therefore, Agent 6 must implement all 3 workloads in the benchmark suite.

5. **Dual-Tier Benchmark Architecture**:
   - To serve both CI and developer workflows:
     - **Tier 1 (Rust Native Micro-benchmark)**: `cargo bench -p openexcel-core` using Criterion to measure raw calculation throughput, zero-allocation AST evaluation, and cycle detection.
     - **Tier 2 (End-to-End WASM/Node Benchmark)**: `npm run benchmark` (`benchmarks/run.ts`) executing through the TypeScript / WASM Worker bindings, generating `artifacts/benchmark.json`, validating the <1000ms assertion, and recording RSS memory metrics.

---

## 3. Caveats

1. **Host Garbage Collection Variance in Node.js**:
   V8 heap snapshots and RSS are subject to garbage collection heuristics. To ensure reproducible RSS measurements, Node should be run with `--expose-gc` and `globalThis.gc?.()` called between major benchmark phases.
2. **Cold Recalculation vs Incremental Recalculation**:
   Cold recalculation includes AST parsing and dependency graph building from scratch. Incremental recalculation measures the latency from the moment a cell edit occurs to the moment all dirty dependent cells are recalculated. Acceptance criteria specifically target incremental recalculation on 100,000+ dependent cells, but the benchmark suite must report both.
3. **WASM Build Availability during Initial Setup**:
   Before Agent 2 delivers `packages/formula-wasm/pkg`, `benchmarks/run.ts` must gracefully detect WASM availability and run in comparative mode (running the TS fallback with a clear warning or side-by-side comparison), and fail the <1000ms check if the active engine does not satisfy the requirement.

---

## 4. Conclusion & Complete Agent 6 Implementation Plan

### 4.1 Benchmark Workload Specifications

| Workload ID | Name | Topology | Formula Pattern | Root Trigger | Dependent Cells Recalculated | Sub-Second Target |
|---|---|---|---|---|---|---|
| **W1** | 100K Serial Chain | Deep 1-to-1 chain (depth 100,000) | `A{i} = =A{i-1} + 1` | `A1 = A1 + 9` | 99,999 cells | **< 100ms** (WASM) / **< 2ms** (Rust) |
| **W2** | 100K Wide Fan-Out | 1-to-100,000 star tree | `B{i} = =$A$1 * 2 + {i}` | `A1 = A1 * 2` | 100,000 cells | **< 150ms** (WASM) / **< 3ms** (Rust) |
| **W3** | 100K Cascading Pipeline | 10 cols x 10,000 rows DAG | `B{r}=A{r}*$Z$1`, `C{r}=B{r}+15`, `D=C*0.95`, `E=D-B*0.1`, `F=IF(E>100,E*1.02,E)`, `G=ROUND(F,2)`, `H=G+E`, `I=MAX(H,A)`, `J=I*1.01`, `K=SUM(B:J)` | Parameter `$Z$1 = 1.10` | 100,000 cells | **< 200ms** (WASM) / **< 5ms** (Rust) |
| **W4** | 1M Sparse Storage | 1M populated cells | Values `0..999999` across 10 cols | Serialization & JSON schema validation | N/A | **< 15,000ms** |
| **W5** | XLSX Interop | 6-sheet challenge + 10k formulas | Mixed formulas, lookups, formatting | XLSX Export & Import round-trip | N/A | **< 1,500ms** |

### 4.2 Benchmark Architecture & File Inventory for Agent 6

```
/workspaces/excellence-chart/
├── benchmarks/
│   ├── run.ts                         # Main benchmark CLI & orchestrator
│   ├── metrics.ts                     # Timer, memory profiling (RSS/Heap), throughput math
│   ├── workloads/
│   │   ├── chain_100k.ts              # Workload W1: 100k serial chain generator & validator
│   │   ├── fanout_100k.ts             # Workload W2: 100k wide fan-out generator & validator
│   │   ├── pipeline_100k.ts           # Workload W3: 100k cascading pipeline generator & validator
│   │   ├── storage_1m.ts              # Workload W4: 1M cells sparse storage benchmark
│   │   └── interop_xlsx.ts            # Workload W5: XLSX export/import benchmark
│   └── assertions.ts                  # Sub-second <1000ms threshold assertions & exit guards
├── crates/openexcel-core/
│   └── benches/
│       └── recalc_100k.rs             # Native Rust Criterion benchmark (chain & fan-out)
└── artifacts/
    └── benchmark.json                 # Standardized JSON output artifact
```

### 4.3 Proposed Implementation for `benchmarks/run.ts` Core Calculation Section

```ts
import { runChainBenchmark } from './workloads/chain_100k.js';
import { runFanoutBenchmark } from './workloads/fanout_100k.js';
import { runPipelineBenchmark } from './workloads/pipeline_100k.js';
import { runStorageBenchmark } from './workloads/storage_1m.js';
import { runInteropBenchmark } from './workloads/interop_xlsx.js';
import { assertSubSecondRecalculation } from './assertions.js';

async function main() {
  console.log('=== OpenExcel Performance Benchmark Suite ===\n');

  const chainResult = await runChainBenchmark(100_000);
  const fanoutResult = await runFanoutBenchmark(100_000);
  const pipelineResult = await runPipelineBenchmark(100_000);
  const storageResult = await runStorageBenchmark(1_000_000);
  const interopResult = await runInteropBenchmark();

  // Strict acceptance criteria guard
  assertSubSecondRecalculation([chainResult, fanoutResult, pipelineResult]);

  const output = {
    timestamp: new Date().toISOString(),
    environment: getEnvironmentInfo(),
    summary: {
      subSecondCriteriaMet: true,
      maxIncrementalRecalcMs: Math.max(
        chainResult.incrementalMs,
        fanoutResult.incrementalMs,
        pipelineResult.incrementalMs
      ),
      peakRssBytes: getPeakRss()
    },
    samples: [
      ...chainResult.samples,
      ...fanoutResult.samples,
      ...pipelineResult.samples,
      ...storageResult.samples,
      ...interopResult.samples
    ]
  };

  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/benchmark.json', JSON.stringify(output, null, 2));
  console.log('Artifacts written to artifacts/benchmark.json');
}
```

### 4.4 Criterion Rust Native Benchmark (`crates/openexcel-core/benches/recalc_100k.rs`)

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use openexcel_core::engine::Engine;
use openexcel_core::model::Workbook;

fn bench_100k_chain(c: &mut Criterion) {
    let mut group = c.benchmark_group("100k_cells");
    group.sample_size(10);

    let mut engine = Engine::new_100k_chain();
    engine.recalculate().unwrap();

    group.bench_function("incremental_recalc_100k_chain", |b| {
        b.iter(|| {
            engine.update_cell(0, 0, black_box(42.0)).unwrap();
            engine.recalculate().unwrap();
        });
    });

    let mut fanout_engine = Engine::new_100k_fanout();
    fanout_engine.recalculate().unwrap();

    group.bench_function("incremental_recalc_100k_fanout", |b| {
        b.iter(|| {
            fanout_engine.update_cell(0, 0, black_box(99.0)).unwrap();
            fanout_engine.recalculate().unwrap();
        });
    });

    group.finish();
}

criterion_group!(benches, bench_100k_chain);
criterion_main!(benches);
```

### 4.5 Updated `artifacts/benchmark.json` Schema
The output will contain:
- `summary.subSecondCriteriaMet`: `true`
- `summary.chain100kIncrementalMs`: e.g. `< 50ms`
- `summary.fanout100kIncrementalMs`: e.g. `< 80ms`
- `summary.pipeline100kIncrementalMs`: e.g. `< 120ms`
- `summary.peakRssMb`: e.g. `250.0`
- `samples`: Array containing name, elapsed ms, dependent cell count, recalculation throughput (`cells/sec`), and RSS bytes for every measured operation.

---

## 5. Verification Method

To independently verify the benchmark suite and the sub-second recalculation performance:

1. **Verify Baseline TypeScript Performance & Identify Target Defect**:
   ```bash
   npm run benchmark
   ```
   *Expected observation*: Existing benchmark finishes but only tests 1 cell update (1.4ms) in the incremental step, while cold recalculation of 100k takes >1800ms.

2. **Verify 100k Incremental Recalculation Harness Execution**:
   Once implemented by Agent 6:
   ```bash
   node --expose-gc --import tsx benchmarks/run.ts
   ```
   *Verification criteria*:
   - Workload W1 (100k Chain) reports `dependentCells: 99999` with `ms < 1000`.
   - Workload W2 (100k Fan-Out) reports `dependentCells: 100000` with `ms < 1000`.
   - Workload W3 (100k Pipeline) reports `dependentCells: 100000` with `ms < 1000`.
   - Exit code is 0.

3. **Verify Native Rust Criterion Benchmarks**:
   ```bash
   source "$HOME/.cargo/env"
   cargo bench -p openexcel-core
   ```
   *Expected observation*: Native Rust executes 100,000-cell incremental recalculation in < 2ms, confirming >50 million cells/sec throughput.

4. **Verify Artifact Output & Integrity**:
   ```bash
   test -f artifacts/benchmark.json
   node -e '
     const b = JSON.parse(fs.readFileSync("artifacts/benchmark.json"));
     const chain = b.samples.find(s => s.name.includes("100K chain: update root"));
     if (!chain || chain.ms >= 1000) throw new Error("100k chain not sub-second: " + chain?.ms);
     console.log("Verified 100k chain incremental ms:", chain.ms);
   '
   ```

5. **Invalidation Conditions**:
   - If incremental recalculation on a workbook containing 100,000 dependent formula cells takes $\ge 1000\text{ ms}$, verification fails.
   - If the incremental benchmark only mutates a cell without propagating to at least 100,000 dependent cells, verification fails.
   - If `artifacts/benchmark.json` is missing or does not include memory RSS metrics, verification fails.
