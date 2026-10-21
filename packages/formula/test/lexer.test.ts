import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/lexer.js';
import type { AstNode, CellRefNode, FunctionCallNode } from '../src/ast.js';

describe('formula lexer', () => {
  it('tokenizes numbers with integers, decimals, and exponents', () => {
    const tokens = tokenize('=1 1.5 .5 123. 1e10 1.5E-3 .5e+2');
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['NUMBER', '1'],
      ['NUMBER', '1.5'],
      ['NUMBER', '.5'],
      ['NUMBER', '123.'],
      ['NUMBER', '1e10'],
      ['NUMBER', '1.5E-3'],
      ['NUMBER', '.5e+2'],
      ['EOF', ''],
    ]);
  });

  it('tokenizes strings with escaped quotes', () => {
    const tokens = tokenize('="hello" "" "hello ""world"""');
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['STRING', '"hello"'],
      ['STRING', '""'],
      ['STRING', '"hello ""world"""'],
      ['EOF', ''],
    ]);
  });

  it('throws on unterminated strings', () => {
    expect(() => tokenize('="unclosed')).toThrow('Unterminated string literal');
  });

  it('tokenizes booleans case-insensitively', () => {
    const tokens = tokenize('=TRUE false True False');
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['BOOLEAN', 'TRUE'],
      ['BOOLEAN', 'false'],
      ['BOOLEAN', 'True'],
      ['BOOLEAN', 'False'],
      ['EOF', ''],
    ]);
  });

  it('tokenizes all 11 error codes case-insensitively', () => {
    const errors = [
      '#NULL!',
      '#DIV/0!',
      '#VALUE!',
      '#REF!',
      '#NAME?',
      '#NUM!',
      '#N/A',
      '#SPILL!',
      '#CALC!',
      '#CIRC!',
      '#PARSE!',
    ];
    for (const code of errors) {
      const tokens = tokenize(`=${code} ${code.toLowerCase()}`);
      expect(tokens[0]!.kind).toBe('ERROR');
      expect(tokens[0]!.value).toBe(code);
      expect(tokens[1]!.kind).toBe('ERROR');
      expect(tokens[1]!.value).toBe(code.toLowerCase());
    }
  });

  it('tokenizes cell references and function names as IDENT', () => {
    const tokens = tokenize('=A1 $A$1 $A1 A$1 XFD1048576 SUM STDEV.S _custom.name');
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['IDENT', 'A1'],
      ['IDENT', '$A$1'],
      ['IDENT', '$A1'],
      ['IDENT', 'A$1'],
      ['IDENT', 'XFD1048576'],
      ['IDENT', 'SUM'],
      ['IDENT', 'STDEV.S'],
      ['IDENT', '_custom.name'],
      ['EOF', ''],
    ]);
  });

  it('tokenizes quoted sheet prefixes and extracts unquoted sheet name', () => {
    const tokens = tokenize("='Sheet 1'!A1 'Bob''s Sheet'!$B$2");
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['SHEET_PREFIX', 'Sheet 1'],
      ['IDENT', 'A1'],
      ['SHEET_PREFIX', "Bob's Sheet"],
      ['IDENT', '$B$2'],
      ['EOF', ''],
    ]);
  });

  it('tokenizes unquoted sheet prefixes combining IDENT and !', () => {
    const tokens = tokenize('=Sheet1!A1 Data_2024!B2 TRUE!C3');
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['SHEET_PREFIX', 'Sheet1'],
      ['IDENT', 'A1'],
      ['SHEET_PREFIX', 'Data_2024'],
      ['IDENT', 'B2'],
      ['SHEET_PREFIX', 'TRUE'],
      ['IDENT', 'C3'],
      ['EOF', ''],
    ]);
  });

  it('tokenizes operators and delimiters', () => {
    const tokens = tokenize('=+ - * / ^ & % = <> < <= > >= ( ) { } , ; : !');
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['PLUS', '+'],
      ['MINUS', '-'],
      ['STAR', '*'],
      ['SLASH', '/'],
      ['CARET', '^'],
      ['AMPERSAND', '&'],
      ['PERCENT', '%'],
      ['EQ', '='],
      ['NEQ', '<>'],
      ['LT', '<'],
      ['LTE', '<='],
      ['GT', '>'],
      ['GTE', '>='],
      ['LPAREN', '('],
      ['RPAREN', ')'],
      ['LBRACE', '{'],
      ['RBRACE', '}'],
      ['COMMA', ','],
      ['SEMICOLON', ';'],
      ['COLON', ':'],
      ['EXCL', '!'],
      ['EOF', ''],
    ]);
  });

  it('handles formula starting without =', () => {
    const tokens = tokenize('SUM(A1, B1)');
    expect(tokens[0]!.kind).toBe('IDENT');
    expect(tokens[0]!.value).toBe('SUM');
    expect(tokens[tokens.length - 1]!.kind).toBe('EOF');
  });

  it('tracks correct source positions', () => {
    const source = '=A1 + "hello"';
    const tokens = tokenize(source);
    for (const t of tokens) {
      if (t.kind !== 'EOF') {
        expect(source.slice(t.start, t.end)).toBe(t.value);
      }
    }
  });

  it('handles array literals and formulas', () => {
    const tokens = tokenize('={1, 2; 3, 4}');
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['LBRACE', '{'],
      ['NUMBER', '1'],
      ['COMMA', ','],
      ['NUMBER', '2'],
      ['SEMICOLON', ';'],
      ['NUMBER', '3'],
      ['COMMA', ','],
      ['NUMBER', '4'],
      ['RBRACE', '}'],
      ['EOF', ''],
    ]);
  });

  it('throws on unexpected characters', () => {
    expect(() => tokenize('=@A1')).toThrow("Unexpected character '@'");
  });
});

describe('AST types', () => {
  it('supports node construction conforming to AstNode union', () => {
    const cellNode: CellRefNode = {
      kind: 'cell',
      row: 0,
      col: 0,
      absRow: false,
      absCol: false,
      sheet: 'Sheet1',
    };
    const callNode: FunctionCallNode = {
      kind: 'function',
      name: 'SUM',
      args: [cellNode],
    };
    const root: AstNode = callNode;
    expect(root.kind).toBe('function');
  });
});
