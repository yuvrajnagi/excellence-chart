# Handoff Report: Review & Adversarial Evaluation of Rust Core Engine (Requirement R1)

**Reviewer**: teamwork_preview_reviewer_m1_rust_1  
**Working Directory**: `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_reviewer_m1_rust_1`  
**Verdict**: **REQUEST_CHANGES**  

---

## 1. Observation

### 1.1 Automated Verification Commands & Verbatim Results

1. **Cargo Test (`cargo test -p openexcel-core`)**:
   Command:
   ```bash
   export PATH="$HOME/.cargo/bin:$PATH" && cargo test -p openexcel-core
   ```
   Result: **EXIT CODE 101 (FAILED)**
   ```
   running 12 tests
   test coordinates::tests::test_coordinates_bijective ... ok
   test coordinates::tests::test_parse_and_format_address ... ok
   test coordinates::tests::test_parse_range ... ok
   test parser::tests::test_array_literal ... ok
   test graph::tests::test_graph_and_spatial_indexing ... ok
   test graph::tests::test_cycle_detection ... ok
   test parser::tests::test_postfix_percent ... ok
   test parser::tests::test_power_right_associative ... ok
   test parser::tests::test_operator_precedence ... ok
   test parser::tests::test_unary_minus_precedence ... ok
   test spill::tests::test_spill_registration_and_collision ... ok
   test parser::tests::test_lambda_application ... ok
   test result: ok. 12 passed; 0 failed

   Running tests/adversarial_function_tests.rs
   test result: ok. 6 passed; 0 failed

   Running tests/adversarial_tests.rs
   test test_adversarial_cycle_detection ... ok
   test test_adversarial_dynamic_array_spills ... FAILED
   test test_adversarial_excel_1900_leap_year_quirk ... FAILED
   test test_adversarial_pratt_parser_precedence ... ok
   test test_adversarial_deep_dependency_chain_1000 ... ok

   failures:

   ---- test_adversarial_dynamic_array_spills stdout ----
   thread 'test_adversarial_dynamic_array_spills' (58960) panicked at crates/openexcel-core/tests/adversarial_tests.rs:270:5:
   assertion `left == right` failed
     left: Null
    right: Number { value: 5.0 }

   ---- test_adversarial_excel_1900_leap_year_quirk stdout ----
   thread 'test_adversarial_excel_1900_leap_year_quirk' (58961) panicked at crates/openexcel-core/tests/adversarial_tests.rs:374:5:
   assertion `left == right` failed: DATE(1900, 2, 29) must produce serial 60.0
     left: Number { value: 61.0 }
    right: Number { value: 60.0 }
   ```

2. **Intermittent Call Stack Exhaustion on Deep Dependency Recalculation**:
   Command:
   ```bash
   export PATH="$HOME/.cargo/bin:$PATH" && cargo test -p openexcel-core --test adversarial_tests -- test_adversarial_deep_dependency_chain_1000
   ```
   Result: **EXIT CODE 101 (SIGABRT)**
   ```
   thread 'test_adversarial_deep_dependency_chain_1000' (57976) has overflowed its stack
   fatal runtime error: stack overflow, aborting
   Caused by: process didn't exit successfully (signal: 6, SIGABRT: process abort signal)
   ```
   Also observed intermittently in `tests/engine_tests.rs`:
   ```
   thread 'test_deep_dependency_recalculation' (57598) has overflowed its stack
   fatal runtime error: stack overflow, aborting
   ```

3. **Cargo Clippy (`cargo clippy -p openexcel-core --all-targets -- -D warnings`)**:
   Command:
   ```bash
   export PATH="$HOME/.cargo/bin:$PATH" && cargo clippy -p openexcel-core --all-targets -- -D warnings
   ```
   Result: **EXIT CODE 0 (PASSED)**. Finished with 0 warnings.

