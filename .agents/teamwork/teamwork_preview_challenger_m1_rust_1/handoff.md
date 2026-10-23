# Handoff Report: Adversarial Empirical Challenge of `crates/openexcel-core` (M1)

**Verdict**: **REJECT**

---

## 1. Observation

Adversarial empirical test suite written to `/workspaces/excellence-chart/crates/openexcel-core/tests/adversarial_tests.rs`.
Running the test suite:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test -p openexcel-core --test adversarial_tests
```
Execution results:
```
running 7 tests
test test_adversarial_pratt_parser_precedence ... ok
test test_adversarial_cycle_detection ... ok
test test_adversarial_spill_collision_with_authored ... FAILED
test test_adversarial_excel_1900_leap_year_quirk ... FAILED
test test_adversarial_spill_boundary_limits ... ok
test test_adversarial_spill_on_spill_collision ... ok

thread 'test_adversarial_deep_dependency_chain_1000' (63420) has overflowed its stack
fatal runtime error: stack overflow, aborting
error: test failed, to rerun pass `-p openexcel-core --test adversarial_tests`
Caused by:
  process didn't exit successfully: `/workspaces/excellence-chart/target/debug/deps/adversarial_tests-1ed118aaade111bd` (signal: 6, SIGABRT: process abort signal)
```

### Observation 1.1: Deep Dependency Chain Recursion Stack Overflow (Crash at ~270 cells)
- **File**: `crates/openexcel-core/src/engine.rs`, lines 400–449 (`recalculate`) and lines 83–156 (`read_cell` -> `eval_ast`).
- **Verbatim Error**:
  ```
  thread 'test_adversarial_deep_dependency_chain_1000' (63420) has overflowed its stack
  fatal runtime error: stack overflow, aborting
  Caused by:
    process didn't exit successfully: (signal: 6, SIGABRT: process abort signal)
  ```
- **Threshold Analysis**: Empirical testing of varying chain lengths (`A{i+1} = A{i} + 1`) determined:
  - Chain length 200: passes.
  - Chain length 250: passes.
  - Chain length 280: aborts with SIGABRT (stack overflow).
  - Chain length 1,000 (mandated by task): fatal stack overflow abort.
- **Root Cause in Code**:
  In `crates/openexcel-core/src/engine.rs`, `recalculate()` drains `self.dirty` (a `HashSet<CellAddress>` with non-deterministic iteration order) and naively invokes `reader.read_cell()`.
  When a cell references an unevaluated upstream cell, `eval_ast` recursively calls `reader.read_cell()`, which calls `eval_ast()`, recursing down the dependency chain on the OS call stack.
  Because each debug stack frame (`EngineGridReader`, `Evaluator`, `EngineRefCellDepCollector`, `AstNode`, closures) consumes ~7–8 KB, a chain depth exceeding ~270 frames exhausts the standard 2 MB test thread stack and triggers a process abort (`SIGABRT`).

### Observation 1.2: Dynamic Array Spill Child Shadowed by Stale Cache Entry
- **File**: `crates/openexcel-core/src/engine.rs`, lines 58–73 (`read_cell`), and `crates/openexcel-core/src/spill.rs`, lines 88–101 (`register_spill`).
- **Verbatim Failure**:
  ```
  thread 'test_adversarial_spill_collision_with_authored' (62545) panicked at crates/openexcel-core/tests/adversarial_tests.rs:275:5:
  assertion `left == right` failed: B2 should receive spilled value 5.0
    left: Null
   right: Number { value: 5.0 }
  ```
- **State Tracing**:
  1. Anchor A1 (`=SEQUENCE(3, 3, 1, 1)`) is blocked by authored value at B2 (`999.0`). A1 returns `#SPILL!`.
  2. The collision is cleared by setting B2 to `Cell::value(Scalar::Null)`.
  3. During `recalculate()`, B2 is read before A1. In `engine.rs` line 79, `CellInput::Value { value: Scalar::Null }` is cached into `self.computed` for B2 as `ComputedValue::Scalar(Scalar::Null)`.
  4. Anchor A1 is evaluated, `register_spill` registers B2 as a child of A1. However, `register_spill` does NOT clear `self.computed` for child addresses.
  5. When `get_computed_value(B2)` is called, `engine.rs` line 59 hits cache:
     ```rust
     if let Some(val) = self.computed.borrow().get(&addr) {
         return Ok(val.clone());
     }
     ```
     Returning `Scalar::Null` instead of falling through to line 64 (`get_anchor_for_child`).
  6. The worker's test in `tests/engine_tests.rs` (lines 141–143) only asserted `a1_recovered.is_array()`, completely failing to verify whether the spilled child cells (such as B2) returned their spilled values.

