import { useMemo, useState } from "react";
import { applyTransaction, createId, getCell, parseCellInput } from "@openexcel/model";
import type { CellAddress, CellRect, Transaction, Workbook } from "@openexcel/model";
import { createEngine } from "@openexcel/formula";
import { blankWorkbook, cellText } from "./operations.js";
import { Chart } from "./Chart.js";
import "./styles.css";

const rows = 40, cols = 16;
const letters = (n: number) => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const addr = (row: number, col: number) => `${letters(col)}${row + 1}`;

export function App() {
  const [workbook, setWorkbook] = useState<Workbook>(() => blankWorkbook());
  const [active, setActive] = useState({ row: 0, col: 0 });
  const [formula, setFormula] = useState("");
  const [tab, setTab] = useState("Home");
  const sheet = workbook.sheets[workbook.properties.activeSheetId]!;
  const engine = useMemo(() => { const e = createEngine(workbook); e.recalculate(); return e; }, [workbook]);
  const current = getCell(workbook, { sheetId: sheet.id, ...active });
  const commit = (text: string) => {
    const at: CellAddress = { sheetId: sheet.id, ...active };
    const transaction: Transaction = { id: createId("transaction"), baseRevision: workbook.revision, label: "Edit cell", timestamp: new Date().toISOString(), patches: [{ kind: "cell", at, cell: { input: parseCellInput(text, workbook.properties.dateSystem) } }] };
    const result = applyTransaction(workbook, transaction);
    if (result.ok) { setWorkbook(result.value.workbook); setFormula(""); }
  };
  const valueAt = (row: number, col: number) => engine.value({ sheetId: sheet.id, row, col });
  const display = (row: number, col: number) => {
    const value = valueAt(row, col);
    return typeof value === "object" && value?.kind === "array" ? String(value.values[0] ?? "") : String(value ?? "");
  };
  const select = (row: number, col: number) => { setActive({ row, col }); setFormula(cellText(getCell(workbook, { sheetId: sheet.id, row, col }))); };
  return <main className="excel-shell">
    <header className="titlebar"><strong>OpenExcel</strong><span>{workbook.properties.name}</span><span className="save-state">Saved locally</span></header>
    <nav className="ribbon-tabs">{["File", "Home", "Insert", "Formulas", "Data", "Review", "View"].map((name) => <button className={tab === name ? "selected" : ""} onClick={() => setTab(name)} key={name}>{name}</button>)}</nav>
    <section className="ribbon"><button onClick={() => commit("")}>Clear</button><button onClick={() => commit("=SUM(A1:A5)")}>Σ AutoSum</button><button onClick={() => commit("=TODAY()")}>Date</button><label>Zoom <input type="range" min="60" max="160" defaultValue="100" /></label><span className="ribbon-context">{tab} tools</span></section>
    <section className="formula-row"><input className="name-box" value={addr(active.row, active.col)} readOnly /><span className="fx">fx</span><input aria-label="Formula bar" className="formula-box" value={formula} onChange={(e) => setFormula(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(formula); }} /></section>
    <section className="grid-wrap"><table className="grid"><thead><tr><th className="corner" />{Array.from({ length: cols }, (_, col) => <th key={col}>{letters(col)}</th>)}</tr></thead><tbody>{Array.from({ length: rows }, (_, row) => <tr key={row}><th>{row + 1}</th>{Array.from({ length: cols }, (_, col) => <td key={col} className={row === active.row && col === active.col ? "active" : ""} onClick={() => select(row, col)}><input aria-label={`${addr(row, col)} cell`} value={row === active.row && col === active.col ? formula : display(row, col)} onChange={(e) => { select(row, col); setFormula(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); if (e.key === "Tab") select(row, Math.min(cols - 1, col + 1)); }} /></td>)}</tr>)}</tbody></table></section>
    <footer className="sheetbar"><button className="sheet-tab active-sheet">{sheet.properties.name}</button><button onClick={() => alert("New sheet creation is available through workbook APIs.")}>＋</button><span className="status">Ready · {addr(active.row, active.col)}</span></footer>
    {sheet.properties.charts.map((chart) => <Chart key={chart.id} chart={chart} value={(at) => engine.value(at) as never} onEdit={() => undefined} onDelete={() => undefined} />)}
  </main>;
}