4. **WebAssembly Target Compilation (`cargo check -p openexcel-core --target wasm32-unknown-unknown`)**:
   Command:
   ```bash
   export PATH="$HOME/.cargo/bin:$PATH" && cargo check -p openexcel-core --target wasm32-unknown-unknown
   ```
   Result: **EXIT CODE 0 (PASSED)**. Successfully checks without platform-dependent errors.

5. **Existing TypeScript Suites (`npm test`)**:
   Command:
   ```bash
   npm test
   ```
   Result: **EXIT CODE 0 (PASSED)**. 12/12 test files passed, 423/423 tests passed.

---

### 1.2 Code Inspection Observations

1. **`crates/openexcel-core/src/functions/date_time.rs` (lines 8–61)**:
   - Line 8: `serial_to_date` has special casing for `(serial - 60.0).abs() < 1e-6`.
   - Line 23: `serial_to_ymd` returns `(1900, 2, 29)` when serial is `60.0`.
   - Lines 44–61: `ymd_to_serial(year, month, day)` has NO special handling for `(1900, 2, 29)`. It delegates to Chrono's `NaiveDate::from_ymd_opt(1900, 2, 1) + 28 days`. Because the Gregorian calendar does not have Feb 29 in 1900, Chrono rolls over to March 1, 1900. `date_to_serial(1900-03-01)` returns `61.0`. Consequently, `=DATE(1900, 2, 29)` evaluates to `61.0` rather than `60.0`.

2. **`crates/openexcel-core/src/engine.rs` (lines 63–73 and 272–309)**:
   - In `EngineGridReader::read_cell`:
     ```rust
     if let Some(anchor) = self.spills.borrow().get_anchor_for_child(&addr).cloned() {
         if let Some(ComputedValue::Array { rows, cols, values, .. }) = self.computed.borrow().get(&anchor) {
             let r = (row - anchor.row) as usize;
             let c = (col - anchor.col) as usize;
             if r < *rows && c < *cols {
                 let val = values[r * (*cols) + c].clone();
                 return Ok(ComputedValue::Scalar(val));
             }
         }
     }
     ```
     If `anchor` is not yet computed in `self.computed`, step 2 fails to match, and `read_cell` falls through to step 3 (checking authored cell in grid). When a collision is cleared by setting a cell to `Scalar::Null`, step 3 matches `CellInput::Value { value: Scalar::Null }`, caches `ComputedValue::Scalar(Scalar::Null)` into `self.computed`, and permanently shadows the spilled child element.
   - In `Engine::recalculate` (lines 406–425):
     ```rust
     let dirty_list: Vec<CellAddress> = self.dirty.drain().collect();
     for addr in &dirty_list {
         self.computed.borrow_mut().remove(addr);
     }
     for addr in dirty_list {
         match reader.read_cell(&addr.sheet_id, addr.row, addr.col) { ... }
     }
     ```
     `self.dirty` is an unordered `HashSet<CellAddress>`. Draining it yields a non-deterministic iteration order based on random SipHash keys. If a spill child is popped before its anchor, the child caches `Scalar::Null`. If a leaf of a deep dependency chain is popped before its root, `read_cell` traverses the entire ancestor chain recursively on the native thread stack.

3. **`crates/openexcel-core/src/engine.rs` (lines 84–118)**:
   - When evaluating a formula in `read_cell`, on-demand recursion calls `eval_ast`, which calls `read_cell`, which calls `eval_ast`. Every recursive step allocates stack frames on the native thread stack. For chains of >= 200–1,000 cells, this exhausts the OS stack and crashes with `SIGABRT` (stack overflow).

---

## 2. Logic Chain

1. **Acceptance Criteria Mandates Clean Test Suite**:
   Requirement R1 / Acceptance Criteria stipulates:
   *"cargo test executes and passes for all core data structures, formula parser, dependency graph, cycle detection, and formula library functions."*
   Currently, `cargo test -p openexcel-core` exits with code 101 and 2 test failures in `tests/adversarial_tests.rs`.
