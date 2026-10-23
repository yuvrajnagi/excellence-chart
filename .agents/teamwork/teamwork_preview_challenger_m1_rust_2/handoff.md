# Handoff Report: Empirical Adversarial Verification of `crates/openexcel-core` Function Library

**Reviewer**: `teamwork_preview_challenger_m1_rust_2` (Empirical Challenger)  
**Target**: `crates/openexcel-core`  
**Milestone**: M1 (Rust Core Calculation Engine)  
**Verdict**: **REJECT** (Pending resolution of functional defects in LAMBDA invocation/recursion, NPV division by zero, and date leap-year serial computation)

---

## Challenge Summary

- **Overall Risk Assessment**: **MEDIUM-HIGH**
- **Process Stability**: **EXCELLENT** — Zero panics, zero aborts, zero memory corruptions, zero infinite loops observed across 100+ adversarial expressions.
- **Function Correctness**: **MIXED** — Excellent arithmetic and statistical fidelity (MOD across all 4 sign quadrants, all 22 SUBTOTAL codes 1..11 & 101..111, dynamic arrays FILTER/SORTBY/UNIQUE/SEQUENCE, PMT/IRR, and SWITCH/CHOOSE). However, 3 functional defects and 1 test suite failure were empirically reproduced.

---

## 1. Observation

Direct empirical observations from test executions and source inspection:

### 1.1 Test Suite Status
Running `cargo test -p openexcel-core` executes test binaries in `crates/openexcel-core/tests/`:
```bash
cargo test -p openexcel-core
```
Output:
- Unit tests (`src/lib.rs`): `12 passed; 0 failed`
- Engine tests (`tests/engine_tests.rs`): `8 passed; 0 failed`
- Function tests (`tests/function_tests.rs`): `4 passed; 0 failed`
- Adversarial function tests (`tests/adversarial_function_tests.rs`): `6 passed; 0 failed`
- Adversarial tests (`tests/adversarial_tests.rs`): `6 passed; 1 failed`
  ```
  failures:
  ---- test_adversarial_excel_1900_leap_year_quirk stdout ----
  thread 'test_adversarial_excel_1900_leap_year_quirk' panicked at crates/openexcel-core/tests/adversarial_tests.rs:390:5:
  assertion `left == right` failed: DATE(1900, 2, 29) must produce serial 60.0
    left: Number { value: 61.0 }
   right: Number { value: 60.0 }
  ```
Because `adversarial_tests.rs` fails on `test_adversarial_excel_1900_leap_year_quirk`, `cargo test -p openexcel-core` exits with code `101`.

---

### 1.2 Finding 1: Inability to Invoke LAMBDA by Name or Recursively
In `crates/openexcel-core/src/evaluator.rs`:
1. Line 381:
   ```rust
   let upper = name.to_uppercase();
   // 1. Validate declared arity
   self.registry.validate_arity(&upper, args.len())?;
   ```
   `self.registry` only contains the 88 hardcoded standard Excel functions (`crates/openexcel-core/src/functions/mod.rs` line 39). When an expression calls a user-defined function name (e.g. `FACTORIAL(5)` or a variable bound in `LET(f, LAMBDA(x, x+1), f(5))`), `validate_arity` immediately returns `Err(ErrorCode::Name)` (`#NAME?`). It does not look up local environment variables (`env`) or workbook defined names (`reader.get_defined_name()`).
2. Line 698 (`eval_apply`):
   ```rust
   if let AstNode::FunctionCall { name, args: lambda_args } = callee {
       if name.eq_ignore_ascii_case("LAMBDA") {
           ...
       }
   }
   self.lambda_depth -= 1;
   Err(ErrorCode::Value)
   ```
   `eval_apply` requires `callee` to syntactically match `AstNode::FunctionCall { name: "LAMBDA", .. }`. If `callee` is `AstNode::NameRef` (e.g. `(fact)(5)`) or nested `AstNode::Apply` (e.g. `LAMBDA(x, LAMBDA(y, x+y))(2)(3)`), it immediately returns `Err(ErrorCode::Value)` (`#VALUE!`).
3. Line 589:
   ```rust
   if upper == "LAMBDA" {
       // A bare LAMBDA without application is #CALC!
       return Err(ErrorCode::Calc);
   }
   ```
   A `LAMBDA` expression cannot be evaluated into a first-class closure value; any attempt to evaluate it outside an immediate invocation yields `ErrorCode::Calc`.

