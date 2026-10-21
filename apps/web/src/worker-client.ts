import {
  getCell,
  type CellAddress,
  type ErrorCode,
  type ErrorValue,
  type Scalar,
  type SheetId,
  type Workbook,
} from '@openexcel/model';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WorkerRequestMessage {
  id: number;
  workbook?: Workbook | undefined;
  addresses: CellAddress[];
}

export interface WorkerResponseMessage {
  id: number;
  values?: Record<string, Scalar> | undefined;
  error?: string | undefined;
}

export type WorkerActionType = 'init' | 'edit' | 'recalculate' | 'getVisibleValues';

export type WorkerClientMessage =
  | { type: 'init'; workbook: Workbook }
  | { type: 'edit'; workbook: Workbook; addresses: CellAddress[] }
  | { type: 'recalculate'; workbook?: Workbook | undefined; addresses?: CellAddress[] | undefined }
  | { type: 'getVisibleValues'; workbook: Workbook; addresses: CellAddress[] };

export function cellAddressKey(address: CellAddress): string {
  return `${address.sheetId}/${address.row}:${address.col}`;
}

// ============================================================================
// Simple Evaluator (AST, Lexer, Parser, Evaluator)
// ============================================================================

type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'BOOLEAN'
  | 'IDENT'
  | 'CELL'
  | 'RANGE'
  | 'COMMA'
  | 'LPAREN'
  | 'RPAREN'
  | 'OP'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  num?: number | undefined;
}

interface CellRefParsed {
  sheetName?: string | undefined;
  row: number;
  col: number;
}

interface RangeRefParsed {
  sheetName?: string | undefined;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

type ExprNode =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'error'; code: ErrorCode; message?: string | undefined }
  | { kind: 'cell'; ref: CellRefParsed }
  | { kind: 'range'; ref: RangeRefParsed }
  | { kind: 'unary'; op: '+' | '-'; expr: ExprNode }
  | {
      kind: 'binary';
      op: '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';
      left: ExprNode;
      right: ExprNode;
    }
  | { kind: 'call'; name: string; args: ExprNode[] };