2. **Date Quirk Inconsistency**:
   Excel compatibility requires full round-trip preservation of the 1900 date system leap year quirk (day 60 = 1900-02-29). The engine supports serial-to-date conversion (`YEAR(60) == 1900`, `MONTH(60) == 2`, `DAY(60) == 29`), but lacks the inverse in `ymd_to_serial`. As a result, `=DATE(1900, 2, 29)` calculates to `61.0` instead of `60.0`.
3. **Spill Recovery Stale Cache Bug**:
   When an authored collision is removed via `set_cell(..., Cell::value(Scalar::Null))`, both the anchor and the cleared coordinate are marked dirty. Because recalculation order is non-deterministic, the child cell may be evaluated before the anchor. When this happens, `read_cell` does not force evaluation of the anchor; instead, it falls through to the grid store, caches `Null`, and permanently masks the newly unblocked spill result.
4. **Stack Overflow Vulnerability**:
   Evaluating dependent formulas through call stack recursion in `read_cell` without topological sorting or iterative worklists means that a chain of >= 200-1,000 cells can trigger an unrecoverable SIGABRT process abort. This directly compromises Milestone 4's requirement for 100,000+ dependent cell recalculation.
5. **Gate Decision**:
   Because test execution fails and critical bugs exist in date handling, spill recovery, and recursion safety, the gate verdict must be **REQUEST_CHANGES**.

---

## 3. Findings & Detailed Defect Reports

### Finding 1 [Critical]: `ymd_to_serial` fails to map `1900-02-29` to serial `60.0`
- **What**: `DATE(1900, 2, 29)` evaluates to `61.0` instead of `60.0`.
- **Where**: `crates/openexcel-core/src/functions/date_time.rs:44-61`.
- **Why**: Chrono's `NaiveDate` does not recognize 1900 as a leap year, so `1900-02-01 + 28 days` rolls over to March 1, 1900 (`diff = 61.0`).
- **Suggested Fix**: Add an explicit check in `ymd_to_serial`:
  ```rust
  if year == 1900 && month == 2 && day == 29 {
      return Ok(60.0);
  }
  ```

### Finding 2 [Critical]: Unblocked dynamic array spill child returns `Null` due to stale cache and unordered evaluation
- **What**: When a cell collision blocking a dynamic array spill is set to `Scalar::Null`, the anchor unblocks, but the child cell returns `Scalar::Null` instead of the spilled array element (`5.0`).
- **Where**: `crates/openexcel-core/src/engine.rs:64-74`, `src/engine.rs:280-305`, and `src/engine.rs:420-435`.
- **Why**:
  1. `EngineGridReader::read_cell` does not force evaluation of `anchor` if `anchor` is not yet present in `self.computed`. It falls through to the authored grid cell and caches `Scalar::Null`.
  2. `Engine::recalculate` drains `self.dirty: HashSet<CellAddress>` in arbitrary SipHash order, allowing the cleared child to be evaluated before the unblocked anchor.
- **Suggested Fix**:
  - In `read_cell`, if `addr` is registered in `spill_children`, ensure the anchor is evaluated first by calling `self.read_cell(&anchor.sheet_id, anchor.row, anchor.col)?` before checking if the anchor's computed array is available.
  - When an anchor successfully registers a spill, invalidate any cached entry in `self.computed` for the child addresses, or directly populate `self.computed` for each child address with its scalar slice.

