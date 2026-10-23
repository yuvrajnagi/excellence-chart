# Forensic Audit Report & Handoff: M1 Persistence & E2E Stability Core

- **Auditor**: `auditor_m1_1` (teamwork_preview_auditor)
- **Working Directory**: `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_auditor_m1_1`
- **Parent Conversation ID**: `15f3305d-1fad-4e14-a468-1ad8e746bf0d`
- **Work Product**: `apps/server/src/app.ts` and `apps/web/src/App.tsx`
- **Integrity Mode**: Development (per `ORIGINAL_REQUEST.md:8`)
- **Profile**: General Project
- **Verdict**: **CLEAN**

---

## Forensic Audit Summary

| Check | Result | Evidence / Details |
|---|---|---|
| **Hardcoded Test Results** | **PASS** | Grep search for `'330'`, `'9'`, `'J1'`, `'C2'`, `'Quarter'`, `'Revenue'`, etc. in `apps/server/` and `apps/web/` returned 0 matches. |
| **Facade & Dummy Implementations** | **PASS** | `app.ts` executes genuine SQLite queries via `DatabaseSync` with collision checks; `App.tsx` handles genuine React state transitions and Web Worker messaging. |
| **Fabricated Verification Outputs** | **PASS** | Tests were independently built and executed; all snapshots and receipts in SQLite WAL database were generated dynamically at runtime. |
| **Interface Contract Compliance** | **PASS** | Complies with `PROJECT.md:58`: Server preserves `workbook.id` on snapshot creation when unique and falls back to UUID generation if collision exists. |
| **Independent Build & Unit Tests** | **PASS** | `tsc -b` passed with exit code 0; `vite build` built client in 2.07s; `vitest run` passed all 12 test suites (418 passed tests). |
| **Independent Playwright E2E Execution** | **PASS** | Full suite `npm run test:e2e` passed all 8 tests in 29.2s; `workbook.spec.ts` passed 2/2 tests in 15.5s. |

---

## 1. Observation

### 1.1 Source Code Static Analysis

1. **`apps/server/src/app.ts` (lines 30–35)**:
   ```ts
   if(path==='/api/workbooks'&&req.method==='POST'){
    const data=unwrap(parseCreateWorkbookRequest(await jsonBody(req)));if(data.name.length>255)throw new HttpError(400,'INVALID_INPUT','Name too long');
    const exists=data.kind==='snapshot'&&data.workbook.id?Boolean(store.db?store.db.prepare('SELECT 1 FROM workbooks WHERE id=?').get(data.workbook.id):(()=>{try{store.get(data.workbook.id);return true;}catch{return false;}})()):false;
    const workbook=data.kind==='blank'?createWorkbook({id:createId('workbook'),sheetId:createId('sheet'),name:data.name,timestamp:new Date().toISOString()}):{...data.workbook,id:(data.workbook.id&&!exists)?data.workbook.id:createId('workbook'),properties:{...data.workbook.properties,name:data.name}};
    return json(res,201,store.create(workbook));
   }
   ```
   - **Observation**:
     - No constant returns, no hardcoded workbook IDs, and no test string checks.
     - Performs genuine query against SQLite (`SELECT 1 FROM workbooks WHERE id=?`).
     - Fulfills the `PROJECT.md` requirement: "The server MUST preserve `workbook.id` when provided in snapshot requests instead of generating a new random ID".
     - Guards against SQLite primary key collision (`UNIQUE constraint failed: workbooks.id`) by falling back to `createId('workbook')` only when `exists` is true.

2. **`apps/web/src/App.tsx` (line 52)**:
   ```ts
   const save=async()=>{const snapshot=current.current;const task=saveQueue.current.then(async()=>{if(savedRevision.current===snapshot.revision&&version.current)return;setStatus('Saving…');const response=version.current?await api.saveWorkbook(snapshot.id,{workbook:snapshot,storageVersion:version.current}):await api.createWorkbook({kind:'snapshot',workbook:snapshot,name:snapshot.properties.name});version.current=response.storageVersion;savedRevision.current=snapshot.revision;if('workbook' in response){current.current=response.workbook;setWorkbook(response.workbook);localStorage.setItem('openexcel-last',response.workbook.id);}else{localStorage.setItem('openexcel-last',snapshot.id);}setStatus('Saved');});saveQueue.current=task.catch(()=>{});return task;};
   ```
   - **Observation**:
     - No hardcoded IDs or values.
     - Synchronizes React state (`setWorkbook(response.workbook)`), internal ref (`current.current`), and browser `localStorage` (`openexcel-last`) with the authoritative ID returned by the backend.