function colLettersToIndex(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function parseCellCoords(ref: string): { row: number; col: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/.exec(ref);
  if (!match || !match[1] || !match[2]) return null;
  const col = colLettersToIndex(match[1].toUpperCase());
  const row = Number(match[2]) - 1;
  return { row, col };
}

function parseFullCellRef(text: string): CellRefParsed | null {
  let sheetName: string | undefined;
  let cellPart = text.trim();

  const bangIdx = cellPart.indexOf('!');
  if (bangIdx !== -1) {
    sheetName = cellPart.slice(0, bangIdx).replace(/^'|'$/g, '');
    cellPart = cellPart.slice(bangIdx + 1);
  }

  const coords = parseCellCoords(cellPart);
  if (!coords) return null;

  return {
    sheetName,
    row: coords.row,
    col: coords.col,
  };
}

function parseFullRangeRef(text: string): RangeRefParsed | null {
  let sheetName: string | undefined;
  let rangePart = text.trim();

  const bangIdx = rangePart.indexOf('!');
  if (bangIdx !== -1) {
    sheetName = rangePart.slice(0, bangIdx).replace(/^'|'$/g, '');
    rangePart = rangePart.slice(bangIdx + 1);
  }

  const colonIdx = rangePart.indexOf(':');
  if (colonIdx === -1) return null;

  const startPart = rangePart.slice(0, colonIdx);
  const endPart = rangePart.slice(colonIdx + 1);

  const startCoords = parseCellCoords(startPart);
  const endCoords = parseCellCoords(endPart);
  if (!startCoords || !endCoords) return null;

  return {
    sheetName,
    top: Math.min(startCoords.row, endCoords.row),
    left: Math.min(startCoords.col, endCoords.col),
    bottom: Math.max(startCoords.row, endCoords.row),
    right: Math.max(startCoords.col, endCoords.col),
  };
}

class Lexer {
  private pos = 0;
  private readonly len: number;

  constructor(private readonly src: string) {
    this.len = src.length;
  }

  private peek(): string {
    return this.pos < this.len ? this.src[this.pos]! : '';
  }

  private next(): string {
    return this.pos < this.len ? this.src[this.pos++]! : '';
  }

  private skipWhitespace(): void {
    while (this.pos < this.len && /\s/.test(this.src[this.pos]!)) {
      this.pos++;
    }
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    this.skipWhitespace();

    while (this.pos < this.len) {
      const ch = this.peek();

      // String literal
      if (ch === '"') {
        this.next(); // consume opening quote
        let val = '';
        while (this.pos < this.len) {
          if (this.peek() === '"') {
            this.next();
            if (this.peek() === '"') {
              val += '"';
              this.next();
            } else {
              break;
            }
          } else {
            val += this.next();
          }
        }
        tokens.push({ type: 'STRING', value: val });
        this.skipWhitespace();
        continue;
      }

      // Quoted sheet name followed by cell/range: 'Sheet 1'!A1 or 'Sheet 1'!A1:B5
      if (ch === "'") {
        let sheetRaw = this.next();
        while (this.pos < this.len) {
          const c = this.next();
          sheetRaw += c;
          if (c === "'" && this.peek() === '!') {
            sheetRaw += this.next(); // consume '!'
            break;
          }
        }
        // consume address part: $?[A-Za-z]+$?[0-9]+(:$?[A-Za-z]+$?[0-9]+)?
        let addrPart = '';
        while (this.pos < this.len && /[A-Za-z0-9_$:!]/.test(this.peek())) {
          addrPart += this.next();
        }
        const full = sheetRaw + addrPart;
        if (full.includes(':')) {
          tokens.push({ type: 'RANGE', value: full });
        } else {
          tokens.push({ type: 'CELL', value: full });
        }
        this.skipWhitespace();
        continue;
      }

      // Numeric literal
      if (/\d/.test(ch) || (ch === '.' && /\d/.test(this.src[this.pos + 1] ?? ''))) {
        let numStr = '';
        while (this.pos < this.len && /[\d.]/.test(this.peek())) {
          numStr += this.next();
        }
        tokens.push({ type: 'NUMBER', value: numStr, num: Number(numStr) });
        this.skipWhitespace();
        continue;
      }

      // Operators and punctuation
      if (ch === '(') {
        tokens.push({ type: 'LPAREN', value: this.next() });
        this.skipWhitespace();
        continue;
      }
      if (ch === ')') {
        tokens.push({ type: 'RPAREN', value: this.next() });
        this.skipWhitespace();
        continue;
      }
      if (ch === ',' || ch === ';') {
        tokens.push({ type: 'COMMA', value: this.next() });
        this.skipWhitespace();
        continue;
      }

      // Comparison operators
      if (ch === '<') {
        this.next();
        if (this.peek() === '=') {
          this.next();
          tokens.push({ type: 'OP', value: '<=' });
        } else if (this.peek() === '>') {
          this.next();
          tokens.push({ type: 'OP', value: '<>' });
        } else {
          tokens.push({ type: 'OP', value: '<' });
        }
        this.skipWhitespace();
        continue;
      }
      if (ch === '>') {
        this.next();
        if (this.peek() === '=') {
          this.next();
          tokens.push({ type: 'OP', value: '>=' });
        } else {
          tokens.push({ type: 'OP', value: '>' });
        }
        this.skipWhitespace();
        continue;
      }
      if (ch === '=') {
        this.next();
        tokens.push({ type: 'OP', value: '=' });
        this.skipWhitespace();
        continue;
      }

      // Arithmetic & string operators: + - * / ^ &
      if (['+', '-', '*', '/', '^', '&'].includes(ch)) {
        tokens.push({ type: 'OP', value: this.next() });
        this.skipWhitespace();
        continue;
      }

      // Identifiers, booleans, cell references, ranges
      if (/[A-Za-z_$]/.test(ch)) {
        let ident = '';
        while (this.pos < this.len && /[A-Za-z0-9_$:!]/.test(this.peek())) {
          ident += this.next();
        }

        const upper = ident.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') {
          tokens.push({ type: 'BOOLEAN', value: upper });
        } else if (this.peek() === '(') {
          // Function call
          tokens.push({ type: 'IDENT', value: upper });
        } else if (ident.includes(':')) {
          tokens.push({ type: 'RANGE', value: ident });
        } else if (parseFullCellRef(ident) !== null) {
          tokens.push({ type: 'CELL', value: ident });
        } else {
          tokens.push({ type: 'IDENT', value: upper });
        }
        this.skipWhitespace();
        continue;
      }

      // If unexpected character, advance
      this.next();
      this.skipWhitespace();
    }

    tokens.push({ type: 'EOF', value: '' });
    return tokens;
  }
}

