import { entries, getCell } from "@openexcel/model";
import type { CellAddress, ComputedValue, Scalar, Workbook } from "@openexcel/model";
import { parseFormula, type Ast } from "./syntax.js";
import { err, invoke, isArray, scalar, createDefaultRegistry } from "./functions.js";

export interface FormulaEngine {
  updateWorkbook(workbook: Workbook): void;
  recalculate(): void;
  value(address: CellAddress): ComputedValue;
  dependencies(address: CellAddress): readonly CellAddress[];
  evaluateFormula(source: string, address: CellAddress, epoch?: { nowMs?: number; randomSeed?: number }): ComputedValue;
  dispose(): void;
}

const key = (a: CellAddress) => `${a.sheetId}:${a.row}:${a.col}`;
const asNumber = (value: ComputedValue): number => {
  const v = scalar(value);
  if (typeof v === "number") return v;
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function createEngine(initial: Workbook, options: { nowMs?: number; random?: () => number } = {}): FormulaEngine {
  let workbook = initial;
  const cache = new Map<string, ComputedValue>();
  const deps = new Map<string, CellAddress[]>();
  const active = new Set<string>();
  let epochNow: number | undefined;
  const now = () => epochNow ?? options.nowMs ?? Date.now();
  const random = options.random ?? Math.random;

  const resolveSheet = (address: CellAddress, sheetName?: string) => {
    if (!sheetName) return address.sheetId;
    const found = Object.values(workbook.sheets).find((sheet) => sheet.properties.name.toLowerCase() === sheetName.toLowerCase());
    return found?.id ?? address.sheetId;
  };
  const evalAst = (ast: Ast, address: CellAddress, env = new Map<string, ComputedValue>()): ComputedValue => {
    switch (ast.kind) {
      case "literal": return ast.value;
      case "name": {
        const local = env.get(ast.name.toLowerCase());
        if (local !== undefined) return local;
        const name = workbook.names.find((n) => n.name.toLowerCase() === ast.name.toLowerCase() &&
          (n.scope === null || n.scope === address.sheetId));
        return name ? evalFormula(name.formula, address) : err("#NAME?");
      }
      case "ref": {
        const at = { sheetId: resolveSheet(address, ast.sheet), row: ast.row, col: ast.col };
        return read(at);
      }
      case "range": {
        if (ast.from.kind !== "ref" || ast.to.kind !== "ref") return err("#REF!");
        const sheetId = resolveSheet(address, ast.from.sheet);
        const top = Math.min(ast.from.row, ast.to.row), bottom = Math.max(ast.from.row, ast.to.row);
        const left = Math.min(ast.from.col, ast.to.col), right = Math.max(ast.from.col, ast.to.col);
        const values: Scalar[] = [];
        for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) values.push(scalar(read({ sheetId, row, col })));
        return { kind: "array", rows: bottom - top + 1, cols: right - left + 1, values };
      }
      case "array": {
        const rows = ast.rows.length, cols = ast.rows[0]?.length ?? 0;
        return { kind: "array", rows, cols, values: ast.rows.flatMap((row) => row.map((item) => scalar(evalAst(item, address, env)))) };
      }
      case "unary": {
        const value = evalAst(ast.arg, address, env);
        if (ast.op === "%") return asNumber(value) / 100;
        return ast.op === "-" ? -asNumber(value) : asNumber(value);
      }
      case "binary": {
        const leftValue = evalAst(ast.left, address, env), rightValue = evalAst(ast.right, address, env);
        if (isArray(leftValue) || isArray(rightValue)) {
          const left = isArray(leftValue) ? leftValue : { kind: "array" as const, rows: 1, cols: 1, values: [scalar(leftValue)] };
          const right = isArray(rightValue) ? rightValue : { kind: "array" as const, rows: 1, cols: 1, values: [scalar(rightValue)] };
          const values = left.values.map((value, i) => {
            const other = right.values[i] ?? right.values[0] ?? null;
            if (ast.op === ">") return asNumber(value) > asNumber(other);
            if (ast.op === ">=") return asNumber(value) >= asNumber(other);
            if (ast.op === "<") return asNumber(value) < asNumber(other);
            if (ast.op === "<=") return asNumber(value) <= asNumber(other);
            if (ast.op === "=") return value === other;
            if (ast.op === "<>") return value !== other;
            return err("#VALUE!");
          });
          return { kind: "array", rows: left.rows, cols: left.cols, values };
        }
        const left = scalar(leftValue), right = scalar(rightValue);
        if (typeof left === "object" && left?.kind === "error") return left;
        if (typeof right === "object" && right?.kind === "error") return right;
        switch (ast.op) {
          case "+": return asNumber(left) + asNumber(right);
          case "-": return asNumber(left) - asNumber(right);
          case "*": return asNumber(left) * asNumber(right);
          case "/": return asNumber(right) === 0 ? err("#DIV/0!") : asNumber(left) / asNumber(right);
          case "^": return asNumber(left) ** asNumber(right);
          case "&": return `${left ?? ""}${right ?? ""}`;
          case "=": return left === right;
          case "<>": return left !== right;
          case "<": return asNumber(left) < asNumber(right);
          case ">": return asNumber(left) > asNumber(right);
          case "<=": return asNumber(left) <= asNumber(right);
          case ">=": return asNumber(left) >= asNumber(right);
          default: return err("#VALUE!");
        }
      }
      case "call": {
        const definition = createDefaultRegistry().get(ast.name);
        if (definition && (ast.args.length < definition.minArgs || (definition.maxArgs !== null && ast.args.length > definition.maxArgs))) return err("#VALUE!");
        if (ast.name === "INDIRECT") {
          const reference = scalar(evalAst(ast.args[0]!, address));
          if (typeof reference !== "string") return err("#REF!");
          const match = /^([A-Za-z]{1,3})([1-9]\d*)$/.exec(reference);
          if (!match) return err("#REF!");
          let col = 0;
          for (const char of match[1]!.toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64;
          return read({ sheetId: address.sheetId, row: Number(match[2]) - 1, col: col - 1 });
        }
        if (ast.name === "OFFSET") {
          const origin = ast.args[0]?.kind === "ref" ? ast.args[0] : undefined;
          if (!origin || origin.kind !== "ref") return err("#REF!");
          const row = origin.row + Math.trunc(asNumber(evalAst(ast.args[1]!, address)));
          const col = origin.col + Math.trunc(asNumber(evalAst(ast.args[2]!, address)));
          const height = ast.args[3] ? Math.trunc(asNumber(evalAst(ast.args[3]!, address))) : 1;
          const width = ast.args[4] ? Math.trunc(asNumber(evalAst(ast.args[4]!, address))) : 1;
          if (row < 0 || col < 0 || height < 1 || width < 1) return err("#REF!");
          const values: Scalar[] = [];
          for (let r = row; r < row + height; r++) for (let c = col; c < col + width; c++) values.push(scalar(read({ sheetId: address.sheetId, row: r, col: c })));
          return { kind: "array", rows: height, cols: width, values };
        }
        if (ast.name === "CHOOSE") {
          const index = Math.trunc(asNumber(evalAst(ast.args[0] ?? { kind: "literal", value: 0 }, address)));
          if (index < 1 || index >= ast.args.length) return err("#VALUE!");
          return evalAst(ast.args[index]!, address);
        }
        if (ast.name === "LET") {
          const local = new Map(env);
          for (let i = 0; i + 1 < ast.args.length - 1; i += 2) {
            const binding = ast.args[i];
            if (binding?.kind !== "name") return err("#NAME?");
            local.set(binding.name.toLowerCase(), evalAst(ast.args[i + 1]!, address, local));
          }
          return evalAst(ast.args.at(-1)!, address, local);
        }
        const args = ast.args.map((arg) => evalAst(arg, address, env));
        if (ast.name === "IF") return args[0] && Boolean(scalar(args[0])) ? args[1] ?? false : args[2] ?? false;
        if (ast.name === "IFERROR") {
          const first = scalar(args[0] ?? null);
          return typeof first === "object" && first !== null && first.kind === "error" ? args[1] ?? "" : args[0] ?? "";
        }
        if (ast.name === "IFNA") {
          const first = scalar(args[0] ?? null);
          return typeof first === "object" && first !== null && first.code === "#N/A" ? args[1] ?? "" : args[0] ?? "";
        }
        if (ast.name === "IFS") {
          for (let i = 0; i + 1 < args.length; i += 2) if (Boolean(scalar(args[i]!))) return args[i + 1]!;
          return err("#N/A");
        }
        if (ast.name === "SWITCH") {
          const target = scalar(args[0] ?? null);
          for (let i = 1; i + 1 < args.length; i += 2) if (scalar(args[i]!) === target) return args[i + 1]!;
          return args.length % 2 === 0 ? args.at(-1)! : err("#N/A");
        }
        if (ast.name === "LAMBDA") return err("#CALC!");
        if (ast.name === "INDIRECT" || ast.name === "OFFSET") return err("#REF!");
        return invoke(ast.name, args, now(), random);
      }
    }
  };
  const evalFormula = (source: string, address: CellAddress): ComputedValue => {
    try {
      const text = source.startsWith("=") ? source.slice(1) : source;
      if (/^LET\(/i.test(text) && text.endsWith(")")) {
        const parts = text.slice(4, -1).split(",");
        if (parts.length < 3 || parts.length % 2 === 0) return err("#VALUE!");
        const local = new Map<string, ComputedValue>();
        for (let i = 0; i + 1 < parts.length - 1; i += 2) local.set(parts[i]!.trim().toLowerCase(), evalAst(parseFormula(parts[i + 1]!), address, local));
        return evalAst(parseFormula(parts.at(-1)!), address, local);
      }
      const lambda = /^LAMBDA\(([^,]+),(.+)\)\((.+)\)$/i.exec(text);
      if (lambda) {
        const local = new Map<string, ComputedValue>([[lambda[1]!.trim().toLowerCase(), evalAst(parseFormula(lambda[3]!), address)]]);
        return evalAst(parseFormula(lambda[2]!), address, local);
      }
      return evalAst(parseFormula(source), address);
    }
    catch (error) { return error && typeof error === "object" && "code" in error ? error as ComputedValue : err("#PARSE!"); }
  };
  const read = (address: CellAddress): ComputedValue => {
    const k = key(address);
    const cached = cache.get(k);
    if (cached !== undefined) return cached;
    if (active.has(k)) return err("#CIRC!");
    active.add(k);
    const cell = getCell(workbook, address);
    const value = !cell ? null : cell.input.kind === "formula" ? evalFormula(cell.input.source, address) : cell.input.value;
    active.delete(k);
    cache.set(k, value);
    return value;
  };
  return {
    updateWorkbook(next) { workbook = next; cache.clear(); deps.clear(); },
    recalculate() {
      cache.clear();
      for (const sheet of Object.values(workbook.sheets)) {
        for (const { at, cell } of entries(workbook, { sheetId: sheet.id, top: 0, left: 0, bottom: 1_048_575, right: 16_383 })) {
          if (cell.input.kind === "formula") read(at);
        }
      }
    },
    value: read,
    dependencies(address) { return deps.get(key(address)) ?? []; },
    evaluateFormula(source, address, epoch) {
      const oldNow = epochNow;
      epochNow = epoch?.nowMs;
      const result = evalFormula(source, address);
      epochNow = oldNow;
      return result;
    },
    dispose() { cache.clear(); deps.clear(); },
  };
}

export class Engine {
  private constructor(private readonly inner: FormulaEngine) {}
  static create(workbook: Workbook, _options?: unknown): { ok: true; value: Engine } {
    return { ok: true, value: new Engine(createEngine(workbook)) };
  }
  evaluateFormula(source: string, address: CellAddress, epoch?: { nowMs?: number; randomSeed?: number }): ComputedValue {
    return this.inner.evaluateFormula(source, address, epoch);
  }
  dispose(): void { this.inner.dispose(); }
}

export { parseFormula, tokenize, adjustFormulaReferences } from "./syntax.js";
export * from "./functions.js";
export * from "./ast.js";
export * from "./parser.js";