### Finding 3 [Major]: Call stack overflow (`SIGABRT`) on deep dependency chains
- **What**: Dependency chains of length >= 200–1,000 cells exhaust the thread stack and crash the process with `fatal runtime error: stack overflow, aborting`.
- **Where**: `crates/openexcel-core/src/engine.rs:85-117` and `crates/openexcel-core/src/engine.rs:400-452`.
- **Why**: `EngineGridReader::read_cell` recurses on the native thread stack. Because `recalculate` iterates an unordered `HashSet`, it frequently evaluates the deepest leaf node first, forcing a full recursive traversal down to the root.
- **Suggested Fix**:
  - In `recalculate()`, sort dirty cells topologically using `graph.deps` / `graph.reverse_deps` from root dependencies to leaf dependents before evaluation. This guarantees that when a cell is evaluated, its dependencies are already present in `self.computed` (O(1) cache hit), reducing recursion depth to 1.
  - Alternatively, convert recursive formula evaluation to an iterative heap-based worklist / trampoline.

---

## 4. Integrity Violation Assessment

- **Hardcoded test outputs**: NONE DETECTED. All 88 functions use genuine mathematical algorithms, criteria wildcards, iterative solvers, and matrix transforms.
- **Dummy/Facade implementations**: NONE DETECTED. Full implementations exist across all 9 function modules, Pratt parser, and tiling store.
- **Task shortcuts / external tool delegation**: NONE DETECTED. Written cleanly in pure Rust using workspace dependencies.
- **Fabricated verification outputs**: NONE DETECTED.

---

## 5. Adversarial Stress-Test Summary

| Category | Stress Test Scenario | Result | Status |
|---|---|---|---|
| **Pratt Parser** | Right-associativity `2^3^2 == 512`, `-2^2 == 4`, scientific notation `1.5e-3` | Evaluates correctly | **PASS** |
| **Cycle Detection** | Mutual cycles (A1<->B1), 3-node cycles (C1->D1->E1->C1), self-cycles | Returns `#CIRC!` without hanging | **PASS** |
| **Grid Boundary Spills** | Spill overflow at row 1,048,575 and col XFD 16,383 | Returns `#SPILL!` | **PASS** |
| **Grid Boundary Exact Fit** | 2x2 SEQUENCE fitting exactly into (1048574, 16382) to (1048575, 16383) | Spills successfully without error | **PASS** |
| **Excel 1900 Quirk** | `YEAR(60)=1900`, `MONTH(60)=2`, `DAY(60)=29` | Evaluates correctly | **PASS** |
| **Excel 1900 Quirk** | `DATE(1900, 2, 29)` serial output | Evaluates to `61.0` (expected `60.0`) | **FAIL** |
| **Spill Collision Clearance** | Authored blocker cleared via `Scalar::Null` | Child reads `Null` instead of array slice | **FAIL** |
| **Deep Dependency Chain** | Sequential chain of 1,000 cells (`A{i+1} = A{i} + 1`) | Stack overflow abort (`SIGABRT`) | **FAIL** |

---

## 6. Caveats

- Clippy and WASM checks pass cleanly (`cargo clippy -- -D warnings` and `cargo check --target wasm32-unknown-unknown`).
- The crate architecture (types, Pratt parser, 128x32 tiling, 256-row spatial indexing, function registry) is well-structured and close to completion; resolving Findings 1, 2, and 3 will bring it into full compliance.

---

## 7. Conclusion

**Verdict: REQUEST_CHANGES**

Requirement R1 cannot be approved until:
1. `DATE(1900, 2, 29)` returns serial `60.0` in `ymd_to_serial`.
2. Dynamic array spill children correctly recover when collisions are replaced by `Scalar::Null`.
3. Recalculation is protected against native stack overflow on sequential formula chains.
4. `cargo test -p openexcel-core` exits with code 0 across all test suites.

---

## 8. Verification Method

To verify the required fixes once implemented:

```bash
export PATH="$HOME/.cargo/bin:$PATH"

# 1. Verify cargo test suite passes without failure or stack overflow
cargo test -p openexcel-core

# 2. Verify adversarial tests specifically pass
cargo test -p openexcel-core --test adversarial_tests

# 3. Verify clippy lints remain clean
cargo clippy -p openexcel-core --all-targets -- -D warnings

# 4. Verify WASM target compiles
cargo check -p openexcel-core --target wasm32-unknown-unknown
```