class Parser {
  private current = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.current] ?? { type: 'EOF', value: '' };
  }

  private advance(): Token {
    const tok = this.peek();
    if (tok.type !== 'EOF') this.current++;
    return tok;
  }

  private match(type: TokenType, val?: string): boolean {
    const tok = this.peek();
    if (tok.type === type && (val === undefined || tok.value === val)) {
      this.advance();
      return true;
    }
    return false;
  }

  parse(): ExprNode {
    const expr = this.parseComparison();
    return expr;
  }

  // Precedence: Comparison (=, <>, <, <=, >, >=)
  private parseComparison(): ExprNode {
    let left = this.parseConcat();

    while (['=', '<>', '<', '<=', '>', '>='].includes(this.peek().value) && this.peek().type === 'OP') {
      const op = this.advance().value as '=' | '<>' | '<' | '<=' | '>' | '>=';
      const right = this.parseConcat();
      left = { kind: 'binary', op, left, right };
    }

    return left;
  }

  // Precedence: String concatenation (&)
  private parseConcat(): ExprNode {
    let left = this.parseAddition();

    while (this.peek().type === 'OP' && this.peek().value === '&') {
      this.advance();
      const right = this.parseAddition();
      left = { kind: 'binary', op: '&', left, right };
    }

    return left;
  }

  // Precedence: Addition & Subtraction (+, -)
  private parseAddition(): ExprNode {
    let left = this.parseMultiplication();

    while (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value as '+' | '-';
      const right = this.parseMultiplication();
      left = { kind: 'binary', op, left, right };
    }

    return left;
  }

  // Precedence: Multiplication & Division (*, /)
  private parseMultiplication(): ExprNode {
    let left = this.parseExponentiation();

    while (this.peek().type === 'OP' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.advance().value as '*' | '/';
      const right = this.parseExponentiation();
      left = { kind: 'binary', op, left, right };
    }

    return left;
  }

  // Precedence: Exponentiation (^)
  private parseExponentiation(): ExprNode {
    let left = this.parseUnary();

    while (this.peek().type === 'OP' && this.peek().value === '^') {
      this.advance();
      const right = this.parseUnary();
      left = { kind: 'binary', op: '^', left, right };
    }

    return left;
  }

  // Unary operators: + -
  private parseUnary(): ExprNode {
    if (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value as '+' | '-';
      const expr = this.parseUnary();
      return { kind: 'unary', op, expr };
    }

    return this.parsePrimary();
  }

  // Primary: literals, parentheses, function calls, cell refs, ranges
  private parsePrimary(): ExprNode {
    const tok = this.peek();

    if (tok.type === 'NUMBER') {
      this.advance();
      return { kind: 'number', value: tok.num ?? Number(tok.value) };
    }

    if (tok.type === 'STRING') {
      this.advance();
      return { kind: 'string', value: tok.value };
    }

    if (tok.type === 'BOOLEAN') {
      this.advance();
      return { kind: 'boolean', value: tok.value.toUpperCase() === 'TRUE' };
    }

    if (tok.type === 'CELL') {
      this.advance();
      const parsed = parseFullCellRef(tok.value);
      if (parsed) {
        // Check if next token is colon for range A1:B5
        if (this.match('OP', ':') || this.peek().value === ':') {
          if (this.peek().value === ':') this.advance();
          const nextTok = this.peek();
          if (nextTok.type === 'CELL') {
            this.advance();
            const endParsed = parseFullCellRef(nextTok.value);
            if (endParsed) {
              return {
                kind: 'range',
                ref: {
                  sheetName: parsed.sheetName ?? endParsed.sheetName,
                  top: Math.min(parsed.row, endParsed.row),
                  left: Math.min(parsed.col, endParsed.col),
                  bottom: Math.max(parsed.row, endParsed.row),
                  right: Math.max(parsed.col, endParsed.col),
                },
              };
            }
          }
        }
        return { kind: 'cell', ref: parsed };
      }
      return { kind: 'error', code: '#REF!', message: `Invalid cell reference: ${tok.value}` };
    }

    if (tok.type === 'RANGE') {
      this.advance();
      const parsed = parseFullRangeRef(tok.value);
      if (parsed) {
        return { kind: 'range', ref: parsed };
      }
      return { kind: 'error', code: '#REF!', message: `Invalid range reference: ${tok.value}` };
    }

    // Function call: IDENT '(' ... ')'
    if (tok.type === 'IDENT') {
      this.advance();
      const name = tok.value.toUpperCase();
      if (this.match('LPAREN')) {
        const args: ExprNode[] = [];
        if (!this.match('RPAREN')) {
          while (true) {
            if (this.peek().type === 'COMMA') {
              // Empty argument like IF(condition, , default)
              args.push({ kind: 'null' });
              this.advance();
              continue;
            }
            args.push(this.parseComparison());
            if (this.match('COMMA')) {
              continue;
            }
            if (this.match('RPAREN')) {
              break;
            }
            // Unexpected token, advance to avoid infinite loop
            if (this.peek().type === 'EOF') break;
            this.advance();
          }
        }
        return { kind: 'call', name, args };
      }

      // Unknown identifier without parens
      return { kind: 'error', code: '#NAME?', message: `Unknown identifier: ${tok.value}` };
    }

    if (this.match('LPAREN')) {
      const expr = this.parseComparison();
      this.match('RPAREN');
      return expr;
    }

    // Fallback for unexpected token
    this.advance();
    return { kind: 'null' };
  }
}