**Empirical Verification**:
- Formula `=LET(f, LAMBDA(x, x + 1), f(5))` evaluates to `Scalar(Error { code: Name, message: None })`.
- Formula `=LAMBDA(x, LAMBDA(y, x + y))(2)(3)` evaluates to `Scalar(Error { code: Value, message: None })`.
- Formula `=LET(fact, LAMBDA(self, n, IF(n <= 1, 1, n * self(self, n - 1))), fact(fact, 5))` evaluates to `Scalar(Error { code: Name, message: None })`.
- Workbook DefinedName `FACTORIAL = LAMBDA(n, IF(n<=1, 1, n*FACTORIAL(n-1)))` called as `=FACTORIAL(5)` evaluates to `Scalar(Error { code: Name, message: None })`.

---

### 1.3 Finding 2: `NPV` Rate = -1 Returns `inf` Instead of `#DIV/0!`
In `crates/openexcel-core/src/functions/financial.rs` lines 104–110:
```rust
for arg in &args[1..] {
    for s in arg.flat_scalars() {
        if let Scalar::Number { value } = s {
            total += value / (1.0 + rate).powi(period);
            period += 1;
        }
    }
}
Ok(ComputedValue::number(total))
```
When `rate = -1.0`, `1.0 + rate` is `0.0`. `value / 0.0` yields `f64::INFINITY`.
**Empirical Verification**:
- Formula `=NPV(-1, 100)` evaluates to `Scalar(Number { value: inf })`.
- Excel expectation: Division by zero in financial formulas must return `ErrorCode::Div0` (`#DIV/0!`). Returning IEEE-754 `inf` bypasses the Excel error handling model.

---

### 1.4 Finding 3: `TEXT` Function Ignores Thousands Grouping Commas
In `crates/openexcel-core/src/functions/text.rs` lines 340–361:
The number formatting branch counts decimal places and checks for `$` and `%`, but does not parse comma grouping separators `#,##0.00`.
**Empirical Verification**:
- Formula `=TEXT(1234567.89, "#,##0.00")` evaluates to `Scalar(String { value: "1234567.89" })`.
- Expected Excel output: `"1,234,567.89"`.

---

### 1.5 Positive Verification: Functions Operating Completely Correctly
The following requested areas were verified to behave strictly according to Excel specifications:

1. **Math Functions**:
   - `SUM`:
     - Empty range `=SUM(Z1:Z10)` -> `0.0`
     - Ignores strings and booleans in cell ranges: `=SUM(A1:B3)` -> `60.0`
     - Propagates errors: `=SUM(1, 2, 1/0)` -> `#DIV/0!`
     - Handles 2D array literals: `=SUM({1, 2; 3, 4})` -> `10.0`
   - `AVERAGEIF`:
     - Exact match: `=AVERAGEIF(B1:B5, "Apple", A1:A5)` -> `20.0`
     - Wildcard matches: `=AVERAGEIF(B1:B5, "*nana*", A1:A5)` -> `35.0`
     - Inequality criteria: `=AVERAGEIF(A1:A5, ">25")` -> `40.0`
     - Zero matching cells: `=AVERAGEIF(B1:B5, "Grape", A1:A5)` -> `#DIV/0!`
   - `SUBTOTAL`:
     - Verified all 22 subtotal codes:
       - Code 1 & 101 (AVERAGE) -> `20.0`
       - Code 2 & 102 (COUNT) -> `3.0`
       - Code 3 & 103 (COUNTA) -> `3.0`
       - Code 4 & 104 (MAX) -> `30.0`
       - Code 5 & 105 (MIN) -> `10.0`
       - Code 6 & 106 (PRODUCT) -> `6000.0`
       - Code 7 & 107 (STDEV.S) -> `10.0`
       - Code 8 & 108 (STDEV.P) -> `8.1649658...`
       - Code 9 & 109 (SUM) -> `60.0`
       - Code 10 & 110 (VAR.S) -> `100.0`
       - Code 11 & 111 (VAR.P) -> `66.666666...`
     - Invalid codes (0, 12, 100, 112, -1, 9.5) correctly reject with `#VALUE!`.
   - `MOD`:
     - Excel definition `MOD(n, d) = n - d * INT(n / d)` correctly implemented across all quadrants:
       - `MOD(3, 2)` -> `1.0`
       - `MOD(-3, 2)` -> `1.0`
       - `MOD(3, -2)` -> `-1.0`
       - `MOD(-3, -2)` -> `-1.0`
       - `MOD(-7, 3)` -> `2.0`
       - `MOD(7, -3)` -> `-2.0`
       - `MOD(-7, -3)` -> `-1.0`
       - `MOD(-5.5, 2)` -> `0.5`
       - `MOD(5.5, -2)` -> `-0.5`
       - `MOD(5, 0)` -> `#DIV/0!`