### Observation 1.3: Asymmetric Excel 1900 Leap Year Quirk (`DATE(1900, 2, 29)` returns 61.0)
- **File**: `crates/openexcel-core/src/functions/date_time.rs`, lines 44–61 (`ymd_to_serial`) and lines 81–90 (`date`).
- **Verbatim Failure**:
  ```
  thread 'test_adversarial_excel_1900_leap_year_quirk' (58047) panicked at crates/openexcel-core/tests/adversarial_tests.rs:378:5:
  assertion `left == right` failed: DATE(1900, 2, 29) must produce serial 60.0
    left: Number { value: 61.0 }
   right: Number { value: 60.0 }
  ```
- **Root Cause in Code**:
  In `crates/openexcel-core/src/functions/date_time.rs`:
  ```rust
  pub fn ymd_to_serial(mut year: i32, mut month: i32, day: i32) -> Result<f64, ErrorCode> {
      ...
      let start_of_month = NaiveDate::from_ymd_opt(year, month as u32, 1).ok_or(ErrorCode::Value)?;
      let target_date = start_of_month.checked_add_signed(Duration::days((day - 1) as i64)).ok_or(ErrorCode::Value)?;
      Ok(date_to_serial(target_date))
  }
  ```
  In Gregorian `chrono::NaiveDate`, year 1900 is NOT a leap year (February has 28 days).
  When `ymd_to_serial(1900, 2, 29)` adds 28 days to `1900-02-01`, `target_date` rolls over to `1900-03-01`.
  `date_to_serial(1900-03-01)` computes `diff = 61.0`, returning `61.0`.
  Consequently:
  - `DATE(1900, 2, 28) == 59.0`
  - `DATE(1900, 2, 29) == 61.0` (skips serial 60.0 entirely!)
  - `DATE(1900, 3, 1) == 61.0`
  Round-tripping fails: while `serial_to_ymd(60.0)` returns `(1900, 2, 29)`, `DATE(1900, 2, 29)` produces `61.0` (March 1, 1900).

### Observation 1.4: Passing Features
- Pratt Parser Precedence:
  - `-2^2 == 4.0` (unary minus tighter than caret) — PASSED.
  - `-(2^2) == -4.0` — PASSED.
  - `-2^3 == -8.0` — PASSED.
  - `2^3^2 == 512.0` (right-associative power) — PASSED.
  - `1+2*3 == 7.0` and `1*2+3 == 5.0` — PASSED.
  - `1:2+3` parses as `(Range 1:2) + 3` — PASSED.
  - Scientific notation (`1.5e-3`, `2.5E+3`, `1.5e-3 * 1000`) — PASSED.
  - Nested function calls (`SUM(ROUND(1.5e-3 * 1000, 0), MAX(1, 2, 3), IF(2>1, 10, 20)) == 15.0`) — PASSED.
- Cycle Detection:
  - Mutual circular references (`A1 = B1 + 1`, `B1 = A1 + 1` -> `#CIRC!`) — PASSED.
  - Multi-node cycles (`C1 -> D1 -> E1 -> C1` -> `#CIRC!`) — PASSED.
  - Self-references (`F1 = F1 * 2` -> `#CIRC!`) — PASSED.
  - Range self-reference (`H1 = SUM(H1:H5)` -> `#CIRC!`) — PASSED.
  - Cycle breaking by authored replacement — PASSED.
- Dynamic Array Boundaries and Spill-on-Spill:
  - Col XFD overflow returning `#SPILL!` — PASSED.
  - Row 1048575 overflow returning `#SPILL!` — PASSED.
  - Exact boundary fit at (1048574, 16382) filling grid to corner (1048575, 16383) — PASSED.
  - Overlapping dynamic array formulas returning `#SPILL!` — PASSED.
- Target Compilation:
  - `cargo check -p openexcel-core --target wasm32-unknown-unknown` compiles cleanly with zero warnings/errors.

---

## 2. Logic Chain

1. **Task & Requirement Mandate**:
   The orchestrator dispatch explicitly mandated testing:
   - "Deep dependency chains: 1,000+ sequential formula cells (`A{i} = A{i-1} + 1`)."
   - "Dynamic array spills: collisions with authored values, collision with another spill, spill boundary at `XFD` (col 16383) and row `1048575`."
   - "Excel 1900 leap year date quirk: serial day 60."
   And Milestone M4 requires sub-second recalculation across 100,000+ dependent cells.
