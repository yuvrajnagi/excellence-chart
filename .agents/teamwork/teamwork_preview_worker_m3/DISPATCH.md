## 2026-10-23T07:38:14Z
You are the Worker for Milestone 3 (Data Tools, Integration & Quality Polish).
Your working directory is: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m3/

MANDATORY FIRST STEP:
Read /workspaces/excellence-chart/ORIGINAL_REQUEST.md and /workspaces/excellence-chart/PROJECT.md before doing any work.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

CONTEXT & INPUTS:
Thorough technical investigations were completed by 3 Explorers. Read their detailed handoff reports:
- /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_m3_1/handoff.md (UI Formatting & Controls)
- /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_m3_2/handoff.md (Data Tools & Algorithms Integration)
- /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_m3_3/handoff.md (Quality, Benchmarks & Interop)

ASSIGNED TASKS:
1. Strikethrough & Formatting Foundation:
   - `packages/model/src/types.ts`: Add `readonly strikethrough?: boolean;` to `CellStyle.font`.
   - `packages/model/src/schemas.ts`: Add `strikethrough: z.boolean().optional()` to `styleSchema.font`.
   - `packages/formatting/src/index.ts`: In `styleToCSS`, combine `underline` and `line-through` into `textDecoration: decorations.join(' ')`.
   - `packages/formatting/test/format.test.ts`: Add unit tests for strikethrough and combined underline + strikethrough.
   - `packages/interop/src/index.ts`: Map `c.font.strike` to/from `s.font.strikethrough` in XLSX import/export.

2. UI Controls & Table Insertion:
   - `apps/web/src/App.tsx`:
     - In Ribbon Home tab (line 120), implement Strikethrough toggle button (`<s>S</s>`).
     - Fix Italic and Underline buttons to toggle based on active cell style (`!activeStyle?.font?.italic`, `!activeStyle?.font?.underline`).
     - Add Left and Right alignment buttons (`style({horizontal: 'left'})`, `style({horizontal: 'right'})`).
     - Add All Borders button (`style({borders: ...})`).
     - Implement `insertTable()` handler: creates unique table name (`Table1`, etc.), extracts column names from top row of selection, generates a `TableDefinition`, populates missing header cells, and updates `sheet.properties.tables`.
     - Add `<button aria-label="Insert table" onClick={()=>run(insertTable)}>Table</button>` to `tab === 'Insert'` and `tab === 'Data'`.
     - In lines 33-35, fix AutoFilter hidden rows calculation so it runs if `sheet.properties.filter` OR `sheet.properties.tables.some(t => t.filter)`.
     - In `conditionalStyle` (line 107), support `minimum` and `maximum` threshold kinds by resolving them to min/max numbers across `rule.range`.
   - `apps/web/src/operations.ts`:
     - In `inputPatch`, support range-based list validation (`rule.source.kind === 'range'`) by reading values from `w` across the referenced range.

3. Data Algorithms & DrawingML Polish:
   - `packages/data/src/index.ts`: Refine `compare()` to use rank hierarchy (`number < string < boolean < error < null`) matching `packages/model/src/filters.ts`, preventing `[object Object]` stringification.
   - `packages/interop/src/charts.ts`: Polish DrawingML export for `combo` (compound bar + line in plotArea) and `histogram` (column barChart with bin labels) instead of skipping.
   - `packages/interop/test/interop.test.ts`: Add test verifying all 9 chart types in DrawingML export.

4. Challenge Workbook, Integration Tests & Benchmarks:
   - `samples/challenge.ts`: Add a valid `TableDefinition` to `sheet.properties.tables` on `Lookup Tables`.
   - `tests/integration/pipeline.test.ts`: Add integration tests for structured table references (`=SUM(Table1[Column1])`, `[@Column1]`), Goal Seek driving formula recalculation with `createEngine`, and table AutoFilter.
   - `benchmarks/run.ts`: Add XLSX export and parse time/memory measurement to benchmark suite.
   - Re-run `npm run samples` to update challenge workbook artifacts.
   - Re-run `npm run benchmark` to record complete benchmark results in `artifacts/benchmark.json`.

5. Verification Commands:
   - Run and ensure clean passes for:
     `npm run typecheck`
     `npm test`
     `npm run build`
     `npm run test:e2e`

6. Write your comprehensive handoff report to:
   `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m3/handoff.md`
   following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method).
7. Send a message to parent when complete.