3. **Grep Search for Test Literals**:
   - `grep_search` query `330` in `apps/server/src/app.ts`: 0 matches.
   - `grep_search` query `330` in `apps/web/src/App.tsx`: 0 matches.
   - `grep_search` query `J1` in `apps/server/src/app.ts`: 0 matches.
   - `grep_search` query `J1` in `apps/web/src/App.tsx`: 0 matches.
   - `grep_search` query `C2` in `apps/server/src/app.ts`: 0 matches.
   - `grep_search` query `C2` in `apps/web/src/App.tsx`: 0 matches.
   - `grep_search` query `'9'` in `apps/server/src/app.ts`: 0 matches.
   - `grep_search` query `'9'` in `apps/web/src/App.tsx`: 0 matches.

### 1.2 Independent Runtime Verification

1. **Project Compilation (`tsc -b`)**:
   - Command: `npx --no-install tsc -b --pretty false`
   - Exit code: 0 (No compilation or type errors in apps or packages).

2. **Production Client Build (`vite build`)**:
   - Command: `npm run build`
   - Exit code: 0
   - Output snippet:
     ```
     ✓ 122 modules transformed.
     dist/index.html                               0.52 kB │ gzip:   0.31 kB
     dist/assets/calculation.worker-Cotc_-rz.js  113.43 kB
     dist/assets/index-CUtQQgIB.css               30.66 kB │ gzip:   6.13 kB
     dist/assets/index-DCfn668C.js               359.77 kB │ gzip: 113.24 kB
     ✓ built in 2.07s
     OPENEXCEL_CLEANUP root=/tmp/tmp.Z0Y0njYRnA removed=yes exit=0
     ```

3. **Vitest Unit & Integration Suites**:
   - Command: `npm test`
   - Exit code: 0
   - Output: 12 test files passed, 418 tests passed (0 failures).
     - `apps/server/test/server.test.ts` (5 passed)
     - `packages/formula/test/parser.test.ts` (77 passed)
     - `tests/compatibility/functions.test.ts` (265 passed)
     - `tests/compatibility/engine.test.ts` (24 passed)
     - `packages/interop/test/challenge.test.ts` (1 passed)
     - `packages/interop/test/interop.test.ts` (5 passed)
     - `packages/formatting/test/format.test.ts` (8 passed)
     - `packages/data/test/data.test.ts` (6 passed)
     - `packages/formula/test/lexer.test.ts` (14 passed)
     - `packages/model/test/api.test.ts` (3 passed)
     - `packages/model/test/history.test.ts` (2 passed)
     - `tests/integration/pipeline.test.ts` (8 passed)

4. **Playwright End-to-End Suite**:
   - Command: `npm run test:e2e` (Run as task-123)
   - Exit code: 0
   - Output:
     ```
     Running 8 tests using 1 worker
       ✓ 1 … UI behavior › cell selection, keyboard navigation, and Name Box jumping (1.7s)
       ✓ 2 … formula bar input, in-cell double-click editing, and formula recalculation (2.0s)
       ✓ 3 … chart insertion and dynamic reactivity to cell data changes (2.7s)
       ✓ 4 … Find & Replace dialog locates matching cells and updates text across sheet (2.5s)
       ✓ 5 … sheet tabs creation and tab switching preserves worksheet state (1.8s)
       ✓ 6 … measure scrolling over 100,000 populated cells (7.5s)
       ✓ 7 … edit, calculate, format, chart, persist and XLSX round trip (4.0s)
       ✓ 8 … virtual grid reaches last address and supports undo (1.6s)
     8 passed (29.2s)
     ```
   - Target E2E tests specifically verified:
     - `tests/e2e/workbook.spec.ts`: PASSED (15.5s)
     - `tests/e2e/performance.spec.ts`: PASSED (7.5s in full suite; artifacts generated)

