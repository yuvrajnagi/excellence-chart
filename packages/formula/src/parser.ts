import type { ErrorCode } from '@openexcel/model';
import type {
  ArrayLiteralNode,
  AstNode,
  BinaryOpNode,
  BooleanLiteral,
  CellRefNode,
  EmptyLiteral,
  ErrorLiteral,
  FunctionCallNode,
  NameRefNode,
  NumberLiteral,
  ParenNode,
  RangeRefNode,
  StringLiteral,
  UnaryOpNode,
} from './ast.js';
import { tokenize, type Token, type TokenKind } from './lexer.js';

const CELL_REF_REGEX = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;

/**
 * Converts a 0-based column index to Excel column letters (0='A', 25='Z', 26='AA').
 */
export function colToLetters(col: number): string {
  if (!Number.isInteger(col) || col < 0 || col > 16383) {
    throw new Error(`Invalid column index: ${col}`);
  }
  let letters = '';
  let c = col + 1;
  while (c > 0) {
    const rem = (c - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    c = Math.floor((c - 1) / 26);
  }
  return letters;
}

/**
 * Converts Excel column letters to a 0-based column index ('A'=0, 'Z'=25, 'AA'=26).
 */
export function lettersToCol(letters: string): number {
  if (!letters || !/^[A-Za-z]+$/.test(letters)) {
    throw new Error(`Invalid column letters: "${letters}"`);
  }
  const upper = letters.toUpperCase();
  let col = 0;
  for (let i = 0; i < upper.length; i++) {
    col = col * 26 + (upper.charCodeAt(i) - 64);
  }
  return col - 1;
}

interface ParsedCellRef {
  readonly row: number; // 0-based
  readonly col: number; // 0-based
  readonly absRow: boolean;
  readonly absCol: boolean;
}

function tryParseCellRef(text: string): ParsedCellRef | null {
  const match = CELL_REF_REGEX.exec(text);
  if (!match) return null;
  const colLetters = match[2]!;
  const rowDigits = match[4]!;

  const col = lettersToCol(colLetters);
  if (col < 0 || col >= 16384) {
    return null;
  }

  const rowNum = parseInt(rowDigits, 10);
  if (!Number.isSafeInteger(rowNum) || rowNum < 1 || rowNum > 1048576) {
    return null;
  }

  return {
    row: rowNum - 1,
    col,
    absCol: match[1] === '$',
    absRow: match[3] === '$',
  };
}

class Parser {
  private readonly tokens: readonly Token[];
  private pos = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  private check(...kinds: TokenKind[]): boolean {
    return kinds.includes(this.peek().kind);
  }

  private match(...kinds: TokenKind[]): boolean {
    if (this.check(...kinds)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private take(): Token {
    return this.tokens[this.pos++]!;
  }

  private expect(kind: TokenKind, message?: string): Token {
    const cur = this.peek();
    if (cur.kind !== kind) {
      throw new Error(
        message ?? `Expected token ${kind} but found '${cur.value || cur.kind}' at position ${cur.start}`
      );
    }
    return this.take();
  }

  public parseRoot(): AstNode {
    if (this.peek().kind === 'EOF') {
      throw new Error('Empty formula');
    }
    const expr = this.parseComparison();
    if (this.peek().kind !== 'EOF') {
      const remaining = this.peek();
      throw new Error(`Unexpected token '${remaining.value}' at position ${remaining.start}`);
    }
    return expr;
  }

  /**
   * Level 1: Comparison (=, <>, <, <=, >, >=) - left-associative
   */
  private parseComparison(): AstNode {
    let left = this.parseConcatenation();
    while (this.check('EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE')) {
      const opToken = this.take();
      const op = opToken.value as '=' | '<>' | '<' | '<=' | '>' | '>=';
      const right = this.parseConcatenation();
      left = {
        kind: 'binary',
        op,
        left,
        right,
      };
    }
    return left;
  }

  /**
   * Level 2: Concatenation (&) - left-associative
   */
  private parseConcatenation(): AstNode {
    let left = this.parseAddition();
    while (this.check('AMPERSAND')) {
      this.take();
      const right = this.parseAddition();
      left = {
        kind: 'binary',
        op: '&',
        left,
        right,
      };
    }
    return left;
  }

  /**
   * Level 3: Addition and Subtraction (+, -) - left-associative
   */
  private parseAddition(): AstNode {
    let left = this.parseMultiplication();
    while (this.check('PLUS', 'MINUS')) {
      const op = this.take().value as '+' | '-';
      const right = this.parseMultiplication();
      left = {
        kind: 'binary',
        op,
        left,
        right,
      };
    }
    return left;
  }

  /**
   * Level 4: Multiplication and Division (*, /) - left-associative
   */
  private parseMultiplication(): AstNode {
    let left = this.parseExponentiation();
    while (this.check('STAR', 'SLASH')) {
      const op = this.take().value as '*' | '/';
      const right = this.parseExponentiation();
      left = {
        kind: 'binary',
        op,
        left,
        right,
      };
    }
    return left;
  }

  /**
   * Level 5: Exponentiation (^) - right-associative
   */
  private parseExponentiation(): AstNode {
    const left = this.parseUnary();
    if (this.check('CARET')) {
      this.take();
      const right = this.parseExponentiation();
      return {
        kind: 'binary',
        op: '^',
        left,
        right,
      };
    }
    return left;
  }

  /**
   * Level 6: Unary prefix (+, -)
   */
  private parseUnary(): AstNode {
    if (this.check('PLUS')) {
      this.take();
      return {
        kind: 'unary',
        op: '+',
        operand: this.parseUnary(),
      };
    }
    if (this.check('MINUS')) {
      this.take();
      return {
        kind: 'unary',
        op: '-',
        operand: this.parseUnary(),
      };
    }
    return this.parsePostfix();
  }

  /**
   * Level 7: Postfix %
   */
  private parsePostfix(): AstNode {
    let operand = this.parseAtom();
    while (this.check('PERCENT')) {
      this.take();
      operand = {
        kind: 'unary',
        op: '%',
        operand,
      };
    }
    return operand;
  }

  /**
   * Level 8: Atoms
   */
  private parseAtom(): AstNode {
    const token = this.peek();

    // 1. Number literal
    if (token.kind === 'NUMBER') {
      this.take();
      const val = Number(token.value);
      if (!Number.isFinite(val)) {
        throw new Error(`Invalid number '${token.value}' at position ${token.start}`);
      }
      return { kind: 'number', value: val };
    }

    // 2. String literal
    if (token.kind === 'STRING') {
      this.take();
      const raw = token.value;
      const unquoted = raw.slice(1, -1).replace(/""/g, '"');
      return { kind: 'string', value: unquoted };
    }

    // 3. Error literal
    if (token.kind === 'ERROR') {
      this.take();
      return { kind: 'error', code: token.value.toUpperCase() as ErrorCode };
    }

    // 4. Boolean literal (or function call if followed by LPAREN)
    if (token.kind === 'BOOLEAN') {
      this.take();
      if (this.check('LPAREN')) {
        return this.parseFunctionCall(token.value.toUpperCase());
      }
      return { kind: 'boolean', value: token.value.toUpperCase() === 'TRUE' };
    }

    // 5. Parenthesized expression
    if (token.kind === 'LPAREN') {
      const openParen = this.take();
      const expr = this.parseComparison();
      this.expect('RPAREN', `Expected ')' to match '(' at position ${openParen.start}`);
      return { kind: 'paren', expr };
    }

    // 6. Array literal
    if (token.kind === 'LBRACE') {
      return this.parseArrayLiteral();
    }

    // 7. Sheet-qualified references (SHEET_PREFIX followed by CellRef or Range)
    if (token.kind === 'SHEET_PREFIX') {
      const sheetTok = this.take();
      const sheet = sheetTok.value;

      const cellTok = this.peek();
      if (cellTok.kind !== 'IDENT') {
        throw new Error(`Expected cell reference after sheet name "${sheet}" at position ${cellTok.start}`);
      }
      const ref1 = tryParseCellRef(cellTok.value);
      if (!ref1) {
        throw new Error(`Expected valid cell reference after sheet name "${sheet}" at position ${cellTok.start}, found '${cellTok.value}'`);
      }
      this.take(); // consume cellTok

      // Check if followed by colon: RangeRef
      if (this.match('COLON')) {
        if (this.check('SHEET_PREFIX')) {
          this.take(); // consume optional second sheet prefix
        }
        const nextTok = this.peek();
        if (nextTok.kind !== 'IDENT') {
          throw new Error(`Expected cell reference after ':' at position ${nextTok.start}`);
        }
        const ref2 = tryParseCellRef(nextTok.value);
        if (!ref2) {
          throw new Error(`Expected valid cell reference after ':' at position ${nextTok.start}, found '${nextTok.value}'`);
        }
        this.take(); // consume nextTok

        return {
          kind: 'range',
          sheet,
          startRow: ref1.row,
          startCol: ref1.col,
          endRow: ref2.row,
          endCol: ref2.col,
          absStartRow: ref1.absRow,
          absStartCol: ref1.absCol,
          absEndRow: ref2.absRow,
          absEndCol: ref2.absCol,
        };
      }

      return {
        kind: 'cell',
        sheet,
        row: ref1.row,
        col: ref1.col,
        absRow: ref1.absRow,
        absCol: ref1.absCol,
      };
    }

    // 8. Identifiers: Function call, Cell reference, Range reference, or Name reference
    if (token.kind === 'IDENT') {
      // 8a. Function call: IDENT followed by LPAREN
      if (this.peekNext()?.kind === 'LPAREN') {
        const identTok = this.take();
        return this.parseFunctionCall(identTok.value.toUpperCase());
      }

      // 8b. Cell reference (and optional Range reference)
      const cellRef = tryParseCellRef(token.value);
      if (cellRef) {
        this.take(); // consume token

        if (this.match('COLON')) {
          let sheet: string | undefined;
          if (this.check('SHEET_PREFIX')) {
            const sheetTok = this.take();
            sheet = sheetTok.value;
          }
          const nextTok = this.peek();
          if (nextTok.kind !== 'IDENT') {
            throw new Error(`Expected cell reference after ':' at position ${nextTok.start}`);
          }
          const ref2 = tryParseCellRef(nextTok.value);
          if (!ref2) {
            throw new Error(`Expected valid cell reference after ':' at position ${nextTok.start}, found '${nextTok.value}'`);
          }
          this.take(); // consume nextTok

          return {
            kind: 'range',
            ...(sheet ? { sheet } : {}),
            startRow: cellRef.row,
            startCol: cellRef.col,
            endRow: ref2.row,
            endCol: ref2.col,
            absStartRow: cellRef.absRow,
            absStartCol: cellRef.absCol,
            absEndRow: ref2.absRow,
            absEndCol: ref2.absCol,
          };
        }

        return {
          kind: 'cell',
          row: cellRef.row,
          col: cellRef.col,
          absRow: cellRef.absRow,
          absCol: cellRef.absCol,
        };
      }

      // 8c. Name reference
      const nameTok = this.take();
      return {
        kind: 'name',
        name: nameTok.value,
      };
    }

    throw new Error(`Unexpected token '${token.value || token.kind}' at position ${token.start}`);
  }

  /**
   * Parses function calls: IDENT LPAREN args RPAREN.
   */
  private parseFunctionCall(name: string): FunctionCallNode {
    const lparen = this.expect('LPAREN');
    const args: AstNode[] = [];

    // Empty arg list e.g. NOW()
    if (this.match('RPAREN')) {
      return { kind: 'function', name, args };
    }

    while (true) {
      if (this.check('COMMA')) {
        // Empty argument at start or consecutive comma (e.g. FOO(, 1) or FOO(1,, 2))
        args.push({ kind: 'empty' });
        this.take(); // consume comma
        continue;
      }

      if (this.check('RPAREN')) {
        // Trailing empty argument before close paren (e.g. FOO(1,))
        args.push({ kind: 'empty' });
        break;
      }

      const arg = this.parseComparison();
      args.push(arg);

      if (this.match('COMMA')) {
        if (this.check('RPAREN')) {
          args.push({ kind: 'empty' });
          break;
        }
      } else {
        break;
      }
    }

    this.expect('RPAREN', `Expected ')' to match '(' at position ${lparen.start}`);
    return { kind: 'function', name, args };
  }

  /**
   * Parses array literals: LBRACE expr (COMMA expr)* (SEMICOLON expr (COMMA expr)*)* RBRACE.
   */
  private parseArrayLiteral(): ArrayLiteralNode {
    const braceTok = this.expect('LBRACE');
    const rows: AstNode[][] = [];
    let currentRow: AstNode[] = [];

    currentRow.push(this.parseComparison());

    while (!this.check('RBRACE') && !this.check('EOF')) {
      if (this.match('COMMA')) {
        currentRow.push(this.parseComparison());
      } else if (this.match('SEMICOLON')) {
        rows.push(currentRow);
        currentRow = [this.parseComparison()];
      } else {
        const cur = this.peek();
        throw new Error(`Expected ',' or ';' or '}' in array literal at position ${cur.start}`);
      }
    }

    rows.push(currentRow);
    this.expect('RBRACE', `Expected '}' to match '{' at position ${braceTok.start}`);

    const expectedCols = rows[0]!.length;
    for (let r = 1; r < rows.length; r++) {
      if (rows[r]!.length !== expectedCols) {
        throw new Error(
          `Array rows must all have the same number of columns: row 1 has ${expectedCols} columns, but row ${r + 1} has ${rows[r]!.length} columns`
        );
      }
    }

    return { kind: 'array', rows };
  }
}

/**
 * Parses a formula source string (with or without a leading '=') into an AstNode tree.
 */
export function parse(source: string): AstNode {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseRoot();
}

function formatSheetName(sheet: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheet) && !/^(TRUE|FALSE)$/i.test(sheet)) {
    return `${sheet}!`;
  }
  return `'${sheet.replace(/'/g, "''")}'!`;
}

function getOperatorPrecedence(node: AstNode): number {
  if (node.kind === 'paren') return 10;
  if (node.kind === 'unary') {
    return node.op === '%' ? 7 : 6;
  }
  if (node.kind === 'binary') {
    switch (node.op) {
      case '^':
        return 5;
      case '*':
      case '/':
        return 4;
      case '+':
      case '-':
        return 3;
      case '&':
        return 2;
      case '=':
      case '<>':
      case '<':
      case '<=':
      case '>':
      case '>=':
        return 1;
    }
  }
  return 8; // atoms
}

function formatBinaryNode(node: BinaryOpNode): string {
  const parentPrec = getOperatorPrecedence(node);
  const leftPrec = getOperatorPrecedence(node.left);
  const rightPrec = getOperatorPrecedence(node.right);

  let leftStr = printFormula(node.left);
  if (node.left.kind !== 'paren') {
    if (leftPrec < parentPrec || (node.op === '^' && node.left.kind === 'binary' && node.left.op === '^')) {
      leftStr = `(${leftStr})`;
    }
  }

  let rightStr = printFormula(node.right);
  if (node.right.kind !== 'paren') {
    if (
      rightPrec < parentPrec ||
      (rightPrec === parentPrec && (node.op === '-' || node.op === '/'))
    ) {
      rightStr = `(${rightStr})`;
    }
  }

  return `${leftStr}${node.op}${rightStr}`;
}

/**
 * Converts an AstNode back into valid formula source text (without a leading '=').
 */
export function printFormula(node: AstNode): string {
  switch (node.kind) {
    case 'number':
      return String(node.value);

    case 'string':
      return `"${node.value.replace(/"/g, '""')}"`;

    case 'boolean':
      return node.value ? 'TRUE' : 'FALSE';

    case 'error':
      return node.code;

    case 'empty':
      return '';

    case 'name':
      return node.name;

    case 'cell': {
      const sheetPart = node.sheet ? formatSheetName(node.sheet) : '';
      const colPart = (node.absCol ? '$' : '') + colToLetters(node.col);
      const rowPart = (node.absRow ? '$' : '') + (node.row + 1);
      return `${sheetPart}${colPart}${rowPart}`;
    }

    case 'range': {
      const sheetPart = node.sheet ? formatSheetName(node.sheet) : '';
      const startColPart = (node.absStartCol ? '$' : '') + colToLetters(node.startCol);
      const startRowPart = (node.absStartRow ? '$' : '') + (node.startRow + 1);
      const endColPart = (node.absEndCol ? '$' : '') + colToLetters(node.endCol);
      const endRowPart = (node.absEndRow ? '$' : '') + (node.endRow + 1);
      return `${sheetPart}${startColPart}${startRowPart}:${endColPart}${endRowPart}`;
    }

    case 'paren':
      return `(${printFormula(node.expr)})`;

    case 'function': {
      const args = node.args.map((arg) => printFormula(arg)).join(',');
      return `${node.name}(${args})`;
    }

    case 'array': {
      const rows = node.rows
        .map((row) => row.map((cell) => printFormula(cell)).join(','))
        .join(';');
      return `{${rows}}`;
    }

    case 'unary': {
      const operandStr = printFormula(node.operand);
      if (node.op === '%') {
        if (node.operand.kind === 'binary') {
          return `(${operandStr})%`;
        }
        return `${operandStr}%`;
      }
      if (node.operand.kind === 'binary') {
        return `${node.op}(${operandStr})`;
      }
      return `${node.op}${operandStr}`;
    }

    case 'binary':
      return formatBinaryNode(node);

    default: {
      const exhaustiveCheck: never = node;
      throw new Error(`Unknown node kind: ${(exhaustiveCheck as AstNode).kind}`);
    }
  }
}
