use crate::coordinates::{letters_to_col, valid_position};
use crate::types::ErrorCode;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Number(f64),
    String(String),
    Boolean(bool),
    Error(ErrorCode),
    Ident(String),
    CellRef {
        sheet: Option<String>,
        row: u32,
        col: u32,
        abs_row: bool,
        abs_col: bool,
    },
    StructuredRef {
        table: String,
        section: Option<String>,
        column: Option<String>,
    },
    Colon,
    Caret,
    Star,
    Slash,
    Plus,
    Minus,
    Ampersand,
    Percent,
    Eq,
    Neq,
    Lt,
    Lte,
    Gt,
    Gte,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Comma,
    Semicolon,
    Eof,
}

pub struct Lexer<'a> {
    chars: Vec<char>,
    pos: usize,
    _marker: std::marker::PhantomData<&'a str>,
}

impl<'a> Lexer<'a> {
    pub fn new(input: &'a str) -> Self {
        let input = input.trim_start_matches('=');
        Self {
            chars: input.chars().collect(),
            pos: 0,
            _marker: std::marker::PhantomData,
        }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn peek_ahead(&self, n: usize) -> Option<char> {
        self.chars.get(self.pos + n).copied()
    }

    fn advance(&mut self) -> Option<char> {
        if self.pos < self.chars.len() {
            let ch = self.chars[self.pos];
            self.pos += 1;
            Some(ch)
        } else {
            None
        }
    }

    fn skip_whitespace(&mut self) {
        while let Some(ch) = self.peek() {
            if ch.is_whitespace() {
                self.advance();
            } else {
                break;
            }
        }
    }

    pub fn next_token(&mut self) -> Result<Token, ErrorCode> {
        self.skip_whitespace();
        let ch = match self.peek() {
            Some(c) => c,
            None => return Ok(Token::Eof),
        };

        // Strings
        if ch == '"' {
            return self.read_string();
        }

        // Single-quoted sheet prefix: 'Sheet Name'!A1
        if ch == '\'' {
            return self.read_quoted_sheet_or_ident();
        }

        // Error literals: #NULL!, #DIV/0!, #VALUE!, #REF!, #NAME?, #NUM!, #N/A, #SPILL!, #CALC!, #CIRC!, #PARSE!
        if ch == '#' {
            return self.read_error();
        }

        // Numbers: digits or '.' followed by digit
        if ch.is_ascii_digit() || (ch == '.' && self.peek_ahead(1).is_some_and(|c| c.is_ascii_digit())) {
            return self.read_number();
        }

        // Operators & punctuation
        match ch {
            ':' => { self.advance(); Ok(Token::Colon) }
            '^' => { self.advance(); Ok(Token::Caret) }
            '*' => { self.advance(); Ok(Token::Star) }
            '/' => { self.advance(); Ok(Token::Slash) }
            '+' => { self.advance(); Ok(Token::Plus) }
            '-' => { self.advance(); Ok(Token::Minus) }
            '&' => { self.advance(); Ok(Token::Ampersand) }
            '%' => { self.advance(); Ok(Token::Percent) }
            '(' => { self.advance(); Ok(Token::LParen) }
            ')' => { self.advance(); Ok(Token::RParen) }
            '{' => { self.advance(); Ok(Token::LBrace) }
            '}' => { self.advance(); Ok(Token::RBrace) }
            ',' => { self.advance(); Ok(Token::Comma) }
            ';' => { self.advance(); Ok(Token::Semicolon) }
            '=' => { self.advance(); Ok(Token::Eq) }
            '<' => {
                self.advance();
                if self.peek() == Some('>') {
                    self.advance();
                    Ok(Token::Neq)
                } else if self.peek() == Some('=') {
                    self.advance();
                    Ok(Token::Lte)
                } else {
                    Ok(Token::Lt)
                }
            }
            '>' => {
                self.advance();
                if self.peek() == Some('=') {
                    self.advance();
                    Ok(Token::Gte)
                } else {
                    Ok(Token::Gt)
                }
            }
            '$' => {
                // Absolute reference like $A$1 or $A1
                self.read_cell_ref_or_ident(None)
            }
            _ if ch.is_alphabetic() || ch == '_' => {
                self.read_ident_or_cell_ref()
            }
            _ => {
                self.advance();
                Err(ErrorCode::Parse)
            }
        }
    }

    fn read_string(&mut self) -> Result<Token, ErrorCode> {
        self.advance(); // consume opening "
        let mut s = String::new();
        while let Some(ch) = self.peek() {
            if ch == '"' {
                self.advance();
                if self.peek() == Some('"') {
                    self.advance();
                    s.push('"');
                } else {
                    return Ok(Token::String(s));
                }
            } else {
                s.push(ch);
                self.advance();
            }
        }
        Err(ErrorCode::Parse)
    }

    fn read_error(&mut self) -> Result<Token, ErrorCode> {
        let start = self.pos;
        self.advance(); // consume #
        while let Some(ch) = self.peek() {
            if ch.is_alphanumeric() || ch == '/' || ch == '?' || ch == '!' {
                self.advance();
                if ch == '!' || ch == '?' {
                    break;
                }
            } else {
                break;
            }
        }
        let err_str: String = self.chars[start..self.pos].iter().collect();
        if let Some(code) = ErrorCode::from_str_opt(&err_str) {
            Ok(Token::Error(code))
        } else {
            Err(ErrorCode::Parse)
        }
    }

    fn read_number(&mut self) -> Result<Token, ErrorCode> {
        let start = self.pos;
        let mut has_dot = false;
        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                self.advance();
            } else if ch == '.' && !has_dot {
                has_dot = true;
                self.advance();
            } else {
                break;
            }
        }
        // Scientific notation: e.g. 1e-5 or 2.5E+3
        if let Some(ch) = self.peek() {
            if ch == 'e' || ch == 'E' {
                self.advance();
                if let Some(sign) = self.peek() {
                    if sign == '+' || sign == '-' {
                        self.advance();
                    }
                }
                while let Some(d) = self.peek() {
                    if d.is_ascii_digit() {
                        self.advance();
                    } else {
                        break;
                    }
                }
            }
        }
        let num_str: String = self.chars[start..self.pos].iter().collect();
        match num_str.parse::<f64>() {
            Ok(n) => Ok(Token::Number(n)),
            Err(_) => Err(ErrorCode::Parse),
        }
    }

    fn read_quoted_sheet_or_ident(&mut self) -> Result<Token, ErrorCode> {
        self.advance(); // consume '
        let mut sheet_name = String::new();
        while let Some(ch) = self.peek() {
            if ch == '\'' {
                self.advance();
                if self.peek() == Some('\'') {
                    self.advance();
                    sheet_name.push('\'');
                } else {
                    break;
                }
            } else {
                sheet_name.push(ch);
                self.advance();
            }
        }
        if self.peek() == Some('!') {
            self.advance(); // consume !
            self.read_cell_ref_or_ident(Some(sheet_name))
        } else {
            Err(ErrorCode::Parse)
        }
    }

    fn read_ident_or_cell_ref(&mut self) -> Result<Token, ErrorCode> {
        let start = self.pos;
        while let Some(ch) = self.peek() {
            if ch.is_alphanumeric() || ch == '_' || ch == '.' {
                self.advance();
            } else {
                break;
            }
        }
        let word: String = self.chars[start..self.pos].iter().collect();

        // Check if followed by ! -> Sheet prefix e.g. Sheet1!A1
        if self.peek() == Some('!') {
            self.advance(); // consume !
            return self.read_cell_ref_or_ident(Some(word));
        }

        // Check if followed by [ -> Structured reference e.g. Table1[Column]
        if self.peek() == Some('[') {
            return self.read_structured_ref(word);
        }

        // Check if boolean TRUE or FALSE
        let upper = word.to_uppercase();
        if upper == "TRUE" {
            return Ok(Token::Boolean(true));
        }
        if upper == "FALSE" {
            return Ok(Token::Boolean(false));
        }

        // Check if function call (followed by '(')
        if self.peek() == Some('(') {
            return Ok(Token::Ident(upper));
        }

        // Check if it's a cell reference: 1..3 letters followed by 1..7 digits
        if let Some(token) = self.try_parse_cell_ref(&word, None, false) {
            return Ok(token);
        }

        Ok(Token::Ident(word))
    }

    fn read_cell_ref_or_ident(&mut self, sheet: Option<String>) -> Result<Token, ErrorCode> {
        let mut abs_col = false;
        if self.peek() == Some('$') {
            abs_col = true;
            self.advance();
        }

        let start = self.pos;
        while let Some(ch) = self.peek() {
            if ch.is_alphabetic() {
                self.advance();
            } else {
                break;
            }
        }
        let col_str: String = self.chars[start..self.pos].iter().collect();

        let mut abs_row = false;
        if self.peek() == Some('$') {
            abs_row = true;
            self.advance();
        }

        let start_digits = self.pos;
        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                self.advance();
            } else {
                break;
            }
        }
        let row_str: String = self.chars[start_digits..self.pos].iter().collect();

        if let (Some(col), Ok(row_1)) = (letters_to_col(&col_str), row_str.parse::<u32>()) {
            if row_1 >= 1 && valid_position(row_1 - 1, col) {
                return Ok(Token::CellRef {
                    sheet,
                    row: row_1 - 1,
                    col,
                    abs_row,
                    abs_col,
                });
            }
        }

        Err(ErrorCode::Parse)
    }

    fn try_parse_cell_ref(&self, text: &str, sheet: Option<String>, abs_col: bool) -> Option<Token> {
        let split_pos = text.find(|c: char| c.is_ascii_digit())?;
        if split_pos == 0 || split_pos > 3 {
            return None;
        }
        let col_str = &text[..split_pos];
        let row_str = &text[split_pos..];

        let abs_row = col_str.ends_with('$');
        let col_str = if abs_row { &col_str[..col_str.len() - 1] } else { col_str };

        let col = letters_to_col(col_str)?;
        let row_1 = row_str.parse::<u32>().ok()?;
        if row_1 >= 1 && valid_position(row_1 - 1, col) {
            Some(Token::CellRef {
                sheet,
                row: row_1 - 1,
                col,
                abs_row,
                abs_col,
            })
        } else {
            None
        }
    }

    fn read_structured_ref(&mut self, table: String) -> Result<Token, ErrorCode> {
        self.advance(); // consume [
        let mut depth = 1;
        let mut inside = String::new();
        while let Some(ch) = self.peek() {
            if ch == '[' {
                depth += 1;
                inside.push(ch);
                self.advance();
            } else if ch == ']' {
                depth -= 1;
                self.advance();
                if depth == 0 {
                    break;
                }
                inside.push(ch);
            } else {
                inside.push(ch);
                self.advance();
            }
        }

        let inside = inside.trim();
        let (section, column) = if let Some(stripped) = inside.strip_prefix('@') {
            (Some("@".to_string()), Some(stripped.trim().to_string()))
        } else if inside.starts_with("#This Row") || inside.starts_with("#this row") {
            (Some("#This Row".to_string()), None)
        } else if inside.starts_with('#') {
            (Some(inside.to_string()), None)
        } else if inside.contains(',') {
            // e.g. [#Headers],[Column]
            let parts: Vec<&str> = inside.split(',').collect();
            let sec = parts.first().map(|s| s.trim().trim_matches('[').trim_matches(']').to_string());
            let col = parts.get(1).map(|s| s.trim().trim_matches('[').trim_matches(']').to_string());
            (sec, col)
        } else {
            (None, Some(inside.to_string()))
        };

        Ok(Token::StructuredRef {
            table,
            section,
            column,
        })
    }
}
