import { describe, expect, it } from 'vitest';
import {
  parse,
  printFormula,
  colToLetters,
  lettersToCol,
} from '../src/parser.js';
import type {
  AstNode,
  CellRefNode,
  RangeRefNode,
  FunctionCallNode,
  ArrayLiteralNode,
  BinaryOpNode,
  UnaryOpNode,
  ParenNode,
} from '../src/ast.js';

describe('column letter conversion helpers', () => {
  it('converts columns to letters correctly', () => {
    expect(colToLetters(0)).toBe('A');
    expect(colToLetters(25)).toBe('Z');
    expect(colToLetters(26)).toBe('AA');
    expect(colToLetters(27)).toBe('AB');
    expect(colToLetters(51)).toBe('AZ');
    expect(colToLetters(52)).toBe('BA');
    expect(colToLetters(701)).toBe('ZZ');
    expect(colToLetters(702)).toBe('AAA');
    expect(colToLetters(16383)).toBe('XFD');
  });

  it('throws on out-of-bounds column numbers', () => {
    expect(() => colToLetters(-1)).toThrow('Invalid column index');
    expect(() => colToLetters(16384)).toThrow('Invalid column index');
    expect(() => colToLetters(1.5)).toThrow('Invalid column index');
  });

  it('converts letters to columns correctly', () => {
    expect(lettersToCol('A')).toBe(0);
    expect(lettersToCol('a')).toBe(0);
    expect(lettersToCol('Z')).toBe(25);
    expect(lettersToCol('AA')).toBe(26);
    expect(lettersToCol('ab')).toBe(27);
    expect(lettersToCol('ZZ')).toBe(701);
    expect(lettersToCol('AAA')).toBe(702);
    expect(lettersToCol('XFD')).toBe(16383);
  });

  it('throws on invalid column letters', () => {
    expect(() => lettersToCol('')).toThrow('Invalid column letters');
    expect(() => lettersToCol('123')).toThrow('Invalid column letters');
    expect(() => lettersToCol('A1')).toThrow('Invalid column letters');
  });
});

describe('formula parser - literals', () => {
  it('parses numbers', () => {
    expect(parse('=123')).toEqual({ kind: 'number', value: 123 });
    expect(parse('1.5')).toEqual({ kind: 'number', value: 1.5 });
    expect(parse('=.5')).toEqual({ kind: 'number', value: 0.5 });
    expect(parse('=1e3')).toEqual({ kind: 'number', value: 1000 });
    expect(parse('=1.5E-2')).toEqual({ kind: 'number', value: 0.015 });
  });

  it('parses strings with quotes and escaped quotes', () => {
    expect(parse('="hello"')).toEqual({ kind: 'string', value: 'hello' });
    expect(parse('=""')).toEqual({ kind: 'string', value: '' });
    expect(parse('="hello ""world"""')).toEqual({ kind: 'string', value: 'hello "world"' });
  });

  it('parses booleans case-insensitively', () => {
    expect(parse('=TRUE')).toEqual({ kind: 'boolean', value: true });
    expect(parse('=false')).toEqual({ kind: 'boolean', value: false });
    expect(parse('=True')).toEqual({ kind: 'boolean', value: true });
  });

  it('parses error literals', () => {
    expect(parse('=#N/A')).toEqual({ kind: 'error', code: '#N/A' });
    expect(parse('=#DIV/0!')).toEqual({ kind: 'error', code: '#DIV/0!' });
    expect(parse('=#VALUE!')).toEqual({ kind: 'error', code: '#VALUE!' });
    expect(parse('=#REF!')).toEqual({ kind: 'error', code: '#REF!' });
    expect(parse('=#NAME?')).toEqual({ kind: 'error', code: '#NAME?' });
    expect(parse('=#NUM!')).toEqual({ kind: 'error', code: '#NUM!' });
    expect(parse('=#NULL!')).toEqual({ kind: 'error', code: '#NULL!' });
    expect(parse('=#SPILL!')).toEqual({ kind: 'error', code: '#SPILL!' });
    expect(parse('=#CALC!')).toEqual({ kind: 'error', code: '#CALC!' });
    expect(parse('=#CIRC!')).toEqual({ kind: 'error', code: '#CIRC!' });
    expect(parse('=#PARSE!')).toEqual({ kind: 'error', code: '#PARSE!' });
  });
});