function resolveSheetId(
  workbook: Workbook,
  sheetName?: string | undefined,
  currentSheetId?: SheetId | undefined
): SheetId | undefined {
  if (!sheetName) {
    return currentSheetId ?? workbook.properties.activeSheetId;
  }
  const clean = sheetName.toLowerCase();
  for (const sheet of Object.values(workbook.sheets)) {
    if (sheet.properties.name.toLowerCase() === clean || sheet.id.toLowerCase() === clean) {
      return sheet.id;
    }
  }
  return undefined;
}

function isError(val: unknown): val is ErrorValue {
  return typeof val === 'object' && val !== null && (val as ErrorValue).kind === 'error';
}

function scalarAsNumber(val: Scalar): { ok: true; num: number } | { ok: false; err: ErrorValue } {
  if (isError(val)) return { ok: false, err: val };
  if (val === null || val === '') return { ok: true, num: 0 };
  if (typeof val === 'number') return { ok: true, num: val };
  if (typeof val === 'boolean') return { ok: true, num: val ? 1 : 0 };
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return { ok: true, num: 0 };
    const n = Number(trimmed);
    if (Number.isFinite(n)) return { ok: true, num: n };
  }
  return { ok: false, err: { kind: 'error', code: '#VALUE!' } };
}

function scalarAsString(val: Scalar): string {
  if (isError(val)) return val.code;
  if (val === null) return '';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return String(val);
}

