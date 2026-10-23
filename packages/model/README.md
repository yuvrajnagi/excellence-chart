# `@openexcel/model`

[![npm](https://img.shields.io/badge/package-@openexcel/model-blue.svg)](file:///workspaces/excellence-chart/packages/model)
[![Zod](https://img.shields.io/badge/schema-Zod%20v4-3E67B1.svg?logo=zod)](file:///workspaces/excellence-chart/packages/model/src/schemas.ts)
[![Tests Passing](https://img.shields.io/badge/Tests-5%2F5%20Passing-brightgreen.svg)](file:///workspaces/excellence-chart/packages/model/test)

The foundational domain model, data contracts, and immutable state management system for OpenExcel. It defines strongly typed, Zod-validated schemas for workbooks, sheets, cells, styles, charts, tables, transactions, and coordinate mathematics.

---

## Capabilities

### 1. Coordinate Mathematics & Grid Constraints
- **Excel Full Boundary Constants**:
  - `GRID_ROWS = 1,048,576`
  - `GRID_COLUMNS = 16,384`
  - `TILE_ROWS = 128`
  - `TILE_COLUMNS = 32`
- **Bijective Base-26 Translation**:
  - `parseAddress("XFD1048576", sheetId)` $\rightarrow$ `{ row: 1048575, col: 16383 }`
  - `formatAddress({ row: 0, col: 0 })` $\rightarrow$ `"A1"`
  - Supports absolute coordinate indicators (`$A$1`, `$B5`, `C$10`).
- **Range Parsing & Normalization**:
  - `parseRange("A1:B10", sheetId)` $\rightarrow$ `{ top: 0, left: 0, bottom: 9, right: 1 }`

### 2. Strong Typing with Branded Identifiers
Entities use branded UUID strings to prevent cross-type argument confusion:
- `WorkbookId`: Unique workbook document ID
- `SheetId`: Sheet tab identifier
- `StyleId`: Reusable cell style token
- `ObjectId`: Chart or floating shape identifier
- `TransactionId`: Mutation changeset identifier

### 3. Sparse Tile-Based Workbook Representation
Workbooks are organized into sparse sheets composed of 128-row × 32-column tiles:
```typescript
interface Workbook {
  schemaVersion: 1;
  id: WorkbookId;
  revision: number;
  properties: WorkbookProperties;
  styles: Record<StyleId, CellStyle>;
  sheets: Record<SheetId, Sheet>;
}
```
Only populated tiles are instantiated, minimizing memory consumption and serialization payloads.

### 4. Transactional Mutation Engine & History Stack
- **Atomic Patches**: State modifications are expressed as atomic patch operations (`setCell`, `deleteCell`, `sheetProperties`, `addTable`, etc.).
- **Bounded History Manager**: `createHistory({ maxEntries: 100, maxBytes: 30_000_000 })` records inverse diffs for undo/redo with strict memory limits.

---

## Directory Structure

```text
packages/model/
├── package.json        # Manifest & exports
├── tsconfig.json       # TypeScript configuration
├── src/
│   ├── index.ts        # Primary package exports
│   ├── types.ts        # TypeScript interfaces & types
│   ├── schemas.ts      # Comprehensive Zod runtime schemas
│   ├── coordinates.ts  # Base-26 coordinate translation & boundary checks
│   ├── store.ts        # State store, patch applicator & transactions
│   ├── history.ts      # Bounded undo/redo history stack
│   ├── filters.ts      # Filter condition schemas and row visibility
│   └── api.ts          # Wire request & response schema parsers
└── test/
    ├── api.test.ts     # Request/response validation tests
    └── history.test.ts # Undo/redo and bounded memory tests
```

---

## Usage Example

```typescript
import {
  createWorkbook,
  createId,
  parseAddress,
  formatAddress,
  applyTransaction
} from '@openexcel/model';

// 1. Create a blank workbook
const workbook = createWorkbook({
  id: createId('workbook'),
  sheetId: createId('sheet'),
  name: 'Financial_Model',
  timestamp: new Date().toISOString()
});

// 2. Parse cell coordinates
const addr = parseAddress('B5', workbook.properties.activeSheetId);
if (addr.ok) {
  console.log(`Row: ${addr.value.row}, Col: ${addr.value.col}`); // Row: 4, Col: 1
}

// 3. Mutate via transaction
const tx = applyTransaction(workbook, {
  id: createId('transaction'),
  baseRevision: workbook.revision,
  label: 'Set value',
  timestamp: new Date().toISOString(),
  patches: [{
    kind: 'setCell',
    address: { sheetId: workbook.properties.activeSheetId, row: 4, col: 1 },
    cell: { input: { kind: 'value', value: 42 } }
  }]
});

if (tx.ok) {
  console.log('Updated revision:', tx.value.workbook.revision);
}
```