describe('formula parser - cell and range references', () => {
  it('parses simple cell references', () => {
    expect(parse('=A1')).toEqual({
      kind: 'cell',
      row: 0,
      col: 0,
      absRow: false,
      absCol: false,
    });
    expect(parse('=$B$10')).toEqual({
      kind: 'cell',
      row: 9,
      col: 1,
      absRow: true,
      absCol: true,
    });
    expect(parse('=$C5')).toEqual({
      kind: 'cell',
      row: 4,
      col: 2,
      absRow: false,
      absCol: true,
    });
    expect(parse('=D$12')).toEqual({
      kind: 'cell',
      row: 11,
      col: 3,
      absRow: true,
      absCol: false,
    });
    expect(parse('=XFD1048576')).toEqual({
      kind: 'cell',
      row: 1048575,
      col: 16383,
      absRow: false,
      absCol: false,
    });
  });

  it('treats identifiers exceeding grid bounds as name references', () => {
    // XFE exceeds 16384 columns -> NameRefNode
    expect(parse('=XFE1')).toEqual({ kind: 'name', name: 'XFE1' });
    // Row 0 is outside 1..1048576 -> NameRefNode
    expect(parse('=A0')).toEqual({ kind: 'name', name: 'A0' });
    // Row 1048577 exceeds 1048576 -> NameRefNode
    expect(parse('=A1048577')).toEqual({ kind: 'name', name: 'A1048577' });
    // Generic identifier -> NameRefNode
    expect(parse('=MY_NAMED_RANGE')).toEqual({ kind: 'name', name: 'MY_NAMED_RANGE' });
  });

  it('parses range references', () => {
    expect(parse('=A1:B10')).toEqual({
      kind: 'range',
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 1,
      absStartRow: false,
      absStartCol: false,
      absEndRow: false,
      absEndCol: false,
    });

    expect(parse('=$A$1:$B$10')).toEqual({
      kind: 'range',
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 1,
      absStartRow: true,
      absStartCol: true,
      absEndRow: true,
      absEndCol: true,
    });

    expect(parse('=A$1:$B2')).toEqual({
      kind: 'range',
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
      absStartRow: true,
      absStartCol: false,
      absEndRow: false,
      absEndCol: true,
    });
  });

  it('parses sheet-qualified cell and range references', () => {
    expect(parse('=Sheet1!A1')).toEqual({
      kind: 'cell',
      sheet: 'Sheet1',
      row: 0,
      col: 0,
      absRow: false,
      absCol: false,
    });

    expect(parse("='My Sheet'!$A$1")).toEqual({
      kind: 'cell',
      sheet: 'My Sheet',
      row: 0,
      col: 0,
      absRow: true,
      absCol: true,
    });

    expect(parse('=Sheet1!A1:B10')).toEqual({
      kind: 'range',
      sheet: 'Sheet1',
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 1,
      absStartRow: false,
      absStartCol: false,
      absEndRow: false,
      absEndCol: false,
    });

    expect(parse("='My Sheet'!$A$1:$B$10")).toEqual({
      kind: 'range',
      sheet: 'My Sheet',
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 1,
      absStartRow: true,
      absStartCol: true,
      absEndRow: true,
      absEndCol: true,
    });

    expect(parse('=Sheet1!A1:Sheet1!B10')).toEqual({
      kind: 'range',
      sheet: 'Sheet1',
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 1,
      absStartRow: false,
      absStartCol: false,
      absEndRow: false,
      absEndCol: false,
    });
  });
});

describe('formula parser - function calls and arguments', () => {
  it('parses functions with zero arguments', () => {
    expect(parse('=NOW()')).toEqual({
      kind: 'function',
      name: 'NOW',
      args: [],
    });
    expect(parse('=true()')).toEqual({
      kind: 'function',
      name: 'TRUE',
      args: [],
    });
  });

  it('parses functions with single and multiple arguments', () => {
    expect(parse('=SUM(A1:B10)')).toEqual({
      kind: 'function',
      name: 'SUM',
      args: [
        {
          kind: 'range',
          startRow: 0,
          startCol: 0,
          endRow: 9,
          endCol: 1,
          absStartRow: false,
          absStartCol: false,
          absEndRow: false,
          absEndCol: false,
        },
      ],
    });

    expect(parse('=IF(A1 > 0, "positive", "non-positive")')).toEqual({
      kind: 'function',
      name: 'IF',
      args: [
        {
          kind: 'binary',
          op: '>',
          left: { kind: 'cell', row: 0, col: 0, absRow: false, absCol: false },
          right: { kind: 'number', value: 0 },
        },
        { kind: 'string', value: 'positive' },
        { kind: 'string', value: 'non-positive' },
      ],
    });
  });

  it('uppercases function names', () => {
    const node = parse('=vlookup(a1, data, 2, false)') as FunctionCallNode;
    expect(node.name).toBe('VLOOKUP');
  });

  it('handles empty / missing arguments as empty sentinels', () => {
    const node1 = parse('=IF(A1,,2)') as FunctionCallNode;
    expect(node1.args).toHaveLength(3);
    expect(node1.args[0]!.kind).toBe('cell');
    expect(node1.args[1]!.kind).toBe('empty');
    expect(node1.args[2]!.kind).toBe('number');

    const node2 = parse('=CHOOSE(1, 2,)') as FunctionCallNode;
    expect(node2.args).toHaveLength(3);
    expect(node2.args[0]!.kind).toBe('number');
    expect(node2.args[1]!.kind).toBe('number');
    expect(node2.args[2]!.kind).toBe('empty');

    const node3 = parse('=FOO(,2)') as FunctionCallNode;
    expect(node3.args).toHaveLength(2);
    expect(node3.args[0]!.kind).toBe('empty');
    expect(node3.args[1]!.kind).toBe('number');

    const node4 = parse('=FOO(,,)') as FunctionCallNode;
    expect(node4.args).toHaveLength(3);
    expect(node4.args[0]!.kind).toBe('empty');
    expect(node4.args[1]!.kind).toBe('empty');
    expect(node4.args[2]!.kind).toBe('empty');
  });
});