2. **Crash in Production Path**:
   As observed in 1.1, the engine crashes with a hard SIGABRT process abort when evaluating a sequential dependency chain of only ~270 formula cells. In any real workbook containing 1,000+ or 100,000+ dependent cells, this architecture causes fatal application termination.
3. **Data Inconsistency in Dynamic Arrays**:
   As observed in 1.2, clearing a collision cell leaves a stale `Scalar::Null` in the computed cache. When users view the sheet or when `get_computed_values` is called by WASM / UI workers, the spilled cells return empty instead of their calculated numbers.
4. **Excel Compatibility Violation**:
   As observed in 1.3, `=DATE(1900, 2, 29)` returns `61.0`, breaking date calculations and failing round-trip compatibility with Microsoft Excel serial day 60.

---

## 3. Caveats

- **Scope Boundary**: As per the Challenger role constraint ("Review-only — do NOT modify implementation code"), no edits were made to `crates/openexcel-core/src/`. All tests were implemented exclusively in `crates/openexcel-core/tests/adversarial_tests.rs`.
- **Precedence & Cycle Robustness**: The Pratt parser operator precedence table, right-associative exponentiation, and DFS call-stack cycle detector (`#CIRC!`) are well-designed and robust against all tested adversarial inputs.

---

## 4. Conclusion

**Verdict: REJECT**

The worker's implementation cannot be approved for Milestone M1 in its current state. The core calculation engine suffers from 3 critical bugs:
1. **Fatal Stack Overflow**: Naive recursive evaluation in `read_cell()` crashes the process (`SIGABRT`) on dependency chains exceeding ~270 cells, directly violating the 1,000+ cell requirement and completely blocking the 100,000+ cell recalculation benchmark required for Milestone M4.
2. **Spill Value Masking**: Clearing an authored collision leaves a stale `Scalar::Null` in `computed` cache, preventing spilled child cells from returning their computed array elements.
3. **Broken Date Round-Trip**: `ymd_to_serial(1900, 2, 29)` evaluates to `61.0` instead of `60.0`, breaking `=DATE(1900, 2, 29)` Excel compatibility.

### Recommended Fixes for Worker:
1. **Iterative / Topological Recalculation**:
   In `engine.rs`, replace naive recursive evaluation with topological ordering. `DependencyGraph::get_downstream_worklist` or a Kahn's algorithm topological sort over dirty cells should be used so cells are evaluated strictly in dependency order iteratively, with a recursion depth limit or non-recursive evaluation loop.
2. **Clear Computed Cache on Spill Registration**:
   In `engine.rs` / `spill.rs`, when `register_spill` succeeds, ensure `self.computed.borrow_mut().remove(&child_addr)` is executed for all registered child addresses. In `read_cell`, check `spill_children` before returning a cached authored `Scalar::Null`.
3. **Special-Case Day 60 in `ymd_to_serial`**:
   In `functions/date_time.rs`, add an explicit branch:
   ```rust
   if year == 1900 && month == 2 && day == 29 {
       return Ok(60.0);
   }
   ```
   matching the existing inverse branch in `serial_to_ymd`.

---

## 5. Verification Method

To independently verify these findings:

1. **Run Full Adversarial Test Suite**:
   ```bash
   export PATH="$HOME/.cargo/bin:$PATH"
   cargo test -p openexcel-core --test adversarial_tests
   ```
   *Expected Outcome*: Demonstrates the failures:
   - `test_adversarial_deep_dependency_chain_1000` aborts with stack overflow (`SIGABRT`).
   - `test_adversarial_spill_collision_with_authored` fails with `Null != Number(5.0)`.
   - `test_adversarial_excel_1900_leap_year_quirk` fails with `61.0 != 60.0`.

2. **Verify Individual Isolated Bug Tests**:
   - Deep Chain Stack Overflow:
     ```bash
     cargo test -p openexcel-core --test adversarial_tests -- test_adversarial_deep_dependency_chain_1000 --nocapture
     ```
   - Spill Cache Invalidation:
     ```bash
     cargo test -p openexcel-core --test adversarial_tests -- test_adversarial_spill_collision_with_authored --nocapture
     ```
   - Date 60 Quirk:
     ```bash
     cargo test -p openexcel-core --test adversarial_tests -- test_adversarial_excel_1900_leap_year_quirk --nocapture
     ```

3. **Invalidation Condition**:
   These findings are invalidated only if `cargo test -p openexcel-core --test adversarial_tests` executes and passes all 7 tests with exit code `0`.