export class SimpleEvaluator {
  private workbook: Workbook | null = null;
  private readonly evaluating = new Set<string>();
  private readonly computedCache = new Map<string, Scalar>();

  constructor(workbook?: Workbook) {
    if (workbook) {
      this.updateWorkbook(workbook);
    }
  }

  updateWorkbook(workbook: Workbook): void {
    this.workbook = workbook;
    this.computedCache.clear();
    this.evaluating.clear();
  }

  clearCache(): void {
    this.computedCache.clear();
  }

  evaluateAddress(address: CellAddress): Scalar {
    if (!this.workbook) return null;

    const key = `${address.sheetId}:${address.row}:${address.col}`;

    if (this.evaluating.has(key)) {
      return { kind: 'error', code: '#CIRC!', message: 'Circular reference detected' };
    }

    if (this.computedCache.has(key)) {
      return this.computedCache.get(key)!;
    }

    const cell = getCell(this.workbook, address);
    if (!cell) {
      return null;
    }

    if (cell.input.kind === 'value') {
      return cell.input.value;
    }

    if (cell.input.kind === 'formula') {
      this.evaluating.add(key);
      try {
        const val = this.evaluateFormula(cell.input.source, address);
        this.computedCache.set(key, val);
        return val;
      } finally {
        this.evaluating.delete(key);
      }
    }

    return null;
  }

  evaluateAddresses(addresses: CellAddress[]): Record<string, Scalar> {
    const out: Record<string, Scalar> = {};
    for (const at of addresses) {
      const k = cellAddressKey(at);
      out[k] = this.evaluateAddress(at);
    }
    return out;
  }

  evaluateFormula(source: string, currentAddress: CellAddress): Scalar {
    let code = source.trim();
    if (code.startsWith('=')) {
      code = code.slice(1).trim();
    }
    if (!code) return null;

    try {
      const lexer = new Lexer(code);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const ast = parser.parse();
      const result = this.evalAst(ast, currentAddress);

      if (Array.isArray(result)) {
        return result[0] ?? null;
      }
      return result;
    } catch {
      return { kind: 'error', code: '#PARSE!', message: `Failed to evaluate formula: ${source}` };
    }
  }

  private evalAst(node: ExprNode, currentAddress: CellAddress): Scalar | Scalar[] {
    if (!this.workbook) return null;

    switch (node.kind) {
      case 'number':
        return node.value;
      case 'string':
        return node.value;
      case 'boolean':
        return node.value;
      case 'null':
        return null;
      case 'error':
        return { kind: 'error', code: node.code, ...(node.message ? { message: node.message } : {}) };

      case 'cell': {
        const sheetId = resolveSheetId(this.workbook, node.ref.sheetName, currentAddress.sheetId);
        if (!sheetId) return { kind: 'error', code: '#REF!' };
        return this.evaluateAddress({ sheetId, row: node.ref.row, col: node.ref.col });
      }

      case 'range': {
        const sheetId = resolveSheetId(this.workbook, node.ref.sheetName, currentAddress.sheetId);
        if (!sheetId) return { kind: 'error', code: '#REF!' };
        const values: Scalar[] = [];
        for (let r = node.ref.top; r <= node.ref.bottom; r++) {
          for (let c = node.ref.left; c <= node.ref.right; c++) {
            values.push(this.evaluateAddress({ sheetId, row: r, col: c }));
          }
        }
        return values;
      }

      case 'unary': {
        const val = this.evalAst(node.expr, currentAddress);
        const scalar = Array.isArray(val) ? (val[0] ?? null) : val;
        if (isError(scalar)) return scalar;
        const numResult = scalarAsNumber(scalar);
        if (!numResult.ok) return numResult.err;
        return node.op === '-' ? -numResult.num : numResult.num;
      }

      case 'binary': {
        const lRaw = this.evalAst(node.left, currentAddress);
        const rRaw = this.evalAst(node.right, currentAddress);
        const l = Array.isArray(lRaw) ? (lRaw[0] ?? null) : lRaw;
        const r = Array.isArray(rRaw) ? (rRaw[0] ?? null) : rRaw;

        if (isError(l)) return l;
        if (isError(r)) return r;

        if (node.op === '&') {
          return scalarAsString(l) + scalarAsString(r);
        }

        if (node.op === '=') {
          return this.compareScalars(l, r) === 0;
        }
        if (node.op === '<>') {
          return this.compareScalars(l, r) !== 0;
        }
        if (node.op === '<') {
          return this.compareScalars(l, r) < 0;
        }
        if (node.op === '<=') {
          return this.compareScalars(l, r) <= 0;
        }
        if (node.op === '>') {
          return this.compareScalars(l, r) > 0;
        }
        if (node.op === '>=') {
          return this.compareScalars(l, r) >= 0;
        }

        const lNum = scalarAsNumber(l);
        if (!lNum.ok) return lNum.err;
        const rNum = scalarAsNumber(r);
        if (!rNum.ok) return rNum.err;

        switch (node.op) {
          case '+':
            return lNum.num + rNum.num;
          case '-':
            return lNum.num - rNum.num;
          case '*':
            return lNum.num * rNum.num;
          case '/':
            if (rNum.num === 0) return { kind: 'error', code: '#DIV/0!' };
            return lNum.num / rNum.num;
          case '^': {
            const pow = Math.pow(lNum.num, rNum.num);
            if (!Number.isFinite(pow) || Number.isNaN(pow)) {
              return { kind: 'error', code: '#NUM!' };
            }
            return pow;
          }
        }
        return { kind: 'error', code: '#VALUE!' };
      }

      case 'call': {
        return this.evalFunction(node.name, node.args, currentAddress);
      }
    }
  }

