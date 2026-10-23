# `@openexcel/interop`

[![npm](https://img.shields.io/badge/package-@openexcel/interop-blue.svg)](file:///workspaces/excellence-chart/packages/interop)
[![Interop](https://img.shields.io/badge/formats-XLSX%20%7C%20CSV%20%7C%20TSV-brightgreen.svg)](file:///workspaces/excellence-chart/packages/interop)
[![Tests Passing](https://img.shields.io/badge/Tests-7%2F7%20Passing-brightgreen.svg)](file:///workspaces/excellence-chart/packages/interop/test)

The file interoperability and format conversion library for OpenExcel. It provides bidirectional, lossless import and export of Microsoft Excel (`.xlsx`) workbooks and delimited text files (`.csv`, `.tsv`), with hardened defenses against decompression bombs, path traversal, and XML entity injection.

---

## Capabilities

### 1. Hardened XLSX Archive Processing
Spreadsheet archives from untrusted sources are strictly sandboxed prior to buffer allocation:
- **Zip-Bomb & Expansion Defense**: Enforces strict expansion limits (`maxInputBytes: 32MB`, `maxExpandedBytes: 128MB`, `maxExpansionRatio: 1000`).
- **Path Traversal Protection**: Rejects archive paths containing `..`, absolute paths (`/`), or backslashes.
- **XXE Prevention**: Forbids `<!DOCTYPE` and `<!ENTITY` declarations across all XML parts.
- **External Relationship Blocking**: Rejects `TargetMode="External"` references to mitigate SSRF and remote file inclusion.

### 2. Lossless Excel Document Round-Tripping
- **Cell Content & Formulas**: Translates OpenXML formula syntax, shared formulas, and cached evaluation results.
- **Rich Formatting & Styles**: Imports and exports font families, sizes, colors, fills, borders, number formatting patterns, and alignment.
- **DrawingML Native Charts**: Serializes OpenExcel's 9 chart types into standard DrawingML OpenXML chart spaces ([`src/charts.ts`](file:///workspaces/excellence-chart/packages/interop/src/charts.ts)), ensuring charts open natively in Microsoft Excel and LibreOffice.
- **Tamper-Evident Manifest**: Embeds `openexcel/manifest.json` with SHA-256 hashes of standard parts; detects whether workbooks were modified by third-party Excel editors.

### 3. Delimited Text Parser & Generator (`CSV` / `TSV`)
- **RFC 4180 Compliance**: Correctly handles escaped quotes (`""`), embedded commas, and multiline field values.
- **Byte Order Mark (BOM)**: Automatically handles UTF-8 BOM (`\uFEFF`).
- **Configurable Delimiters**: Supports comma (`,`), semicolon (`;`), and tab (`\t`).

---

## Directory Structure

```text
packages/interop/
├── package.json          # Dependencies (exceljs, fflate) & exports
├── tsconfig.json         # TypeScript configuration
├── src/
│   ├── index.ts          # XLSX and CSV import/export pipeline
│   └── charts.ts         # DrawingML OpenXML chart part generator
└── test/
    ├── interop.test.ts   # Round-trip fidelity, formulas & formatting tests
    └── challenge.test.ts # Excel Compatibility Challenge regression suite
```

---

## Usage Example

```typescript
import { importWorkbook, exportWorkbook, DEFAULT_INTEROP_LIMITS } from '@openexcel/interop';
import { createId } from '@openexcel/model';

// 1. Import an XLSX workbook from bytes
const importResult = await importWorkbook({
  format: 'xlsx',
  bytes: fileBuffer,
  name: 'Quarterly_Report',
  workbookId: createId('workbook'),
  firstSheetId: createId('sheet'),
  timestamp: new Date().toISOString(),
  parseCsvFormulas: false,
  limits: DEFAULT_INTEROP_LIMITS
});

console.log('Imported sheets:', Object.keys(importResult.workbook.sheets));

// 2. Export workbook to XLSX
const exportResult = await exportWorkbook({
  workbook: importResult.workbook,
  file: { format: 'xlsx' },
  cache: { revision: importResult.workbook.revision, values: {} },
  limits: DEFAULT_INTEROP_LIMITS
});

console.log(`Generated ${exportResult.bytes.length} bytes as ${exportResult.filename}`);
```