describe('formula parser - array literals', () => {
  it('parses valid 2D array literals', () => {
    const ast = parse('={1, 2; 3, 4}') as ArrayLiteralNode;
    expect(ast.kind).toBe('array');
    expect(ast.rows).toHaveLength(2);
    expect(ast.rows[0]).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'number', value: 2 },
    ]);
    expect(ast.rows[1]).toEqual([
      { kind: 'number', value: 3 },
      { kind: 'number', value: 4 },
    ]);
  });

  it('parses 1D row array and 1D column array', () => {
    const rowArray = parse('={1, 2, 3}') as ArrayLiteralNode;
    expect(rowArray.rows).toHaveLength(1);
    expect(rowArray.rows[0]).toHaveLength(3);

    const colArray = parse('={1; 2; 3}') as ArrayLiteralNode;
    expect(colArray.rows).toHaveLength(3);
    expect(colArray.rows[0]).toHaveLength(1);
    expect(colArray.rows[1]).toHaveLength(1);
    expect(colArray.rows[2]).toHaveLength(1);
  });

  it('throws on ragged array literals with mismatched row lengths', () => {
    expect(() => parse('={1, 2; 3}')).toThrow('Array rows must all have the same number of columns');
    expect(() => parse('={1; 2, 3}')).toThrow('Array rows must all have the same number of columns');
  });
});

describe('formula parser - operator precedence and associativity', () => {
  it('evaluates comparison at lowest binary precedence', () => {
    // 1 + 2 = 3 & 0 -> (1 + 2) = (3 & 0)
    const ast = parse('=1 + 2 = 3 & 0') as BinaryOpNode;
    expect(ast.kind).toBe('binary');
    expect(ast.op).toBe('=');
    expect((ast.left as BinaryOpNode).op).toBe('+');
    expect((ast.right as BinaryOpNode).op).toBe('&');
  });

  it('evaluates concatenation below addition', () => {
    // "a" & 1 + 2 -> "a" & (1 + 2)
    const ast = parse('="a" & 1 + 2') as BinaryOpNode;
    expect(ast.op).toBe('&');
    expect((ast.right as BinaryOpNode).op).toBe('+');
  });

  it('evaluates addition/subtraction left-associatively below multiplication/division', () => {
    // 1 - 2 - 3 -> (1 - 2) - 3
    const ast1 = parse('=1 - 2 - 3') as BinaryOpNode;
    expect(ast1.op).toBe('-');
    expect((ast1.left as BinaryOpNode).op).toBe('-');
    expect((ast1.right as any).value).toBe(3);

    // 1 + 2 * 3 -> 1 + (2 * 3)
    const ast2 = parse('=1 + 2 * 3') as BinaryOpNode;
    expect(ast2.op).toBe('+');
    expect((ast2.right as BinaryOpNode).op).toBe('*');

    // 1 * 2 + 3 / 4 -> (1 * 2) + (3 / 4)
    const ast3 = parse('=1 * 2 + 3 / 4') as BinaryOpNode;
    expect(ast3.op).toBe('+');
    expect((ast3.left as BinaryOpNode).op).toBe('*');
    expect((ast3.right as BinaryOpNode).op).toBe('/');
  });

  it('evaluates exponentiation as right-associative', () => {
    // 2 ^ 3 ^ 4 -> 2 ^ (3 ^ 4)
    const ast = parse('=2 ^ 3 ^ 4') as BinaryOpNode;
    expect(ast.op).toBe('^');
    expect((ast.left as any).value).toBe(2);
    expect((ast.right as BinaryOpNode).op).toBe('^');
    expect(((ast.right as BinaryOpNode).left as any).value).toBe(3);
    expect(((ast.right as BinaryOpNode).right as any).value).toBe(4);
  });

  it('evaluates unary prefix with higher precedence than exponentiation', () => {
    // -2 ^ 2 -> (-2) ^ 2
    const ast = parse('=-2 ^ 2') as BinaryOpNode;
    expect(ast.op).toBe('^');
    expect(ast.left.kind).toBe('unary');
    expect((ast.left as UnaryOpNode).op).toBe('-');
    expect(ast.right.kind).toBe('number');
  });

  it('evaluates postfix % with higher precedence than unary and binary operators', () => {
    // 5% ^ 2 -> (5%) ^ 2
    const ast = parse('=5% ^ 2') as BinaryOpNode;
    expect(ast.op).toBe('^');
    expect(ast.left.kind).toBe('unary');
    expect((ast.left as UnaryOpNode).op).toBe('%');

    // 5%% -> (5%)%
    const ast2 = parse('=5%%') as UnaryOpNode;
    expect(ast2.op).toBe('%');
    expect(ast2.operand.kind).toBe('unary');
    expect((ast2.operand as UnaryOpNode).op).toBe('%');
  });

  it('wraps parenthesized expressions in ParenNode', () => {
    const ast = parse('=(1 + 2) * 3') as BinaryOpNode;
    expect(ast.op).toBe('*');
    expect(ast.left.kind).toBe('paren');
    const paren = ast.left as ParenNode;
    expect(paren.expr.kind).toBe('binary');
    expect((paren.expr as BinaryOpNode).op).toBe('+');
  });
});

