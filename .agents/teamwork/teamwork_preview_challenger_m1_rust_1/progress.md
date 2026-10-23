# Progress

Last visited: 2026-10-23T19:59:35Z

- Implemented comprehensive adversarial test harness in `crates/openexcel-core/tests/adversarial_tests.rs`.
- Tested:
  1. Pratt parser precedence & syntax (`-2^2`, `1+2*3`, `1:2+3`, nested calls, scientific notation `1.5e-3`) -> PASSED.
  2. Cycle detection (mutual circular references, 3-node cycle, self-reference, range self-reference, breaking cycles) -> PASSED.
  3. Dynamic array spill limits (XFD, row 1,048,575, exact fit at boundary) & spill-on-spill collision -> PASSED.
  4. Deep dependency chain (1,000 sequential cells) -> FAILED: Thread stack overflow / SIGABRT at ~270 cells.
  5. Dynamic array spill collision recovery -> FAILED: Stale `Scalar::Null` in `computed` cache masks spilled child `5.0`.
  6. Excel 1900 leap year date quirk -> FAILED: `DATE(1900, 2, 29)` returns 61.0 instead of 60.0.
- Authored 5-component handoff report with verdict: REJECT.
