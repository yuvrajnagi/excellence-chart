# `apps/web` — OpenExcel Web Application

[![React](https://img.shields.io/badge/React-19.1.0-61DAFB.svg?logo=react)](file:///workspaces/excellence-chart/apps/web)
[![Vite](https://img.shields.io/badge/Vite-7.3-646CFF.svg?logo=vite)](file:///workspaces/excellence-chart/apps/web)
[![Grid Capacity](https://img.shields.io/badge/Capacity-1%2C048%2C576%20x%2016%2C384-brightgreen.svg)](file:///workspaces/excellence-chart/apps/web/src/App.tsx)

The flagship web frontend for OpenExcel, engineered with React 19, TypeScript, and Vite. It provides an Excel-faithful spreadsheet interface capable of rendering the full Excel grid capacity (**1,048,576 rows × 16,384 columns**) at 60fps via viewport virtualization and background Web Worker calculation offloading.

---

## Architectural Highlights

### 1. High-Performance DOM-Virtualized Viewport
Browsers cannot instantiate 17 billion DOM elements. OpenExcel implements a logarithmic virtual viewport translation model:
- **Spatial Windowing**: Only cells within the visible browser bounding box plus an 8-cell buffer are mounted to the DOM.
- **Logarithmic Scroll Scaling**: When total grid height exceeds browser layout maximums (~16,000,000px), scroll dimensions are scaled smoothly using `scaleY` and `scaleX` factors, guaranteeing that row 1,048,576 and column XFD are instantly reachable.
- **Freeze Panes**: Independent fixed headers for frozen rows and columns (`sheet.properties.view.freezeRows`, `freezeColumns`).
- **Interactive Resizing**: Real-time visual column width and row height drag handles.

### 2. Off-Thread Web Worker Bridge
All formula recalculations and AST graph updates execute in a dedicated Web Worker ([`src/calculation.worker.ts`](file:///workspaces/excellence-chart/apps/web/src/calculation.worker.ts)):
- Offloads the WebAssembly computation engine (`openexcel-wasm`) from the browser main thread.
- As the user scrolls, the UI requests computed values only for the active viewport and visible chart data ranges via non-blocking `postMessage`.
- Guarantees zero scroll stutter and 60fps frame rate even while background work recalculates 100,000+ formula cells.

### 3. Interactive SVG Charting Engine
OpenExcel renders reactive SVG charts ([`src/Chart.tsx`](file:///workspaces/excellence-chart/apps/web/src/Chart.tsx)) directly in the browser across 9 visualization modes:
1. **Column Chart**: Clustered vertical bars with automatic value-axis tick marks.
2. **Bar Chart**: Horizontal comparative category charts.
3. **Line Chart**: Continuous multi-series data lines with point markers.
4. **Area Chart**: Gradient-filled cumulative trend surfaces.
5. **Scatter Plot**: Dual continuous variable correlations $(X, Y)$.
6. **Pie Chart**: Proportional slice angles with computed SVG arcs.
7. **Donut Chart**: Radial breakdown with configurable center cutouts.
8. **Histogram**: Automated statistical frequency binning.
9. **Combo Chart**: Multi-axis overlays (e.g. Columns + Line).

Charts automatically update whenever referenced cells mutate.

### 4. Excel Ribbon Toolbar & Formula Bar
- **Categorized Tabs**: Home, Insert, Formulas, Data, Review, and View.
- **Two-Way Synchronized Formula Bar**: Bi-directional editing with Name Box coordinate jumping (e.g. typing `Z500` jumps the viewport directly).
- **Selection & Fill Handle**: Single-cell, rectangular range, and discontiguous multi-range selection (`Cmd`/`Ctrl` click) with fill handle linear series inference.
- **Cell Styling**: Font family, font size, bold, italic, underline, strikethrough, background color, text color, borders, text alignment, and format painter.
- **Data Tools**: Multi-column sorting, AutoFilter dropdowns, Find & Replace with case and entire-cell match options, Data Validation, and Pivot Tables.

---

## Directory Structure

```text
apps/web/
├── package.json               # Dependencies and build scripts
├── vite.config.ts             # Vite bundler configuration & proxy routes
├── index.html                 # HTML application entry point
├── src/
│   ├── main.tsx               # React application bootstrapper
│   ├── App.tsx                # Main spreadsheet UI, virtual grid & ribbon
│   ├── Chart.tsx              # Reactive SVG chart rendering engine
│   ├── api.ts                 # REST client for desktop & server storage backends
│   ├── calculation.worker.ts  # Web Worker hosting openexcel-wasm engine
│   ├── worker-client.ts       # Worker communication bridge & message queue
│   ├── operations.ts          # Pure UI spreadsheet mutation helpers
│   ├── styles.css             # High-performance grid CSS & theme styles
│   └── types.ts               # Local presentation state types
```

---

## Development & Build Commands

```bash
# Start Vite development server with Hot Module Replacement (HMR)
npm run dev

# Build optimized production bundle to apps/web/dist/
npm run build

# Preview production build locally
npm run preview
```

### Dev Server Proxy
During development (`npm run dev` on port `5173`), API calls to `/api/*` are automatically proxied to the native desktop backend at `http://127.0.0.1:3001`.
