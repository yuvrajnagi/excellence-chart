use crate::ast::{AstNode, BinaryOp, UnaryOp};
use crate::lexer::{Lexer, Token};
use crate::types::{ErrorCode, Scalar};

pub struct Parser<'a> {
    lexer: Lexer<'a>,
    current: Token,
}

impl<'a> Parser<'a> {
    pub fn new(input: &'a str) -> Result<Self, ErrorCode> {
        let mut lexer = Lexer::new(input);
        let current = lexer.next_token()?;
        Ok(Self { lexer, current })
    }

    fn advance(&mut self) -> Result<(), ErrorCode> {
        self.current = self.lexer.next_token()?;
        Ok(())
    }

    pub fn parse(&mut self) -> Result<AstNode, ErrorCode> {
        let node = self.parse_expr(0)?;
        if self.current != Token::Eof {
            return Err(ErrorCode::Parse);
        }
        Ok(node)
    }

    fn parse_expr(&mut self, min_bp: u8) -> Result<AstNode, ErrorCode> {
        let mut lhs = self.parse_prefix()?;

        loop {
            // Postfix % (lbp 8)
            if self.current == Token::Percent {
                if 8 < min_bp {
                    break;
                }
                self.advance()?;
                lhs = AstNode::Unary {
                    op: UnaryOp::Percent,
                    expr: Box::new(lhs),
                };
                continue;
            }

            // Function invocation on arbitrary expression: e.g. LAMBDA(x,x+1)(2)
            if self.current == Token::LParen {
                self.advance()?;
                let args = self.parse_argument_list(Token::RParen)?;
                lhs = AstNode::Apply {
                    callee: Box::new(lhs),
                    args,
                };
                continue;
            }

            let (lbp, rbp, op) = match &self.current {
                Token::Colon => (8, 9, BinaryOp::Range),
                Token::Caret => (7, 6, BinaryOp::Power),
                Token::Star => (5, 6, BinaryOp::Multiply),
                Token::Slash => (5, 6, BinaryOp::Divide),
                Token::Plus => (4, 5, BinaryOp::Add),
                Token::Minus => (4, 5, BinaryOp::Subtract),
                Token::Ampersand => (3, 4, BinaryOp::Concat),
                Token::Eq => (2, 3, BinaryOp::Eq),
                Token::Neq => (2, 3, BinaryOp::Ne),
                Token::Lt => (2, 3, BinaryOp::Lt),
                Token::Lte => (2, 3, BinaryOp::Lte),
                Token::Gt => (2, 3, BinaryOp::Gt),
                Token::Gte => (2, 3, BinaryOp::Gte),
                _ => break,
            };

            if lbp < min_bp {
                break;
            }

            self.advance()?;
            let rhs = self.parse_expr(rbp)?;

            if op == BinaryOp::Range {
                lhs = AstNode::Range {
                    from: Box::new(lhs),
                    to: Box::new(rhs),
                };
            } else {
                lhs = AstNode::Binary {
                    op,
                    left: Box::new(lhs),
                    right: Box::new(rhs),
                };
            }
        }

        Ok(lhs)
    }

    fn parse_prefix(&mut self) -> Result<AstNode, ErrorCode> {
        let tok = std::mem::replace(&mut self.current, Token::Eof);
        match tok {
            Token::Number(n) => {
                self.advance()?;
                Ok(AstNode::Literal(Scalar::Number { value: n }))
            }
            Token::String(s) => {
                self.advance()?;
                Ok(AstNode::Literal(Scalar::String { value: s }))
            }
            Token::Boolean(b) => {
                self.advance()?;
                Ok(AstNode::Literal(Scalar::Boolean { value: b }))
            }
            Token::Error(err) => {
                self.advance()?;
                Ok(AstNode::Literal(Scalar::Error { code: err, message: None }))
            }
            Token::CellRef { sheet, row, col, abs_row, abs_col } => {
                self.advance()?;
                Ok(AstNode::CellRef { sheet, row, col, abs_row, abs_col })
            }
            Token::StructuredRef { table, section, column } => {
                self.advance()?;
                Ok(AstNode::StructuredRef { table, section, column })
            }
            Token::Plus => {
                self.advance()?;
                let expr = self.parse_expr(8)?;
                Ok(AstNode::Unary { op: UnaryOp::Plus, expr: Box::new(expr) })
            }
            Token::Minus => {
                self.advance()?;
                let expr = self.parse_expr(8)?;
                Ok(AstNode::Unary { op: UnaryOp::Minus, expr: Box::new(expr) })
            }
            Token::LParen => {
                self.advance()?;
                let expr = self.parse_expr(0)?;
                if self.current != Token::RParen {
                    return Err(ErrorCode::Parse);
                }
                self.advance()?;
                Ok(expr)
            }
            Token::LBrace => {
                self.advance()?;
                self.parse_array_literal()
            }
            Token::Ident(name) => {
                self.advance()?;
                if self.current == Token::LParen {
                    self.advance()?;
                    let args = self.parse_argument_list(Token::RParen)?;
                    Ok(AstNode::FunctionCall {
                        name: name.to_uppercase(),
                        args,
                    })
                } else {
                    Ok(AstNode::NameRef(name))
                }
            }
            _ => Err(ErrorCode::Parse),
        }
    }

