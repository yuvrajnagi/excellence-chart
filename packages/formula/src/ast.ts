import type { ErrorCode } from '@openexcel/model';

export interface NumberLiteral {
  readonly kind: 'number';
  readonly value: number;
}

export interface StringLiteral {
  readonly kind: 'string';
  readonly value: string;
}

export interface BooleanLiteral {
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface ErrorLiteral {
  readonly kind: 'error';
  readonly code: ErrorCode;
}

export interface EmptyLiteral {
  readonly kind: 'empty';
}

export interface CellRefNode {
  readonly kind: 'cell';
  readonly sheet?: string;  // sheet name for cross-sheet refs
  readonly row: number;     // 0-based
  readonly col: number;     // 0-based
  readonly absRow: boolean; // $ prefix on row
  readonly absCol: boolean; // $ prefix on col
}

export interface RangeRefNode {
  readonly kind: 'range';
  readonly sheet?: string;
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
  readonly absStartRow: boolean;
  readonly absStartCol: boolean;
  readonly absEndRow: boolean;
  readonly absEndCol: boolean;
}

export interface UnaryOpNode {
  readonly kind: 'unary';
  readonly op: '+' | '-' | '%';
  readonly operand: AstNode;
}

export interface BinaryOpNode {
  readonly kind: 'binary';
  readonly op: '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';
  readonly left: AstNode;
  readonly right: AstNode;
}

export interface FunctionCallNode {
  readonly kind: 'function';
  readonly name: string;  // uppercase
  readonly args: readonly AstNode[];
}

export interface ArrayLiteralNode {
  readonly kind: 'array';
  readonly rows: readonly (readonly AstNode[])[];
}

export interface NameRefNode {
  readonly kind: 'name';
  readonly name: string;
}

export interface ParenNode {
  readonly kind: 'paren';
  readonly expr: AstNode;
}

export type AstNode =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | ErrorLiteral
  | EmptyLiteral
  | CellRefNode
  | RangeRefNode
  | UnaryOpNode
  | BinaryOpNode
  | FunctionCallNode
  | ArrayLiteralNode
  | NameRefNode
  | ParenNode;
