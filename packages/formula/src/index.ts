import { entries, getCell } from "@openexcel/model";
import type { CellAddress, ComputedValue, Scalar, Workbook, RangeRef, Cell } from "@openexcel/model";
import { parseFormula, type Ast } from "./syntax.js";
import { err, invoke, isArray, isError, num, scalar, createDefaultRegistry } from "./functions.js";

export interface FormulaEngine {
  updateWorkbook(workbook: Workbook): void;
  recalculate(): void;
  value(address: CellAddress): ComputedValue;
  dependencies(address: CellAddress): readonly CellAddress[];
  evaluateFormula(source: string, address: CellAddress, epoch?: { nowMs?: number; randomSeed?: number }): ComputedValue;
  dispose(): void;
}

const key = (a: CellAddress) => `${a.sheetId}:${a.row}:${a.col}`;
const asNumber = num;

export function createEngine(initial: Workbook, options: { nowMs?: number; random?: () => number } = {}): FormulaEngine {
  let workbook = initial;
  const cache = new Map<string, ComputedValue>();
  // Maintain sparse formula and dirty indexes across immutable workbook revisions.
  // A single-cell edit must not enumerate every populated cell during recalculation.
  const formulaIndex = new Map<string, { at: CellAddress; cell: Cell }>();
  const dirty = new Set<string>();
  const volatile = new Set<string>();
  const indexCell = (at: CellAddress, cell: Cell | undefined) => {
    const k = key(at);
    if (cell?.input.kind === "formula") {
      formulaIndex.set(k, {at, cell}); dirty.add(k);
      if (/\b(?:RAND|RANDBETWEEN|NOW|TODAY|OFFSET|INDIRECT)\s*\(/i.test(cell.input.source)) volatile.add(k);
      else volatile.delete(k);
    } else { formulaIndex.delete(k); dirty.delete(k); volatile.delete(k); }
  };
  const rebuildIndex = () => {
    formulaIndex.clear(); dirty.clear(); volatile.clear();
    for (const sheet of Object.values(workbook.sheets))
      for (const {at, cell} of entries(workbook, {sheetId: sheet.id, top: 0, left: 0, bottom: 1048575, right: 16383})) indexCell(at, cell);
  };
  rebuildIndex();
  const deps = new Map<string, CellAddress[]>();
  const active = new Set<string>();
  // Range edges are indexed by 256-row buckets rather than one edge per blank cell.
  const rangeDeps = new Map<string, RangeRef[]>();
  const rangeIndex = new Map<string, Set<string>>();
  let suppressDependency: string | undefined;
  const rangeBucket = (sheetId: string, row: number) => `${sheetId}:${Math.floor(row / 256)}`;
  const addRange = (owner: string, range: RangeRef) => {
    const ranges = rangeDeps.get(owner) ?? [];
    ranges.push(range); rangeDeps.set(owner, ranges);
    for (let row = Math.floor(range.top / 256) * 256; row <= range.bottom; row += 256) {
      const bucket = rangeBucket(range.sheetId, row);
      const members = rangeIndex.get(bucket) ?? new Set<string>();
      members.add(owner); rangeIndex.set(bucket, members);
    }
  };
  const rangeDependents = (k: string): string[] => {
    const at = addresses.get(k);
    if (!at) return [];
    return [...(rangeIndex.get(rangeBucket(at.sheetId, at.row)) ?? [])].filter(owner =>
      rangeDeps.get(owner)?.some(range => range.sheetId === at.sheetId && at.row >= range.top && at.row <= range.bottom && at.col >= range.left && at.col <= range.right));
  };
  const reverse = new Map<string, Set<string>>();
  const addresses = new Map<string, CellAddress>();
  const spills = new Map<string, { owner: string; value: Scalar }>();
  const spillChildren = new Map<string, Set<string>>();
  const parsed = new Map<string, Ast>();
  const registry = createDefaultRegistry();
  const stack: string[] = [];
  let steps = 0;
  let lambdaDepth = 0;
  const activeNames = new Set<string>();
  type Closure = { kind: "closure"; parameters: Ast[]; body: Ast; environment: Environment };
  type Environment = Map<string, ComputedValue | Closure>;
  const isClosure = (value: ComputedValue | Closure | undefined): value is Closure => !!value && typeof value === "object" && value.kind === "closure";
  const closure = (ast: Ast, env: Environment): Closure | undefined => ast.kind === "call" && ast.name === "LAMBDA" && ast.args.length
    ? {kind: "closure", parameters: ast.args.slice(0,-1), body: ast.args.at(-1)!, environment: new Map(env)} : undefined;
  let epochRandom: (() => number) | undefined;
  const parse = (source: string) => {
    let ast = parsed.get(source);
    if (!ast) { ast = parseFormula(source); if (parsed.size > 100_000) parsed.clear(); parsed.set(source, ast); }
    return ast;
  };
  const addDependency = (owner: string, address: CellAddress) => {
    const target = key(address);
    addresses.set(target, address);
    let dependents = reverse.get(target);
    if (!dependents) reverse.set(target, dependents = new Set());
    if (!dependents.has(owner)) {
      dependents.add(owner);
      const list = deps.get(owner) ?? [];
      list.push(address); deps.set(owner, list);
    }
  };
  const clearDependencies = (owner: string) => {
    for (const address of deps.get(owner) ?? []) {
      const target = key(address), dependents = reverse.get(target);
      dependents?.delete(owner);
      if (dependents?.size === 0) reverse.delete(target);
    }
    deps.delete(owner);
    for (const range of rangeDeps.get(owner) ?? []) {
      for (let row = Math.floor(range.top / 256) * 256; row <= range.bottom; row += 256) {
        const bucket = rangeBucket(range.sheetId, row), members = rangeIndex.get(bucket);
        members?.delete(owner); if (!members?.size) rangeIndex.delete(bucket);
      }
    }
    rangeDeps.delete(owner);
  };
  /** Invalidate transitively before removing spill edges, so dependents of spill children are included. */
  const invalidate = (roots: Iterable<string>) => {
    const queue = [...roots], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i]!;
      for (const next of [...(reverse.get(k) ?? []), ...rangeDependents(k), ...(spillChildren.get(k) ?? [])]) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
      cache.delete(k);
      if (formulaIndex.has(k)) dirty.add(k);
      for (const child of spillChildren.get(k) ?? []) spills.delete(child);
      spillChildren.delete(k);
    }
  };
  let epochNow: number | undefined;
  const now = () => epochNow ?? options.nowMs ?? Date.now();
  const random = options.random ?? Math.random;

  const resolveSheet = (address: CellAddress, sheetName?: string) => {
    if (!sheetName) return address.sheetId;
    const found = Object.values(workbook.sheets).find((sheet) => sheet.properties.name.toLowerCase() === sheetName.toLowerCase());
    if (!found) throw err("#REF!");
    return found.id;
  };
  const structuredRange = (ast: Extract<Ast, {kind: "structured"}>, address: CellAddress): RangeRef | undefined => {
    const candidates = Object.values(workbook.sheets).flatMap(sheet => sheet.properties.tables.map(table => ({table, sheetId: sheet.id})));
    const found = candidates.find(({table, sheetId}) => ast.table
      ? table.name.toLowerCase() === ast.table.toLowerCase()
      : sheetId === address.sheetId && address.row >= table.range.top && address.row <= table.range.bottom && address.col >= table.range.left && address.col <= table.range.right);
    if (!found) return undefined;
    const {table, sheetId} = found;
    const parts = ast.spec.replace(/^\[|\]$/g, "").replace(/\[|\]/g, "").split(",").map(part => part.trim());
    let top = table.range.top + 1, bottom = table.range.bottom - Number(table.totalsRow);
    let left = table.range.left, right = table.range.right;
    for (const part of parts) {
      const selector = part.toLowerCase();
      if (selector === "#all") { top = table.range.top; bottom = table.range.bottom; }
      else if (selector === "#data") { top = table.range.top + 1; bottom = table.range.bottom - Number(table.totalsRow); }
      else if (selector === "#headers") top = bottom = table.range.top;
      else if (selector === "#totals") { if (!table.totalsRow) return undefined; top = bottom = table.range.bottom; }
      else {
        if (part.startsWith("@") || selector === "#this row") {
          if (address.sheetId !== sheetId || address.row <= table.range.top || address.row > table.range.bottom - Number(table.totalsRow)) return undefined;
          top = bottom = address.row;
        }
        const column = part.startsWith("@") ? part.slice(1) : selector === "#this row" ? "" : part;
        if (column) {
          const index = table.columns.findIndex(item => item.name.toLowerCase() === column.toLowerCase());
          if (index < 0) return undefined;
          left = right = table.range.left + index;
        }
      }
    }
    return bottom < top ? undefined : {sheetId, top, bottom, left, right};
  };
  const evalAst = (ast: Ast, address: CellAddress, env: Environment = new Map()): ComputedValue => {
    if (++steps > 2_000_000) throw err("#CALC!");
    switch (ast.kind) {
      case "structured": {
        const range = structuredRange(ast, address);
        if (!range) return err("#REF!");
        const sheet = workbook.sheets[range.sheetId]!.properties.name;
        return evalAst({kind:"range",from:{kind:"ref",sheet,row:range.top,col:range.left,absoluteRow:true,absoluteCol:true},to:{kind:"ref",sheet,row:range.bottom,col:range.right,absoluteRow:true,absoluteCol:true}},address,env);
      }
      case "apply": {
        const local = ast.fn.kind === "name" ? env.get(ast.fn.name.toLowerCase()) : undefined;
        const fn = isClosure(local) ? local : closure(ast.fn, env);
        return fn ? applyLambda(fn, ast.args, address, env) : err("#VALUE!");
      }
      case "literal": return ast.value;
      case "name": {
        const local = env.get(ast.name.toLowerCase());
        if (local !== undefined) return isClosure(local) ? err("#CALC!") : local;
        const name = workbook.names.find((n) => n.name.toLowerCase() === ast.name.toLowerCase() &&
          (n.scope === null || n.scope === address.sheetId));
        if (!name) return err("#NAME?");
        const nameKey = `${name.scope}:${name.name.toLowerCase()}`;
        if (activeNames.has(nameKey)) return err("#CIRC!");
        activeNames.add(nameKey);
        try { return evalFormula(name.formula, address); }
        finally { activeNames.delete(nameKey); }
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
        if ((bottom - top + 1) * (right - left + 1) > 1_000_000) return err("#CALC!");
        const values: Scalar[] = [];
        const owner = stack.at(-1), previous = suppressDependency;
        if (owner) { addRange(owner, {sheetId, top, bottom, left, right}); suppressDependency = owner; }
        try { for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) values.push(scalar(read({ sheetId, row, col }))); }
        finally { suppressDependency = previous; }
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
          const left = isArray(leftValue) ? leftValue : { rows: 1, cols: 1, values: [scalar(leftValue)] };
          const right = isArray(rightValue) ? rightValue : { rows: 1, cols: 1, values: [scalar(rightValue)] };
          const rows = Math.max(left.rows, right.rows), cols = Math.max(left.cols, right.cols);
          if ((left.rows !== rows && left.rows !== 1) || (right.rows !== rows && right.rows !== 1) ||
              (left.cols !== cols && left.cols !== 1) || (right.cols !== cols && right.cols !== 1) || rows * cols > 1_000_000) return err("#VALUE!");
          const values: Scalar[] = [];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const l = left.values[(r % left.rows) * left.cols + c % left.cols] ?? null;
            const v = right.values[(r % right.rows) * right.cols + c % right.cols] ?? null;
            try { values.push(scalar(evalAst({kind: "binary", op: ast.op, left: {kind: "literal", value: l}, right: {kind: "literal", value: v}}, address, env))); }
            catch (error) { values.push(isError(error) ? error : err("#VALUE!")); }
          }
          return { kind: "array", rows, cols, values };
        }
        const left = scalar(leftValue), right = scalar(rightValue);
        if (typeof left === "object" && left?.kind === "error") return left;
        if (typeof right === "object" && right?.kind === "error") return right;
        switch (ast.op) {
          case "+": return asNumber(left) + asNumber(right);
          case "-": return asNumber(left) - asNumber(right);
          case "*": return asNumber(left) * asNumber(right);
          case "/": return asNumber(right) === 0 ? err("#DIV/0!") : asNumber(left) / asNumber(right);
          case "^": { const result = asNumber(left) ** asNumber(right); return Number.isFinite(result) ? result : err("#NUM!"); }
          case "&": return `${left ?? ""}${right ?? ""}`;
          case "=": return typeof left === "string" && typeof right === "string" ? left.toLowerCase() === right.toLowerCase() : left === right;
          case "<>": return typeof left === "string" && typeof right === "string" ? left.toLowerCase() !== right.toLowerCase() : left !== right;
          case "<": return asNumber(left) < asNumber(right);
          case ">": return asNumber(left) > asNumber(right);
          case "<=": return asNumber(left) <= asNumber(right);
          case ">=": return asNumber(left) >= asNumber(right);
          default: return err("#VALUE!");
        }
      }
      case "call": {
        const localFn = env.get(ast.name.toLowerCase());
        if (isClosure(localFn)) return applyLambda(localFn, ast.args, address, env);
        const definition = registry.get(ast.name);
        if (!definition) {
          const named = workbook.names.find(name => name.name.toUpperCase() === ast.name && (name.scope === null || name.scope === address.sheetId));
          const fn = named ? closure(parse(named.formula), env) : undefined;
          return fn ? applyLambda(fn, ast.args, address, env) : err("#NAME?");
        }
        if (definition && (ast.args.length < definition.minArgs || (definition.maxArgs !== null && ast.args.length > definition.maxArgs))) return err("#VALUE!");
        const argument = (i: number, fallback: ComputedValue = false) => ast.args[i] ? evalAst(ast.args[i]!, address, env) : fallback;
        if (ast.name === "IF") {
          const test = argument(0);
          if (isArray(test)) {
            // Evaluate each branch only when a non-error element selects it.
            let yes: ComputedValue | undefined, no: ComputedValue | undefined;
            const pick = (value: ComputedValue, r: number, c: number): Scalar => {
              if (!isArray(value)) return value;
              if ((value.rows !== 1 && value.rows !== test.rows) || (value.cols !== 1 && value.cols !== test.cols)) return err("#VALUE!");
              return value.values[(r % value.rows) * value.cols + c % value.cols] ?? null;
            };
            const values = test.values.map((condition, i) => {
              if (isError(condition)) return condition;
              try {
                const positive = asNumber(condition) !== 0;
                const result = positive ? (yes ??= argument(1)) : (no ??= argument(2));
                return pick(result, Math.floor(i / test.cols), i % test.cols);
              } catch (error) { return isError(error) ? error : err("#VALUE!"); }
            });
            return {...test, values};
          }
          const condition = scalar(test);
          if (isError(condition)) return condition;
          return argument(asNumber(condition) ? 1 : 2);
        }
        if (ast.name === "IFERROR" || ast.name === "IFNA") {
          let value: ComputedValue;
          try { value = argument(0); } catch (error) { value = isError(error) ? error : err("#VALUE!"); }
          if (isArray(value)) {
            let replacement: ComputedValue | undefined;
            return {...value, values: value.values.map((item, i) => {
              if (!isError(item) || ast.name === "IFNA" && item.code !== "#N/A") return item;
              replacement ??= argument(1);
              return isArray(replacement) ? replacement.values[i] ?? err("#N/A") : replacement;
            })};
          }
          const first = scalar(value);
          return isError(first) && (ast.name === "IFERROR" || first.code === "#N/A") ? argument(1) : value;
        }
        if (ast.name === "IFS") {
          if (ast.args.length % 2) return err("#VALUE!");
          for (let i = 0; i < ast.args.length; i += 2) {
            const condition = scalar(argument(i));
            if (isError(condition)) return condition;
            if (asNumber(condition)) return argument(i + 1);
          }
          return err("#N/A");
        }
        if (ast.name === "SWITCH") {
          const target = scalar(argument(0));
          if (isError(target)) return target;
          for (let i = 1; i + 1 < ast.args.length; i += 2) if (scalar(argument(i)) === target) return argument(i + 1);
          return ast.args.length % 2 === 0 ? argument(ast.args.length - 1) : err("#N/A");
        }
        if (ast.name === "INDIRECT") {
          if (ast.args[1] && !asNumber(argument(1))) return err("#REF!");
          const reference = scalar(evalAst(ast.args[0]!, address, env));
          if (typeof reference !== "string") return err("#REF!");
          try {
            const referenceAst = parse(reference);
            if (referenceAst.kind !== "ref" && referenceAst.kind !== "range") return err("#REF!");
            return evalAst(referenceAst, address, env);
          } catch { return err("#REF!"); }
        }
        if (ast.name === "OFFSET") {
          const first = ast.args[0];
          const origin = first?.kind === "ref" ? first : first?.kind === "range" && first.from.kind === "ref" ? first.from : undefined;
          const baseRows = first?.kind === "range" && first.from.kind === "ref" && first.to.kind === "ref" ? Math.abs(first.to.row - first.from.row) + 1 : 1;
          const baseCols = first?.kind === "range" && first.from.kind === "ref" && first.to.kind === "ref" ? Math.abs(first.to.col - first.from.col) + 1 : 1;
          if (!origin || origin.kind !== "ref") return err("#REF!");
          const row = origin.row + Math.trunc(asNumber(evalAst(ast.args[1]!, address, env)));
          const col = origin.col + Math.trunc(asNumber(evalAst(ast.args[2]!, address, env)));
          const height = ast.args[3] ? Math.trunc(asNumber(evalAst(ast.args[3]!, address, env))) : baseRows;
          const width = ast.args[4] ? Math.trunc(asNumber(evalAst(ast.args[4]!, address, env))) : baseCols;
          if (row < 0 || col < 0 || height < 1 || width < 1 || row + height > 1048576 || col + width > 16384 || height * width > 1_000_000) return err("#REF!");
          const values: Scalar[] = [];
          for (let r = row; r < row + height; r++) for (let c = col; c < col + width; c++) values.push(scalar(read({ sheetId: resolveSheet(address, origin.sheet), row: r, col: c })));
          return { kind: "array", rows: height, cols: width, values };
        }
        if (ast.name === "CHOOSE") {
          const index = Math.trunc(asNumber(evalAst(ast.args[0] ?? { kind: "literal", value: 0 }, address, env)));
          if (index < 1 || index >= ast.args.length) return err("#VALUE!");
          return evalAst(ast.args[index]!, address, env);
        }
        if (ast.name === "LET") {
          if (ast.args.length % 2 === 0) return err("#VALUE!");
          const local = new Map(env);
          for (let i = 0; i + 1 < ast.args.length - 1; i += 2) {
            const binding = ast.args[i];
            if (binding?.kind !== "name") return err("#NAME?");
            local.set(binding.name.toLowerCase(), closure(ast.args[i + 1]!, local) ?? evalAst(ast.args[i + 1]!, address, local));
          }
          return evalAst(ast.args.at(-1)!, address, local);
        }
        const args = ast.args.map((arg) => evalAst(arg, address, env));
        if (ast.name === "LAMBDA") return err("#CALC!");
        if (ast.name === "INDIRECT" || ast.name === "OFFSET") return err("#REF!");
        const result = invoke(ast.name, args, now(), epochRandom ?? random);
        return typeof result === "number" && !Number.isFinite(result) ? err("#NUM!") : result;
      }
    }
  };
  const applyLambda = (fn: Closure, args: Ast[], address: CellAddress, caller: Environment): ComputedValue => {
    if (args.length !== fn.parameters.length) return err("#VALUE!");
    if (lambdaDepth >= 64) return err("#NUM!");
    const env = new Map(fn.environment);
    for (let i = 0; i < args.length; i++) {
      const parameter = fn.parameters[i]!;
      if (parameter.kind !== "name") return err("#NAME?");
      env.set(parameter.name.toLowerCase(), evalAst(args[i]!, address, caller));
    }
    lambdaDepth++;
    try { return evalAst(fn.body, address, env); }
    finally { lambdaDepth--; }
  };
  const evalFormula = (source: string, address: CellAddress): ComputedValue => {
    try {
      return evalAst(parse(source), address);
    }
    catch (error) { return error && typeof error === "object" && "code" in error ? error as ComputedValue : err("#PARSE!"); }
  };
  const read = (address: CellAddress): ComputedValue => {
    if (!workbook.sheets[address.sheetId] || address.row < 0 || address.col < 0 || address.row >= 1048576 || address.col >= 16384) return err("#REF!");
    const k = key(address), parent = stack.at(-1);
    if (parent && parent !== suppressDependency) addDependency(parent, address);
    if (cache.has(k)) return cache.get(k)!;
    const spill = spills.get(k);
    if (spill) return spill.value;
    if (active.has(k)) return err("#CIRC!");
    if (stack.length > 256) return err("#CALC!");
    if (!stack.length) steps = 0;
    const plainCell = getCell(workbook, address);
    if (!plainCell) return null;
    if (plainCell.input.kind === "value") return plainCell.input.value;
    addresses.set(k, address);
    clearDependencies(k);
    active.add(k); stack.push(k);
    const cell = getCell(workbook, address);
    let value: ComputedValue;
    try {
      value = !cell ? null : cell.input.kind === "formula" ? evalFormula(cell.input.source, address) : cell.input.value;
      if (isArray(value)) {
        const children: { address: CellAddress; value: Scalar }[] = [];
        let blocked = address.row + value.rows > 1048576 || address.col + value.cols > 16384;
        for (let r = 0; r < value.rows && !blocked; r++) for (let c = 0; c < value.cols; c++) {
          if (!r && !c) continue;
          const child = { sheetId: address.sheetId, row: address.row + r, col: address.col + c };
          const existing = getCell(workbook, child);
          addDependency(k, child); // An edit inside a spill must invalidate its anchor.
          if (existing && (existing.input.kind === "formula" || existing.input.value !== null) || spills.has(key(child))) { blocked = true; break; }
          children.push({address: child, value: value.values[r * value.cols + c] ?? null});
        }
        if (blocked) value = err("#SPILL!");
        else {
          spillChildren.set(k, new Set(children.map(child => key(child.address))));
          for (const child of children) {
            const ck = key(child.address);
            // A spill can appear after a consumer already read this formerly blank cell.
            const consumers = [...(reverse.get(ck) ?? []), ...rangeDependents(ck)].filter(owner => owner !== k && cache.has(owner));
            invalidate(consumers);
            cache.delete(ck); spills.set(ck, {owner: k, value: child.value});
          }
        }
      }
    } finally { active.delete(k); stack.pop(); }
    cache.set(k, value!);
    dirty.delete(k);
    return value!;
  };
  return {
    updateWorkbook(next) {
      if (next === workbook) return;
      const changed = new Set<string>();
      let structural = next.names !== workbook.names || next.sheetOrder.length !== workbook.sheetOrder.length;
      for (const sheetId of new Set([...Object.keys(workbook.sheets), ...Object.keys(next.sheets)])) {
        const before = workbook.sheets[sheetId], after = next.sheets[sheetId];
        if (!before || !after || before.properties.name !== after.properties.name || before.properties.tables !== after.properties.tables) structural = true;
        for (const tileKey of new Set([...Object.keys(before?.tiles ?? {}), ...Object.keys(after?.tiles ?? {})])) {
          const oldTile = before?.tiles[tileKey as keyof typeof before.tiles], newTile = after?.tiles[tileKey as keyof typeof after.tiles];
          if (oldTile === newTile) continue;
          for (const cellKey of new Set([...Object.keys(oldTile ?? {}), ...Object.keys(newTile ?? {})])) {
            const oldCell = oldTile?.[cellKey as keyof typeof oldTile], newCell = newTile?.[cellKey as keyof typeof newTile];
            if (oldCell?.input !== newCell?.input && JSON.stringify(oldCell?.input) !== JSON.stringify(newCell?.input)) {
              const k = `${sheetId}:${cellKey}`, [row, col] = cellKey.split(":").map(Number);
              const at = {sheetId: (after ?? before)!.id, row: row!, col: col!};
              changed.add(k); addresses.set(k, at); indexCell(at, newCell);
            }
          }
        }
      }
      workbook = next;
      if (structural) { cache.clear(); deps.clear(); reverse.clear(); rangeDeps.clear(); rangeIndex.clear(); spills.clear(); spillChildren.clear(); rebuildIndex(); }
      else invalidate(changed);
    },
    recalculate() {
      invalidate(volatile);
      // Ordinary formulas are read in dependency order without consuming the JavaScript call stack.
      // Dynamic references are discovered during evaluation and tracked for later invalidation.
      for (let pass = 0; dirty.size && pass < 100; pass++) {
      const pending = new Map([...dirty].flatMap(k => { const item = formulaIndex.get(k); return item ? [[k, item] as const] : []; }));
      const visiting = new Set<string>(), done = new Set<string>();
      const directRefs = (ast: Ast, at: CellAddress, output: CellAddress[]) => {
        if (ast.kind === "structured") {
          const range = structuredRange(ast, at);
          if (range) for (const entry of entries(workbook, range)) if (entry.cell.input.kind === "formula") output.push(entry.at);
        }
        else if (ast.kind === "ref") output.push({sheetId: resolveSheet(at, ast.sheet), row: ast.row, col: ast.col});
        else if (ast.kind === "binary") { directRefs(ast.left, at, output); directRefs(ast.right, at, output); }
        else if (ast.kind === "range" && ast.from.kind === "ref" && ast.to.kind === "ref") {
          const sheetId = resolveSheet(at, ast.from.sheet), top = Math.min(ast.from.row, ast.to.row), bottom = Math.max(ast.from.row, ast.to.row), left = Math.min(ast.from.col, ast.to.col), right = Math.max(ast.from.col, ast.to.col);
          for (const entry of entries(workbook, {sheetId, top, bottom, left, right})) if (entry.cell.input.kind === "formula") output.push(entry.at);
        }
        else if (ast.kind === "unary") directRefs(ast.arg, at, output);
        else if (ast.kind === "call") ast.args.forEach(arg => directRefs(arg, at, output));
      };
      for (const [root] of pending) {
        const work: { k: string; exit: boolean }[] = [{k: root, exit: false}];
        while (work.length) {
          const item = work.pop()!, entry = pending.get(item.k);
          if (!entry || done.has(item.k)) continue;
          if (item.exit) { read(entry.at); visiting.delete(item.k); done.add(item.k); continue; }
          if (visiting.has(item.k)) continue;
          visiting.add(item.k); work.push({k: item.k, exit: true});
          const references: CellAddress[] = [];
          try { if (entry.cell.input.kind === "formula") directRefs(parse(entry.cell.input.source), entry.at, references); } catch { /* Evaluation produces the typed error. */ }
          for (const reference of references) if (pending.has(key(reference)) && !visiting.has(key(reference))) work.push({k: key(reference), exit: false});
        }
      }
      }
    },
    value: read,
    dependencies(address) {
      const owner = key(address), output = [...(deps.get(owner) ?? [])];
      for (const range of rangeDeps.get(owner) ?? []) for (let row = range.top; row <= range.bottom; row++) for (let col = range.left; col <= range.right; col++) output.push({sheetId: range.sheetId, row, col});
      return output;
    },
    evaluateFormula(source, address, epoch) {
      const oldNow = epochNow, oldRandom = epochRandom;
      epochNow = epoch?.nowMs; steps = 0;
      if (epoch?.randomSeed !== undefined) {
        let seed = epoch.randomSeed >>> 0;
        epochRandom = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      }
      try { return evalFormula(source, address); }
      finally { epochNow = oldNow; epochRandom = oldRandom; }
    },
    dispose() { cache.clear(); deps.clear(); reverse.clear(); rangeDeps.clear(); rangeIndex.clear(); spills.clear(); spillChildren.clear(); parsed.clear(); addresses.clear(); formulaIndex.clear(); dirty.clear(); volatile.clear(); },
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