    fn parse_argument_list(&mut self, closing: Token) -> Result<Vec<AstNode>, ErrorCode> {
        let mut args = Vec::new();
        if self.current == closing {
            self.advance()?;
            return Ok(args);
        }

        loop {
            if self.current == closing {
                self.advance()?;
                break;
            }
            if self.current == Token::Comma {
                // Omitted argument: e.g. FOO(1,,3)
                args.push(AstNode::Literal(Scalar::Null));
                self.advance()?;
                continue;
            }

            let arg = self.parse_expr(0)?;
            args.push(arg);

            if self.current == Token::Comma {
                self.advance()?;
                // If followed immediately by closing paren: FOO(1,)
                if self.current == closing {
                    args.push(AstNode::Literal(Scalar::Null));
                    self.advance()?;
                    break;
                }
            } else if self.current == closing {
                self.advance()?;
                break;
            } else {
                return Err(ErrorCode::Parse);
            }
        }

        Ok(args)
    }

    fn parse_array_literal(&mut self) -> Result<AstNode, ErrorCode> {
        let mut cols = 0;
        let mut current_row_cols = 0;
        let mut elements = Vec::new();

        if self.current == Token::RBrace {
            self.advance()?;
            return Ok(AstNode::ArrayLiteral { rows: 0, cols: 0, elements });
        }

        let mut rows = 1;
        loop {
            let elem = self.parse_expr(0)?;
            elements.push(elem);
            current_row_cols += 1;

            if self.current == Token::Comma {
                self.advance()?;
            } else if self.current == Token::Semicolon {
                self.advance()?;
                if cols == 0 {
                    cols = current_row_cols;
                } else if cols != current_row_cols {
                    return Err(ErrorCode::Value);
                }
                current_row_cols = 0;
                rows += 1;
            } else if self.current == Token::RBrace {
                self.advance()?;
                if cols == 0 {
                    cols = current_row_cols;
                } else if cols != current_row_cols {
                    return Err(ErrorCode::Value);
                }
                break;
            } else {
                return Err(ErrorCode::Parse);
            }
        }

        Ok(AstNode::ArrayLiteral { rows, cols, elements })
    }
}

pub fn parse_formula(input: &str) -> Result<AstNode, ErrorCode> {
    let mut parser = Parser::new(input)?;
    parser.parse()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_operator_precedence() {
        // 1 + 2 * 3 -> 1 + (2 * 3)
        let ast = parse_formula("1+2*3").unwrap();
        match ast {
            AstNode::Binary { op: BinaryOp::Add, left, right } => {
                assert_eq!(*left, AstNode::literal_num(1.0));
                match *right {
                    AstNode::Binary { op: BinaryOp::Multiply, .. } => {}
                    _ => panic!("Expected multiplication on right"),
                }
            }
            _ => panic!("Expected addition at root"),
        }
    }

    #[test]
    fn test_power_right_associative() {
        // 2 ^ 3 ^ 2 -> 2 ^ (3 ^ 2)
        let ast = parse_formula("2^3^2").unwrap();
        match ast {
            AstNode::Binary { op: BinaryOp::Power, left, right } => {
                assert_eq!(*left, AstNode::literal_num(2.0));
                match *right {
                    AstNode::Binary { op: BinaryOp::Power, .. } => {}
                    _ => panic!("Expected power on right"),
                }
            }
            _ => panic!("Expected power at root"),
        }
    }

    #[test]
    fn test_unary_minus_precedence() {
        // In Excel, -2^2 is (-2)^2 = 4 because unary minus has prec 8 > power 7
        let ast = parse_formula("-2^2").unwrap();
        match ast {
            AstNode::Binary { op: BinaryOp::Power, left, right } => {
                match *left {
                    AstNode::Unary { op: UnaryOp::Minus, .. } => {}
                    _ => panic!("Expected unary minus on left"),
                }
                assert_eq!(*right, AstNode::literal_num(2.0));
            }
            _ => panic!("Expected power at root"),
        }
    }

    #[test]
    fn test_postfix_percent() {
        // 5% * 2 -> (5%) * 2
        let ast = parse_formula("5%*2").unwrap();
        match ast {
            AstNode::Binary { op: BinaryOp::Multiply, left, right } => {
                match *left {
                    AstNode::Unary { op: UnaryOp::Percent, .. } => {}
                    _ => panic!("Expected percent on left"),
                }
                assert_eq!(*right, AstNode::literal_num(2.0));
            }
            _ => panic!("Expected multiply at root"),
        }
    }

    #[test]
    fn test_array_literal() {
        let ast = parse_formula("{1, 2; 3, 4}").unwrap();
        match ast {
            AstNode::ArrayLiteral { rows, cols, elements } => {
                assert_eq!(rows, 2);
                assert_eq!(cols, 2);
                assert_eq!(elements.len(), 4);
            }
            _ => panic!("Expected ArrayLiteral"),
        }
    }

    #[test]
    fn test_lambda_application() {
        let ast = parse_formula("LAMBDA(x,x+1)(2)").unwrap();
        match ast {
            AstNode::Apply { callee, args } => {
                match *callee {
                    AstNode::FunctionCall { ref name, .. } => assert_eq!(name, "LAMBDA"),
                    _ => panic!("Expected LAMBDA function call"),
                }
                assert_eq!(args.len(), 1);
            }
            _ => panic!("Expected Apply"),
        }
    }
}
