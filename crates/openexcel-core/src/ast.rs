use crate::types::Scalar;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    Plus,
    Minus,
    Percent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Range,        // :
    Power,        // ^
    Multiply,     // *
    Divide,       // /
    Add,          // +
    Subtract,     // -
    Concat,       // &
    Eq,           // =
    Ne,           // <>
    Lt,           // <
    Lte,          // <=
    Gt,           // >
    Gte,          // >=
}

#[derive(Debug, Clone, PartialEq)]
pub enum AstNode {
    Literal(Scalar),
    CellRef {
        sheet: Option<String>,
        row: u32,
        col: u32,
        abs_row: bool,
        abs_col: bool,
    },
    Range {
        from: Box<AstNode>,
        to: Box<AstNode>,
    },
    StructuredRef {
        table: String,
        section: Option<String>,
        column: Option<String>,
    },
    Unary {
        op: UnaryOp,
        expr: Box<AstNode>,
    },
    Binary {
        op: BinaryOp,
        left: Box<AstNode>,
        right: Box<AstNode>,
    },
    FunctionCall {
        name: String,
        args: Vec<AstNode>,
    },
    ArrayLiteral {
        rows: usize,
        cols: usize,
        elements: Vec<AstNode>,
    },
    NameRef(String),
    Apply {
        callee: Box<AstNode>,
        args: Vec<AstNode>,
    },
}

impl AstNode {
    pub fn literal_num(n: f64) -> Self {
        AstNode::Literal(Scalar::Number { value: n })
    }

    pub fn literal_str(s: impl Into<String>) -> Self {
        AstNode::Literal(Scalar::String { value: s.into() })
    }

    pub fn literal_bool(b: bool) -> Self {
        AstNode::Literal(Scalar::Boolean { value: b })
    }
}
