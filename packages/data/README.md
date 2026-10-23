# `@openexcel/data`

[![npm](https://img.shields.io/badge/package-@openexcel/data-blue.svg)](file:///workspaces/excellence-chart/packages/data)
[![Tests Passing](https://img.shields.io/badge/Tests-6%2F6%20Passing-brightgreen.svg)](file:///workspaces/excellence-chart/packages/data/test)

Data manipulation, analysis, and transformation algorithms for OpenExcel. It provides multi-column sorting, AutoFilter evaluation, duplicate removal, text-to-columns parsing, pivot table aggregation, and goal-seek root finding.

---

## Capabilities

### 1. Multi-Column Range Sorting (`sortRange`)
- Supports multiple sort keys with independent sort directions (`asc` or `desc`).
- **Excel Type-Rank Comparison**: Consistent ordering across disparate types:
  $$\text{Numbers} < \text{Strings} < \text{Booleans} < \text{Errors} < \text{Null / Empty}$$
- Preserves authored cell styles and formats alongside cell values.
- Generates transactional patches (`Patch[]`) for seamless undo/redo.

### 2. AutoFilter & Row Visibility (`matchesFilter`, `hiddenRows`)
- Evaluates composite filter predicates over tabular ranges.
- Supports value checklists, equality tests, numeric comparisons (`>`, `<`, `<=`, `>=`), and wildcard pattern matching (`*`, `?`).
- Translates active filters into collapsed interval lists for DOM virtualization skipping.

### 3. Duplicate Removal (`removeDuplicates`)
- Eliminates duplicate records across specified column subsets.
- Retains the first occurrence of unique rows and compacts the target range.

### 4. Text to Columns (`textToColumns`)
- Splits delimited text strings across consecutive columns (e.g., comma, tab, semicolon).
- Guards against grid boundary overflow (`col < 16,384`) and prevents accidental overwrites of existing formula cells.

### 5. Pivot Table Aggregation (`pivotRows`, `refreshPivot`)
- Aggregates multi-dimensional row and column groups from raw source tables.
- Supported aggregation functions: `SUM`, `COUNT`, `COUNTA`, `AVERAGE`, `MIN`, `MAX`.
- Emits summarized pivot table layouts directly into workbook cells as atomic patches.

### 6. Goal Seek (`goalSeek`)
- Numerical optimization solver using the secant root-finding method.
- Automatically adjusts a single independent input cell until a target formula cell matches a desired goal value.

---

## Directory Structure

```text
packages/data/
├── package.json        # Dependencies & exports
├── tsconfig.json       # TypeScript configuration
├── src/
│   └── index.ts        # Sort, filter, pivot, and data tool implementations
└── test/
    └── data.test.ts    # Comprehensive test suite covering sort, filter, and pivots
```

---

## Usage Example

```typescript
import { sortRange, removeDuplicates, textToColumns } from '@openexcel/data';
import { applyTransaction, createId } from '@openexcel/model';

// Multi-column sorting
const sortPatches = sortRange(
  workbook,
  { sheetId: 'Sheet1', top: 1, left: 0, bottom: 50, right: 3 },
  [
    { offset: 0, direction: 'asc' },  // Primary sort by Col A
    { offset: 1, direction: 'desc' }  // Secondary sort by Col B
  ],
  valueReader
);

// Apply sort results via transaction
applyTransaction(workbook, {
  id: createId('transaction'),
  baseRevision: workbook.revision,
  label: 'Sort Data',
  timestamp: new Date().toISOString(),
  patches: sortPatches
});
```
