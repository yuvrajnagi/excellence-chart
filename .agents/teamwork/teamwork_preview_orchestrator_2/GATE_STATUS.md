# Gate Status — Orchestrator 2

## Milestone 1: Rust Core Calculation Engine (R1) — Iteration 1
Status: GATE_FAIL

| Agent | Role | Verdict | Source |
|-------|------|---------|--------|
| worker_m1_rust | teamwork_preview_worker | DONE (initial 24/24 passed) | handoff.md |
| reviewer_m1_rust_1 | teamwork_preview_reviewer | **REQUEST_CHANGES** | handoff.md |
| reviewer_m1_rust_2 | teamwork_preview_reviewer | **APPROVE** | handoff.md |
| challenger_m1_rust_1 | teamwork_preview_challenger | **REJECT** | handoff.md |
| challenger_m1_rust_2 | teamwork_preview_challenger | **REJECT** | handoff.md |
| auditor_m1_rust | teamwork_preview_auditor | **CLEAN** | handoff.md |

Gate Result: **FAIL** (Reviewer 1: REQUEST_CHANGES; Challenger 1: REJECT; Challenger 2: REJECT)

### Summary of Isolated Defects for Iteration 2 Remediation
1. **Defect 1 [Critical]: Excel 1900 Date Quirk Round-Trip (`date_time.rs:44-61`)**:
   `DATE(1900, 2, 29)` evaluates to serial `61.0` (March 1, 1900) instead of `60.0` (February 29, 1900) because Chrono's `NaiveDate` does not treat 1900 as a leap year. Fix: add explicit check `if year == 1900 && month == 2 && day == 29 { return Ok(60.0); }` in `ymd_to_serial`.
2. **Defect 2 [Critical]: Spill Child Stale Cache on Collision Clearance (`engine.rs`, `spill.rs`)**:
   When an authored collision blocking an array spill is cleared with `Scalar::Null`, the child cell reads `Scalar::Null` instead of the unblocked spill value due to unordered `HashSet` iteration in `recalculate()` and lack of anchor evaluation in `read_cell`. Fix: in `read_cell`, evaluate anchor if not in computed; in `spill.rs`/`engine.rs`, remove stale cached child values when registering a spill.
3. **Defect 3 [Major]: Stack Overflow on Deep Dependency Chains (`engine.rs`)**:
   Deep dependency chains (>=200–1,000 cells) crash with `SIGABRT` (stack overflow) due to call stack recursion on the thread stack. Fix: sort dirty cells topologically using `graph.deps` / `graph.reverse_deps` from roots to leaves before evaluation in `recalculate()`, ensuring O(1) cache hits and preventing recursive depth.
4. **Defect 4 [Major]: Closure & LAMBDA Invocations via LET / Defined Names (`evaluator.rs`)**:
   First-class closure invocation via LET bindings or defined names (`LAMBDA(x, x*2)(5)`) fails with `#NAME?` or `#VALUE!`. Fix: support invoking AST `Apply` on expressions that evaluate to `ComputedValue::Lambda`.
5. **Defect 5 [Minor]: Financial NPV Division by Zero (`financial.rs`)**:
   `NPV(-1, 100)` returns `inf` instead of `#DIV/0!`. Fix: check `if (1.0 + rate).abs() < 1e-12 { return Ok(Scalar::Error(ErrorCode::Div0)); }`.
6. **Defect 6 [Minor]: TEXT Format String Thousands Commas (`text.rs`)**:
   `TEXT(1234567.89, "#,##0.00")` ignores grouping commas. Fix: format integer parts with standard thousands separators when commas appear in the format pattern.
