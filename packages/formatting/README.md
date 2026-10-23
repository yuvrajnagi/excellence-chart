# `@openexcel/formatting`

[![npm](https://img.shields.io/badge/package-@openexcel/formatting-green.svg)](file:///workspaces/excellence-chart/packages/formatting)
[![Tests Passing](https://img.shields.io/badge/Tests-9%2F9%20Passing-brightgreen.svg)](file:///workspaces/excellence-chart/packages/formatting/test)

The cell formatting and conditional formatting engine for OpenExcel. It implements Excel-standard number format strings, date/time serialization, CSS mapping for rich text typography and cell borders, and continuous color-scale interpolation.

---

## Capabilities

### 1. Excel Number Format Engine (`formatValue`)
Interprets Excel number format specifications without dynamic code evaluation:
- **Four-Section Grammar**: Evaluates formats divided by semicolons (`positive;negative;zero;text`).
- **Grouping & Decimals**: Handles thousand separators (`,`) and fractional precision (`0.00`, `#,##0.00`).
- **Accounting & Negatives**: Parentheses formatting for accounting (`($#,##0.00)`), custom currency prefixes (`$`, `€`, `£`, `¥`), and trailing text literals (`" USD"`).
- **Percentages & Scientific**: `0.0%` scaling ($100\times$) and exponential notation (`0.00E+00`).
- **Date & Time Tokens**: Serial date translation based on the Excel epoch (December 30, 1899) supporting tokens: `yyyy`, `yy`, `mmmm`, `mmm`, `mm`, `m`, `dd`, `d`.

### 2. Cell Style to CSS Translation (`styleToCSS`)
Translates OpenExcel `CellStyle` definitions into React CSS styles:
- **Typography**: `font.family`, `font.size` (in points), `font.bold`, `font.italic`, `font.underline`, `font.strikethrough`.
- **Colors**: Foreground `font.color` and background `fill`.
- **Alignment & Layout**: `horizontal` (`left`, `center`, `right`), `vertical` (`top`, `middle`, `bottom`), `wrap` (text wrapping), and `rotation`.
- **Borders**: Per-edge styling (`top`, `bottom`, `left`, `right`) with thicknesses (`thin`, `medium`, `thick`) and border types (`solid`, `dashed`, `dotted`, `double`).

### 3. Conditional Formatting Color Scales (`colorScale`)
- Evaluates 2-color and 3-color gradient heatmaps across cell ranges.
- Computes RGB interpolation between min, mid, and max threshold values.

---

## Directory Structure

```text
packages/formatting/
├── package.json        # Dependencies & exports
├── tsconfig.json       # TypeScript configuration
├── src/
│   └── index.ts        # formatValue, styleToCSS, and colorScale
└── test/
    └── format.test.ts  # Verification suite for numbers, dates, currencies & CSS
```

---

## Usage Example

```typescript
import { formatValue, styleToCSS, colorScale } from '@openexcel/formatting';

// 1. Format Currency
console.log(formatValue(1234567.89, '$#,##0.00'));
// Output: "$1,234,567.89"

// 2. Format Accounting Negative
console.log(formatValue(-4500, '$#,##0;($#,##0);"-"'));
// Output: "($4,500)"

// 3. Format Date
console.log(formatValue(45100, 'yyyy-mm-dd'));
// Output: "2023-06-23"

// 4. Generate CSS for Cell
const css = styleToCSS({
  font: { family: 'Calibri', size: 11, bold: true, color: '#1B365D' },
  fill: '#F0F4F8',
  borders: {
    bottom: { style: 'thick', color: '#0055A5' }
  }
});
```