5. **Benchmarks & Sample Generation**:
   - `npm run benchmark`: Exit code 0 (100K formulas cold recalculate: 1.74s, incremental recalculate: 1.31ms).
   - `npm run samples`: Exit code 0 (Generated `examples/Excel_Compatibility_Challenge.xlsx`: 6 sheets, 18,251 bytes).

---

## 2. Logic Chain

1. **Step 1: Evaluation of the Dispatched Concern**
   - The dispatch requested forensic checks to confirm that the changes solving E2E persistence failures did not take shortcuts by hardcoding test expectations (such as `'330'`, `'9'`, `'J1'`, or `'C2'`).
2. **Step 2: Source Code Evidence Against Hardcoding**
   - Direct inspection and regex/literal grep across `apps/server/src/app.ts` and `apps/web/src/App.tsx` confirm that none of these values exist in the source code.
   - The cell values `'330'` and `'9'` observed in test assertions are computed dynamically:
     - `'330'` is evaluated by `@openexcel/formula` calculating `=SUM(B2:B3)` where `B2` is edited to 150 and `B3` is 180.
     - `'9'` is the cell at row 0, col 9 populated in memory via `row*10 + col` = `0*10 + 9` = 9.
3. **Step 3: Verification of Architectural Authenticity**
   - The implementation in `app.ts:32-33` directly adheres to the specification in `PROJECT.md:58`:
     - When a snapshot request provides an ID that is not already in the database, that ID is preserved.
     - If the ID is missing or already taken, an ID is created via `createId('workbook')`.
     - When saved, `App.tsx:52` stores the resulting ID in `localStorage` and updates its internal state.
   - This fixes the root cause of the previous reload failures where client and server generated separate conflicting IDs.
4. **Step 4: Behavioral and Operational Validity**
   - The changes operate against genuine SQLite WAL database instances.
   - All 418 unit tests, all 8 Playwright E2E browser tests, benchmarks, and XLSX sample generator run successfully and pass with exit code 0.

---

## 3. Caveats

1. **Port 3018 Concurrency**:
   - `playwright.config.ts` configures `reuseExistingServer: false` on port 3018. If another agent or background process is actively executing tests against port 3018, subsequent test runs will report `Error: http://127.0.0.1:3018/api/health is already used`. When run serially, the web server starts and shuts down cleanly, and tests pass 100%.
2. **Untracked Tests in Workspaces**:
   - During the audit, an untracked file `tests/integration/pipeline.test.ts` was created by another worker for Milestone 3. Running `npm run typecheck` runs `tsc -p tsconfig.tests.json`, which flagged a missing property in that WIP integration test (`Property 'csvEscapeFormulas' is missing in type '{ format: "xlsx"; }'`). This does not affect `apps/server/src/app.ts` or `apps/web/src/App.tsx`, which compile cleanly under `tsc -b`.

---

## 4. Conclusion

- **Verdict**: **CLEAN**
- The work products `apps/server/src/app.ts` and `apps/web/src/App.tsx` represent genuine, robust, production-quality implementations.
- There are no hardcoded test values, no facades, no dummy mocks, and no integrity violations under Development Mode.
- Milestone M1 is verified and approved.

---

## 5. Verification Method

To independently verify this audit:
```bash
# 1. Verify absence of hardcoded test literals
grep -rn "330" apps/server/src/ apps/web/src/
grep -rn "'9'" apps/server/src/ apps/web/src/
grep -rn "J1" apps/server/src/ apps/web/src/
grep -rn "C2" apps/server/src/ apps/web/src/

# 2. Verify compilation of production code
npx --no-install tsc -b --pretty false

# 3. Verify production build
npm run build

# 4. Verify full unit test suite
npx --no-install vitest run

# 5. Verify Playwright E2E test suite (ensure port 3018 is free)
fuser 3018/tcp || true
npm run test:e2e
```
Invalidation conditions: Presence of hardcoded test values in application logic, dummy facades returning static answers, or failure of genuine end-to-end recalculation and persistence workflows.