  private compareScalars(a: Scalar, b: Scalar): number {
    if (a === null && b === null) return 0;
    if (a === null) return -1;
    if (b === null) return 1;

    if (typeof a === 'number' && typeof b === 'number') {
      return a === b ? 0 : a < b ? -1 : 1;
    }

    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return a === b ? 0 : !a && b ? -1 : 1;
    }

    const aStr = scalarAsString(a).toLowerCase();
    const bStr = scalarAsString(b).toLowerCase();
    return aStr.localeCompare(bStr);
  }

  private evalFunction(name: string, args: ExprNode[], currentAddress: CellAddress): Scalar {
    const fn = name.toUpperCase();

    // IF(condition, value_if_true, value_if_false)
    if (fn === 'IF') {
      if (args.length === 0) return { kind: 'error', code: '#VALUE!' };
      const condRaw = this.evalAst(args[0]!, currentAddress);
      const cond = Array.isArray(condRaw) ? (condRaw[0] ?? null) : condRaw;
      if (isError(cond)) return cond;

      let isTruthy = false;
      if (typeof cond === 'boolean') isTruthy = cond;
      else if (typeof cond === 'number') isTruthy = cond !== 0;
      else if (typeof cond === 'string') isTruthy = cond.toLowerCase() === 'true' || Number(cond) !== 0;

      if (isTruthy) {
        if (args.length > 1) {
          const res = this.evalAst(args[1]!, currentAddress);
          return Array.isArray(res) ? (res[0] ?? null) : res;
        }
        return true;
      }
      if (args.length > 2) {
        const res = this.evalAst(args[2]!, currentAddress);
        return Array.isArray(res) ? (res[0] ?? null) : res;
      }
      return false;
    }

    // Evaluate arguments for other functions
    const evaluatedArgs: Scalar[] = [];
    for (const arg of args) {
      const val = this.evalAst(arg, currentAddress);
      if (Array.isArray(val)) {
        evaluatedArgs.push(...val);
      } else {
        evaluatedArgs.push(val);
      }
    }

    // Check for propagated errors in args
    for (const val of evaluatedArgs) {
      if (isError(val)) return val;
    }

    switch (fn) {
      case 'SUM': {
        let sum = 0;
        for (const val of evaluatedArgs) {
          if (typeof val === 'number') {
            sum += val;
          } else if (typeof val === 'string' && val.trim() !== '') {
            const n = Number(val);
            if (Number.isFinite(n)) sum += n;
          }
        }
        return sum;
      }

      case 'AVERAGE': {
        let sum = 0;
        let count = 0;
        for (const val of evaluatedArgs) {
          if (typeof val === 'number') {
            sum += val;
            count++;
          } else if (typeof val === 'string' && val.trim() !== '') {
            const n = Number(val);
            if (Number.isFinite(n)) {
              sum += n;
              count++;
            }
          }
        }
        if (count === 0) return { kind: 'error', code: '#DIV/0!' };
        return sum / count;
      }

      case 'COUNT': {
        let count = 0;
        for (const val of evaluatedArgs) {
          if (typeof val === 'number') {
            count++;
          } else if (typeof val === 'string' && val.trim() !== '') {
            const n = Number(val);
            if (Number.isFinite(n)) count++;
          }
        }
        return count;
      }

      case 'MIN': {
        const nums: number[] = [];
        for (const val of evaluatedArgs) {
          if (typeof val === 'number') {
            nums.push(val);
          } else if (typeof val === 'string' && val.trim() !== '') {
            const n = Number(val);
            if (Number.isFinite(n)) nums.push(n);
          }
        }
        if (nums.length === 0) return 0;
        return Math.min(...nums);
      }

      case 'MAX': {
        const nums: number[] = [];
        for (const val of evaluatedArgs) {
          if (typeof val === 'number') {
            nums.push(val);
          } else if (typeof val === 'string' && val.trim() !== '') {
            const n = Number(val);
            if (Number.isFinite(n)) nums.push(n);
          }
        }
        if (nums.length === 0) return 0;
        return Math.max(...nums);
      }

      case 'CONCAT':
      case 'CONCATENATE': {
        return evaluatedArgs.map(scalarAsString).join('');
      }

      default:
        return { kind: 'error', code: '#NAME?', message: `Function ${name} is not supported` };
    }
  }
}

