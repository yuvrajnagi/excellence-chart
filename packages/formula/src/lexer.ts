export interface Token {
  readonly kind: TokenKind;
  readonly value: string;  // raw text
  readonly start: number;  // position in source
  readonly end: number;
}

export type TokenKind =
  | 'NUMBER' | 'STRING' | 'BOOLEAN' | 'ERROR'
  | 'IDENT' | 'SHEET_PREFIX'
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH' | 'CARET' | 'AMPERSAND' | 'PERCENT'
  | 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE'
  | 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE'
  | 'COMMA' | 'SEMICOLON' | 'COLON' | 'EXCL'
  | 'EOF';

const ERROR_REGEX = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A(?![A-Za-z0-9_])|SPILL!|CALC!|CIRC!|PARSE!)/i;
const NUMBER_REGEX = /^(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;
const IDENT_REGEX = /^\$?[A-Za-z_][A-Za-z0-9_.$]*/;

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n';
}

/**
 * Tokenizes a formula string into a list of tokens.
 * A leading '=' is skipped if present.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const len = source.length;
  let p = 0;

  // Formulas start with '=' which should be skipped.
  // Skip optional whitespace before a leading '='.
  while (p < len && isWhitespace(source[p]!)) {
    p++;
  }
  if (p < len && source[p] === '=') {
    p++;
  }

  while (p < len) {
    if (isWhitespace(source[p]!)) {
      p++;
      continue;
    }

    const start = p;
    const char = source[p]!;

    // 1. Quoted sheet name: 'Sheet Name'! or 'Sheet''s Name'!
    if (char === "'") {
      let closed = false;
      p++; // Skip opening quote
      let sheetName = '';
      while (p < len) {
        if (source[p] === "'") {
          if (p + 1 < len && source[p + 1] === "'") {
            sheetName += "'";
            p += 2; // Escaped single quote: ''
          } else {
            p++; // Closing single quote
            closed = true;
            break;
          }
        } else {
          sheetName += source[p];
          p++;
        }
      }

      if (!closed) {
        throw new Error(`Unterminated quoted sheet name starting at position ${start}`);
      }

      // Quoted sheet name must be followed by '!'
      let pAfter = p;
      while (pAfter < len && isWhitespace(source[pAfter]!)) {
        pAfter++;
      }
      if (pAfter < len && source[pAfter] === '!') {
        p = pAfter + 1;
        tokens.push({
          kind: 'SHEET_PREFIX',
          value: sheetName,
          start,
          end: p,
        });
        continue;
      }

      throw new Error(`Expected '!' after quoted sheet name at position ${p}`);
    }

    // 2. Double-quoted string literals: "hello ""world"""
    if (char === '"') {
      let closed = false;
      p++; // Skip opening double quote
      while (p < len) {
        if (source[p] === '"') {
          if (p + 1 < len && source[p + 1] === '"') {
            p += 2; // Escaped double quote: ""
          } else {
            p++; // Closing double quote
            closed = true;
            break;
          }
        } else {
          p++;
        }
      }

      if (!closed) {
        throw new Error(`Unterminated string literal starting at position ${start}`);
      }

      tokens.push({
        kind: 'STRING',
        value: source.slice(start, p),
        start,
        end: p,
      });
      continue;
    }

    // 3. Error literals: #NULL!, #DIV/0!, #VALUE!, #REF!, #NAME?, #NUM!, #N/A, #SPILL!, #CALC!, #CIRC!, #PARSE!
    if (char === '#') {
      const tail = source.slice(start);
      const match = ERROR_REGEX.exec(tail);
      if (match) {
        const raw = match[0]!;
        p += raw.length;
        tokens.push({
          kind: 'ERROR',
          value: raw,
          start,
          end: p,
        });
        continue;
      }
      throw new Error(`Invalid error literal starting at position ${start}`);
    }

    // 4. Numbers: 1, 1.5, .5, 1e10, 1.5E-3
    if (isDigit(char) || (char === '.' && p + 1 < len && isDigit(source[p + 1]!))) {
      const tail = source.slice(start);
      const match = NUMBER_REGEX.exec(tail);
      if (match) {
        const raw = match[0]!;
        p += raw.length;
        tokens.push({
          kind: 'NUMBER',
          value: raw,
          start,
          end: p,
        });
        continue;
      }
    }

    // 5. Identifiers, Booleans, or Unquoted Sheet Prefixes
    // Identifiers start with optional '$' followed by [A-Za-z_]
    if (char === '$' || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_') {
      const tail = source.slice(start);
      const match = IDENT_REGEX.exec(tail);
      if (match) {
        const raw = match[0]!;
        const identEnd = start + raw.length;

        // Check if followed by '!' (unquoted sheet prefix: Sheet1!A1)
        let pAfter = identEnd;
        while (pAfter < len && isWhitespace(source[pAfter]!)) {
          pAfter++;
        }
        if (pAfter < len && source[pAfter] === '!') {
          p = pAfter + 1;
          tokens.push({
            kind: 'SHEET_PREFIX',
            value: raw,
            start,
            end: p,
          });
          continue;
        }

        // Not followed by '!': check for boolean literal
        p = identEnd;
        const upper = raw.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') {
          tokens.push({
            kind: 'BOOLEAN',
            value: raw,
            start,
            end: p,
          });
        } else {
          tokens.push({
            kind: 'IDENT',
            value: raw,
            start,
            end: p,
          });
        }
        continue;
      }
    }

    // 6. Multi-character comparison operators: <>, <=, >=
    if (char === '<') {
      if (p + 1 < len && source[p + 1] === '>') {
        tokens.push({ kind: 'NEQ', value: '<>', start, end: start + 2 });
        p += 2;
        continue;
      }
      if (p + 1 < len && source[p + 1] === '=') {
        tokens.push({ kind: 'LTE', value: '<=', start, end: start + 2 });
        p += 2;
        continue;
      }
      tokens.push({ kind: 'LT', value: '<', start, end: start + 1 });
      p += 1;
      continue;
    }

    if (char === '>') {
      if (p + 1 < len && source[p + 1] === '=') {
        tokens.push({ kind: 'GTE', value: '>=', start, end: start + 2 });
        p += 2;
        continue;
      }
      tokens.push({ kind: 'GT', value: '>', start, end: start + 1 });
      p += 1;
      continue;
    }

    // 7. Single-character operators & delimiters
    switch (char) {
      case '=':
        tokens.push({ kind: 'EQ', value: '=', start, end: start + 1 });
        p++;
        continue;
      case '+':
        tokens.push({ kind: 'PLUS', value: '+', start, end: start + 1 });
        p++;
        continue;
      case '-':
        tokens.push({ kind: 'MINUS', value: '-', start, end: start + 1 });
        p++;
        continue;
      case '*':
        tokens.push({ kind: 'STAR', value: '*', start, end: start + 1 });
        p++;
        continue;
      case '/':
        tokens.push({ kind: 'SLASH', value: '/', start, end: start + 1 });
        p++;
        continue;
      case '^':
        tokens.push({ kind: 'CARET', value: '^', start, end: start + 1 });
        p++;
        continue;
      case '&':
        tokens.push({ kind: 'AMPERSAND', value: '&', start, end: start + 1 });
        p++;
        continue;
      case '%':
        tokens.push({ kind: 'PERCENT', value: '%', start, end: start + 1 });
        p++;
        continue;
      case '(':
        tokens.push({ kind: 'LPAREN', value: '(', start, end: start + 1 });
        p++;
        continue;
      case ')':
        tokens.push({ kind: 'RPAREN', value: ')', start, end: start + 1 });
        p++;
        continue;
      case '{':
        tokens.push({ kind: 'LBRACE', value: '{', start, end: start + 1 });
        p++;
        continue;
      case '}':
        tokens.push({ kind: 'RBRACE', value: '}', start, end: start + 1 });
        p++;
        continue;
      case ',':
        tokens.push({ kind: 'COMMA', value: ',', start, end: start + 1 });
        p++;
        continue;
      case ';':
        tokens.push({ kind: 'SEMICOLON', value: ';', start, end: start + 1 });
        p++;
        continue;
      case ':':
        tokens.push({ kind: 'COLON', value: ':', start, end: start + 1 });
        p++;
        continue;
      case '!':
        tokens.push({ kind: 'EXCL', value: '!', start, end: start + 1 });
        p++;
        continue;
    }

    throw new Error(`Unexpected character '${char}' at position ${start}`);
  }

  tokens.push({
    kind: 'EOF',
    value: '',
    start: p,
    end: p,
  });

  return tokens;
}