2. **Logical Functions**:
   - `IF`:
     - 2D condition broadcasting: `=IF({TRUE, FALSE; FALSE, TRUE}, 10, 20)` -> 2x2 matrix `{10, 20; 20, 10}`.
     - Condition with array branches: `=IF({TRUE, FALSE; FALSE, TRUE}, {1, 2; 3, 4}, {10, 20; 30, 40})` -> `{1, 20; 30, 4}`.
     - Element-wise error in condition: `=IF({TRUE, #DIV/0!}, 1, 2)` -> `{1, #DIV/0!}`.
     - Dimension mismatch: `=IF({TRUE, FALSE}, {1; 2; 3}, 0)` -> `#VALUE!`.
   - `SWITCH`:
     - Value matching, case-insensitive string matching (`SWITCH("apple", "Apple", 1, 2)` -> `1`).
     - Default argument fallback and `#N/A` error when unmatched without default.
     - Short-circuit evaluation: `=SWITCH(1, 1, 42, 2, 1/0, 1/0)` -> `42.0` (unselected branches containing division by zero are never evaluated).
   - `CHOOSE`:
     - Truncation of fractional indices (`CHOOSE(2.9, ...)` -> branch 2).
     - Out of bounds (`<1` or `>count`) returns `#VALUE!`.
     - Short-circuit evaluation: `=CHOOSE(2, 1/0, 99, 1/0)` -> `99.0`.
3. **Dynamic Array Functions**:
   - `FILTER`:
     - Matching rows return slice.
     - Empty result returns `#CALC!`.
     - Empty result with 3rd argument returns fallback value.
     - Include length mismatch returns `#VALUE!`.
     - Error cell in include array propagates `#DIV/0!`.
   - `SORTBY`:
     - Multi-key sorting: primary asc, secondary desc correctly orders ties.
     - Invalid order argument (not 1 or -1) returns `#VALUE!`.
     - Length mismatch returns `#VALUE!`.
   - `UNIQUE`:
     - Row deduplication and column deduplication (`by_col = TRUE`).
     - `exactly_once = TRUE` isolates values occurring exactly once.
     - No unique values under `exactly_once` returns `#CALC!`.
   - `SEQUENCE`:
     - Generates 2D array with start and step.
     - Dimensions `<= 0` or non-integer return `#CALC!`.
4. **Financial Functions**:
   - `IRR`:
     - 1-period cash flows `{-100; 110}` converges to `0.10000`.
     - 4-period cash flows `{-1000; 300; 400; 400; 300}` converges to `0.14895` (~14.895%).
     - All positive or all negative flows return `#NUM!`.
     - Newton-Raphson bound checks and derivative checks prevent infinite loops or panics.
   - `PMT`:
     - Standard loan amortization `=PMT(0.05/12, 360, 200000)` -> `-1073.64`.
     - Rate = 0 -> linear amortization.
     - Periods = 0 -> `#DIV/0!`.
     - Beginning-of-period type = 1 -> `-1069.19`.
5. **Text Functions**:
   - `TEXT`: Correctly formats decimals, currency prefix `$`, percentage suffix `%`, and ISO dates (`45292` -> `"2024-01-01"`).
   - `TEXTJOIN`: Joins strings, skips blanks when `ignore_empty = TRUE`, preserves blanks when `FALSE`, propagates `#DIV/0!`.
   - `SUBSTITUTE`: Substitutes all occurrences or 1-based instance number (e.g. instance 1, 2, 3), leaves string unchanged if instance exceeds match count, returns `#VALUE!` if instance `< 1`.

---

## 2. Logic Chain

1. **Requirement Check**:
   The authoritative user request (2026-10-23T19:00:46Z, Requirement R1) mandates an Excel-compatible formula calculation engine implementing all standard functions with full acceptance criteria, specifically including `cargo test` passing for all test targets and correct calculation of functions.
2. **Dispatch Focus**:
   The orchestrator dispatch specifically tasked Challenger 2 with empirical adversarial verification of:
   - `LET` with nested variables and `LAMBDA` recursive application.
   - Financial functions (`NPV`, `IRR`, `PMT`).
   - Text functions (`TEXT` format string behavior).
3. **Empirical Reproduction of Failure 1**:
   Observation 1.2 demonstrates that `LAMBDA` cannot be invoked by name (from `LET` or workbook defined names) or applied recursively. In all recursive scenarios, evaluation terminates prematurely with `#NAME?` or `#VALUE!`. The parser and evaluator lack closure representation in `ComputedValue` and fail to check local environments or defined names before arity validation in `eval_function_call`.