describe('formula printer and round-trip verification', () => {
  const roundTripCases = [
    '=123',
    '="hello world"',
    '="escaped ""quotes"" here"',
    '=TRUE',
    '=FALSE',
    '=#N/A',
    '=#DIV/0!',
    '=#VALUE!',
    '=A1',
    '=$B$2',
    '=C$3',
    '=$D4',
    '=Sheet1!A1',
    "='My Sheet'!$A$1",
    "='Bob''s Sheet'!B2",
    '=A1:B10',
    '=$A$1:$B$10',
    '=Sheet1!A1:B10',
    "='My Sheet'!$A$1:$B$10",
    '=MY_NAME',
    '=NOW()',
    '=SUM(A1:B10)',
    '=IF(A1>0,"pos","neg")',
    '=IF(A1,,2)',
    '=CHOOSE(1,2,)',
    '={1,2;3,4}',
    '={1,2,3}',
    '={1;2;3}',
    '=1+2',
    '=1-2-3',
    '=1+2*3',
    '=(1+2)*3',
    '=2^3^4',
    '=-(2^2)',
    '=-2^2',
    '=5%',
    '=5%%',
    '=5%^2',
    '=(A1+B1)&" "&(C1+D1)',
    '=A1=B1',
    '=A1<>B1',
    '=A1<=B1',
    '=A1>=B1',
    '=A1<B1',
    '=A1>B1',
  ];

  for (const formula of roundTripCases) {
    it(`round-trips formula: ${formula}`, () => {
      const ast1 = parse(formula);
      const printed = printFormula(ast1);
      // Printed formula does not start with '='
      expect(printed.startsWith('=')).toBe(false);
      const ast2 = parse(printed);
      expect(ast2).toEqual(ast1);
    });
  }
});

describe('formula parser - syntax errors', () => {
  it('throws on empty formula', () => {
    expect(() => parse('')).toThrow('Empty formula');
    expect(() => parse('=')).toThrow('Empty formula');
    expect(() => parse('   ')).toThrow('Empty formula');
  });

  it('throws on unexpected trailing tokens', () => {
    expect(() => parse('=1 + 2 3')).toThrow('Unexpected token');
  });

  it('throws on unclosed parentheses', () => {
    expect(() => parse('=(1 + 2')).toThrow("Expected ')' to match '('");
  });

  it('throws on unexpected closing parenthesis', () => {
    expect(() => parse('=1 + 2)')).toThrow("Unexpected token ')'");
  });

  it('throws on invalid colon usage', () => {
    expect(() => parse('=1:2')).toThrow("Unexpected token ':'");
    expect(() => parse('=A1:')).toThrow("Expected cell reference after ':'");
  });

  it('throws on invalid sheet prefix target', () => {
    expect(() => parse('=Sheet1!123')).toThrow('Expected cell reference after sheet name');
  });
});
