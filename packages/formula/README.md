# `@openexcel/formula`

[![npm](https://img.shields.io/badge/package-@openexcel/formula-orange.svg)](file:///workspaces/excellence-chart/packages/formula)
[![Tests Passing](https://img.shields.io/badge/Tests-356%2F356%20Passing-brightgreen.svg)](file:///workspaces/excellence-chart/packages/formula/test)

The TypeScript formula compilation, dependency resolution, and evaluation engine for OpenExcel. It implements a complete spreadsheet expression pipeline: tokenizer (lexer), recursive-descent Pratt parser, strongly-typed AST, spatial dependency DAG with `#CIRC!` cycle detection, dynamic array spill management (`#SPILL!`), and an Excel standard function registry.

---

## Architectural Highlights

### 1. Pratt Parser & AST Representation
The parser transforms formula strings (e.g., `=SUM(A1:B10) * (1 + C1)^2`) into a typed AST:
- **Expression Types**:
  - `Literal`: Numbers, booleans, strings, and Excel error codes (`#DIV/0!`, `#N/A`, etc.).
  - `CellReference`: Fully qualified (`Sheet1!A1`) or local (`$B$4`).
  - `RangeReference`: Bounded rectangular regions (`A1:C20`).
  - `UnaryOp`: Negation `-`, positive `+`, postfix percentage `%`.
  - `BinaryOp`: Arithmetic (`+`, `-`, `*`, `/`, `^`), concatenation (`&`), comparisons (`=`, `<>`, `<`, `>`, `<=`, `>=`).
  - `FunctionCall`: Standard Excel function invocation (`VLOOKUP(...)`).
  - `ArrayLiteral`: Inline 2D arrays (`{1, 2; 3, 4}`).
- **Precedence Parsing**: Enforces standard Excel precedence rules, including right-associative exponentiation (`2^3^2 = 512`) and unary negation precedence (`-2^2 = -4`).

### 2. Spatial Dependency DAG
- Dependencies are tracked using a directed acyclic graph (DAG).
- Rectangular range dependencies (`A1:D1000`) are partitioned into **256-row spatial buckets**. When an input cell mutates, only the intersecting buckets are inspected, ensuring recalculation overhead remains low even with massive ranges.
- **Topological Sorting**: Evaluates dependencies in proper order so dependent cells always receive up-to-date inputs.
- **Volatile Functions**: Tracks non-deterministic functions (`RAND`, `RANDBETWEEN`, `NOW`, `TODAY`) for automatic evaluation on each calculation tick.

### 3. Dynamic Array Spilling
Functions that produce multi-cell matrices (`SEQUENCE`, `SORT`, `FILTER`, `UNIQUE`, `TRANSPOSE`) automatically spill into neighboring cells:
- Spilled areas are tracked in memory.
- If an authored cell obstructs the bounding rectangle, the function returns `#SPILL!`.

### 4. Reference Adjustment
Includes utilities to rewrite formulas during structural grid mutations:
- `adjustFormulaReferences(formula, mutation)` updates cell references when rows or columns are inserted, deleted, or moved.

---

## Directory Structure

```text
packages/formula/
├── package.json        # Subpath exports (. / syntax / functions / ast / lexer / parser)
├── tsconfig.json       # TypeScript configuration
├── src/
│   ├── index.ts        # FormulaEngine factory & recalculation scheduler
│   ├── lexer.ts        # Formula tokenizer
│   ├── parser.ts       # Pratt precedence parser
│   ├── ast.ts          # AST node definitions
│   ├── syntax.ts       # Formula syntax validation & formatting
│   └── functions.ts    # Excel standard function implementations
└── test/
    ├── lexer.test.ts   # Tokenizer edge cases & scientific notation
    └── parser.test.ts  # Precedence, array literals, and grammar tests
```

---

## Usage Example

```typescript
import { createEngine, adjustFormulaReferences } from '@openexcel/formula';
import { createWorkbook, createId } from '@openexcel/model';

// 1. Initialize engine with a workbook
const workbook = createWorkbook({
  id: createId('workbook'),
  sheetId: createId('sheet'),
  name: 'Demo',
  timestamp: new Date().toISOString()
});

const engine = createEngine(workbook);

// 2. Evaluate an ad-hoc formula
const result = engine.evaluateFormula('=SUM(10, 20, 30) * 2', {
  sheetId: workbook.properties.activeSheetId,
  row: 0,
  col: 0
});

console.log('Result:', result); // 120

// 3. Adjust formula on row insertion
const adjusted = adjustFormulaReferences('=A1 + B5', {
  type: 'insertRow',
  sheetId: workbook.properties.activeSheetId,
  index: 2,
  count: 1
});

console.log('Adjusted:', adjusted); // =A1 + B6
```
