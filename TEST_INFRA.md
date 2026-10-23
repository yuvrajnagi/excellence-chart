# E2E Test Infra: OpenExcel

## Test Philosophy
- **Opaque-box & Requirement-driven**: All tests derive directly from `ORIGINAL_REQUEST.md` user requirements and acceptance criteria, independent of implementation internals.
- **Methodology**: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.
- **Progressive Testability**: Verification mechanisms use the simplest available signals first, scaling up to full browser E2E interaction.

## Feature Inventory & Test Coverage Mapping
| # | Feature | Requirement Source | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Scenario) |
|---|---------|-------------------|:-----------------:|:-----------------:|:-----------------:|:-----------------:|
| 1 | Virtualized Grid & Viewport Navigation | R1 (1M rows, 16K cols) | 5 | 5 | ✓ | ✓ |
| 2 | Cell Selection & Editing | R1 (Single, Range, Discontiguous) | 5 | 5 | ✓ | ✓ |
| 3 | Formula Bar & In-Cell Editor | R1 | 5 | 5 | ✓ | ✓ |
| 4 | Row & Column Operations (Insert/Delete/Resize/Hide) | R1 | 5 | 5 | ✓ | ✓ |
| 5 | Sheet Tabs Management (Add/Rename/Duplicate/Reorder/Color) | R1 | 5 | 5 | ✓ | ✓ |
| 6 | Find & Replace Dialog | R1 | 5 | 5 | ✓ | ✓ |
| 7 | Custom Formula Engine (Lexer/Parser/AST/Precedence) | R2 | 5 | 5 | ✓ | ✓ |
| 8 | References (Relative/Absolute/Mixed/Cross-Sheet/Named) | R2 | 5 | 5 | ✓ | ✓ |
| 9 | Dependency Recalculation & Cycle Detection (#CIRC!) | R2 | 5 | 5 | ✓ | ✓ |
| 10 | Dynamic Spill Arrays & Collisions (#SPILL!) | R2 | 5 | 5 | ✓ | ✓ |
| 11 | Function Library (SUM through SUBTOTAL, 88 functions) | R2 | 5 | 5 | ✓ | ✓ |
| 12 | Cell Formatting (Font/Color/Border/Align/Number) | R3 | 5 | 5 | ✓ | ✓ |
| 13 | Conditional Formatting (ColorScale/DataBar/Rules) | R3 | 5 | 5 | ✓ | ✓ |
| 14 | Data Tools (Sort/AutoFilter/Validation/Pivot/Tables) | R3 | 5 | 5 | ✓ | ✓ |
| 15 | Interactive Charts (9 types SVG & DrawingML) | R3 | 5 | 5 | ✓ | ✓ |
| 16 | Workbook Persistence (SQLite WAL/Autosave/Reload) | R3 | 5 | 5 | ✓ | ✓ |
| 17 | File I/O (Lossless XLSX & CSV Import/Export) | R3 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **E2E Playwright Runner**: `npm run test:e2e` (`npx playwright test`)
  - Config: `playwright.config.ts`
  - Suites: `tests/e2e/workbook.spec.ts`, `tests/e2e/performance.spec.ts`, `tests/e2e/interactions.spec.ts`
  - Pass/Fail Semantics: Clean browser launch, DOM element verification, calculated value verification, exit code 0.
- **Integration Test Runner**: `npm test` (`vitest run tests/integration`)
  - Multi-module end-to-end integration across model, formula, formatting, data tools, interop, and SQLite storage.
- **Performance Benchmark**: `npm run benchmark`
  - Verified 100,000 formulas recalculate in <500ms, and scrolling 100,000+ rows maintains responsiveness without freezing >500ms.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Financial Model & Cash Flow Forecast | SUM, NPV, IRR, PMT, dynamic spill SEQUENCE, cross-sheet references, currency formatting, line chart | High |
| 2 | Sales Analytics & Pivot Dashboard | Tables, VLOOKUP, XLOOKUP, AutoFilter, multi-column sorting, pivot table aggregation, column & donut charts | High |
| 3 | Inventory Reconciliation & Validation | Data validation dropdowns, conditional formatting data bars, INDEX/MATCH, UNIQUE, FILTER, CSV export | High |
| 4 | Excel Compatibility Challenge Workbook | 6 sheets, cross-sheet formulas, array formulas, intentional error triggers (#CIRC!, #SPILL!), DrawingML charts, XLSX export/import | Comprehensive |

## Coverage Thresholds
- Tier 1: ≥5 test cases per feature area (happy path isolation).
- Tier 2: ≥5 boundary/corner test cases per feature (limits, empty, extreme coordinates, error recovery).
- Tier 3: Pairwise coverage of cross-feature interactions (e.g., dynamic spill + conditional formatting, cross-sheet formula + pivot table).
- Tier 4: Realistic end-to-end application workloads verifying the full application stack.