4. **Empirical Reproduction of Failure 2**:
   Observation 1.3 shows that `=NPV(-1, 100)` produces `inf` instead of `#DIV/0!`. In a spreadsheet engine, returning unhandled IEEE infinity violates the Excel scalar type contract.
5. **Empirical Reproduction of Test Suite Failure**:
   Observation 1.1 confirms that running the full test suite via `cargo test -p openexcel-core` fails on `test_adversarial_excel_1900_leap_year_quirk` with exit code `101`.
6. **Verdict Deduction**:
   Because test targets fail and explicitly requested capabilities (`LAMBDA` recursion and Excel error handling in `NPV`) return incorrect values, Requirement R1 cannot be approved in its current state. The appropriate and honest engineering verdict is **REJECT**.

---

## 3. Caveats

1. **Non-Crashing Stability**:
   None of the defects discovered cause a crash, panic, memory fault, or infinite loop. The process remains responsive and memory-safe under all adversarial inputs.
2. **Immediate Invocation Works**:
   Single-stage immediately invoked lambdas (`LAMBDA(x, x+1)(2)`) work properly. The defect is specifically isolated to indirect invocation, currying, and recursion.
3. **Math and Dynamic Arrays Are Solid**:
   The math engine (including complex SUBTOTAL codes, negative MOD quadrants) and dynamic array operations (FILTER, SORTBY, UNIQUE, SEQUENCE) are implemented with high fidelity.

---

## 4. Conclusion

**Verdict: REJECT.**

The worker has built an impressive foundation with zero panics, robust AST evaluation, correct Pratt precedence, and accurate dynamic arrays. However, the crate cannot pass verification due to:
1. `cargo test -p openexcel-core` failing on `test_adversarial_excel_1900_leap_year_quirk` (DATE serial day 60 computation).
2. `LAMBDA` recursive application and named invocation failing with `#NAME?` / `#VALUE!`.
3. `NPV(-1, ...)` returning `inf` instead of `#DIV/0!`.
4. `TEXT` format string ignoring thousands grouping commas (`#,##0.00`).

### Actionable Remediation for Worker:
1. In `crates/openexcel-core/src/functions/date_time.rs` (`ymd_to_serial`):
   Explicitly handle serial day 60 for `year == 1900 && month == 2 && day == 29`, returning `60.0` to preserve the Lotus 1-2-3 / Excel leap year compatibility quirk.
2. In `crates/openexcel-core/src/evaluator.rs`:
   - In `eval_function_call`: Before rejecting unknown names via `self.registry.validate_arity`, check `env` and `self.reader.get_defined_name()`. If a closure or lambda is found, invoke it.
   - In `eval_apply`: Support `callee` when it is an `AstNode::NameRef` or `AstNode::Apply`, looking up the closure in `env` or evaluating the callee first.
   - Allow closures to be stored in `env` during `LET` evaluation without immediately evaluating bare `LAMBDA` to `#CALC!`.
3. In `crates/openexcel-core/src/functions/financial.rs` (`npv`):
   Check if `rate <= -1.0` or `1.0 + rate == 0.0` or `!total.is_finite()`, returning `Err(ErrorCode::Div0)` instead of `inf`.
4. In `crates/openexcel-core/src/functions/text.rs` (`text`):
   Add comma insertion for thousands groups when `fmt_str` contains `","`.

---

## 5. Verification Method

To independently reproduce all empirical findings:

1. **Run Full Test Suite (Demonstrating Current Failure)**:
   ```bash
   export PATH="$HOME/.cargo/bin:$PATH"
   cargo test -p openexcel-core
   ```
   *Observed result*: Fails on `adversarial_tests::test_adversarial_excel_1900_leap_year_quirk` with exit code `101`.

2. **Run Function Adversarial Test Suite (Demonstrating Findings 1, 2, and 3)**:
   ```bash
   export PATH="$HOME/.cargo/bin:$PATH"
   cargo test -p openexcel-core --test adversarial_function_tests -- --nocapture
   ```
   *Observed result*: Passes, asserting that:
   - `LET(f, LAMBDA(x, x+1), f(5))` returns `ErrorCode::Name` (`#NAME?`).
   - `FACTORIAL(5)` returns `ErrorCode::Name` (`#NAME?`).
   - `NPV(-1, 100)` returns `f64::INFINITY`.
   - `TEXT(1234567.89, "#,##0.00")` returns `"1234567.89"`.

3. **Invalidation Condition**:
   This rejection is invalidated when:
   - `cargo test -p openexcel-core` exits with code `0` across all test files.
   - `LET(fact, LAMBDA(self, n, IF(n<=1, 1, n*self(self, n-1))), fact(fact, 5))` returns `120.0`.
   - `NPV(-1, 100)` returns `#DIV/0!`.
