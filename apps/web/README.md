# `apps/web` — OpenExcel Web Client

The presentation layer of OpenExcel, built with React 19 and Vite.

---

## Features

- **DOM-Virtualized Grid**: Highly responsive grid virtualizing 1,048,576 addressable rows and 16,384 columns per sheet, maintaining 60fps scrolling and instant coordinate resolution.
- **Excel-Style Ribbon**: Categorized tabs for Home, Insert, Formulas, Data, Review, and View.
- **Formula Bar**: Two-way synchronized expression input and Name Box coordinate navigation.
- **Interactive SVG Charting**: Live charts supporting 9 types (Line, Column, Bar, Area, Scatter, Pie, Donut, Histogram, and Combo) updating reactively as cells mutate.
- **Formatting Tools**: Font family/size, colors, borders, custom number formatting with grouping commas, and conditional formatting rules.
- **Data Tools**: Multi-column sorting, AutoFilter, validation dropdowns, and pivot tables.
- **Web Worker Offloading**: Computationally intensive formula recalculations run in a dedicated Web Worker (`src/calculation.worker.ts`), preventing main thread freezing.

---

## Development & Build

```bash
# Start Vite development server
npm run dev

# Build production bundle to dist/
npm run build
```