// ============================================================================
// Worker Client Class
// ============================================================================

interface PendingRequest {
  resolve: (values: Record<string, Scalar>) => void;
  reject: (err: Error) => void;
  addresses: CellAddress[];
  timer: ReturnType<typeof setTimeout>;
}

export interface WorkerClientOptions {
  workerTimeoutMs?: number;
  workerUrl?: string | URL;
}

export class WorkerClient {
  private worker: Worker | null = null;
  private readonly localEvaluator: SimpleEvaluator = new SimpleEvaluator();
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private workerFailed = false;
  private currentWorkbook: Workbook | null = null;
  private readonly timeoutMs: number;
  private readonly workerUrl: string | URL;

  constructor(options: WorkerClientOptions = {}) {
    this.timeoutMs = options.workerTimeoutMs ?? 8000;
    this.workerUrl =
      options.workerUrl ?? new URL('./calculation.worker.ts', import.meta.url);
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker === 'undefined') {
      this.workerFailed = true;
      return;
    }

    try {
      this.worker = new Worker(this.workerUrl, { type: 'module' });
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = this.handleError.bind(this);
    } catch {
      this.workerFailed = true;
      this.worker = null;
    }
  }

  private handleMessage(event: MessageEvent<WorkerResponseMessage>): void {
    const { id, values, error } = event.data;
    const req = this.pending.get(id);
    if (!req) return;

    clearTimeout(req.timer);
    this.pending.delete(id);

    if (error !== undefined) {
      // Fallback to local evaluation on worker calculation error
      const fallback = this.localEvaluator.evaluateAddresses(req.addresses);
      req.resolve(fallback);
      return;
    }

    req.resolve(values ?? {});
  }

  private handleError(): void {
    this.workerFailed = true;

    // Fail all pending requests over to local evaluator
    for (const [id, req] of this.pending.entries()) {
      clearTimeout(req.timer);
      const fallback = this.localEvaluator.evaluateAddresses(req.addresses);
      req.resolve(fallback);
      this.pending.delete(id);
    }

    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // Ignore termination errors
      }
      this.worker = null;
    }
  }

  private post(addresses: CellAddress[], workbook?: Workbook): Promise<Record<string, Scalar>> {
    if (workbook) {
      this.currentWorkbook = workbook;
      this.localEvaluator.updateWorkbook(workbook);
    }

    // If worker is unavailable or failed, immediately evaluate locally
    if (this.workerFailed || !this.worker) {
      return Promise.resolve(this.localEvaluator.evaluateAddresses(addresses));
    }

    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Fall back to local evaluation on worker timeout
        const fallback = this.localEvaluator.evaluateAddresses(addresses);
        resolve(fallback);
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, addresses, timer });

      try {
        const msg: WorkerRequestMessage = {
          id,
          addresses,
          ...(workbook ? { workbook } : {}),
        };
        this.worker!.postMessage(msg);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        this.workerFailed = true;
        const fallback = this.localEvaluator.evaluateAddresses(addresses);
        resolve(fallback);
      }
    });
  }

  async init(workbook: Workbook): Promise<Record<string, Scalar>> {
    return this.post([], workbook);
  }

  async edit(workbook: Workbook, addresses: CellAddress[]): Promise<Record<string, Scalar>> {
    return this.post(addresses, workbook);
  }

  async recalculate(
    workbook?: Workbook,
    addresses?: CellAddress[]
  ): Promise<Record<string, Scalar>> {
    return this.post(addresses ?? [], workbook);
  }

  async getVisibleValues(
    workbook: Workbook,
    addresses: CellAddress[]
  ): Promise<Record<string, Scalar>> {
    return this.post(addresses, workbook);
  }

  async sendMessage(msg: WorkerClientMessage): Promise<Record<string, Scalar>> {
    switch (msg.type) {
      case 'init':
        return this.init(msg.workbook);
      case 'edit':
        return this.edit(msg.workbook, msg.addresses);
      case 'recalculate':
        return this.recalculate(msg.workbook, msg.addresses);
      case 'getVisibleValues':
        return this.getVisibleValues(msg.workbook, msg.addresses);
    }
  }

  evaluateLocally(workbook: Workbook, addresses: CellAddress[]): Record<string, Scalar> {
    this.localEvaluator.updateWorkbook(workbook);
    return this.localEvaluator.evaluateAddresses(addresses);
  }

  isWorkerAvailable(): boolean {
    return !this.workerFailed && this.worker !== null;
  }

  getCurrentWorkbook(): Workbook | null {
    return this.currentWorkbook;
  }

  terminate(): void {
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
    }
    this.pending.clear();
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // Ignore errors during termination
      }
      this.worker = null;
    }
  }

  dispose(): void {
    this.terminate();
  }
}

// ============================================================================
// Convenience Exports & Default Instance
// ============================================================================

export const defaultWorkerClient = new WorkerClient();

export const initCalculation = (workbook: Workbook): Promise<Record<string, Scalar>> =>
  defaultWorkerClient.init(workbook);

export const editCalculation = (
  workbook: Workbook,
  addresses: CellAddress[]
): Promise<Record<string, Scalar>> => defaultWorkerClient.edit(workbook, addresses);

export const recalculate = (
  workbook?: Workbook,
  addresses?: CellAddress[]
): Promise<Record<string, Scalar>> => defaultWorkerClient.recalculate(workbook, addresses);

export const getVisibleValues = (
  workbook: Workbook,
  addresses: CellAddress[]
): Promise<Record<string, Scalar>> => defaultWorkerClient.getVisibleValues(workbook, addresses);

export function evaluateFormulaSimple(
  source: string,
  workbook: Workbook,
  currentAddress: CellAddress
): Scalar {
  const evaluator = new SimpleEvaluator(workbook);
  return evaluator.evaluateFormula(source, currentAddress);
}

export default defaultWorkerClient;
