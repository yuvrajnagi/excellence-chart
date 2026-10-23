use std::collections::HashMap;
use crate::ast::AstNode;
use crate::types::ComputedValue;

#[derive(Debug, Clone, PartialEq)]
pub struct LambdaClosure {
    pub params: Vec<String>,
    pub body: AstNode,
    pub env: HashMap<String, ComputedValue>,
}

impl LambdaClosure {
    pub fn new(params: Vec<String>, body: AstNode, env: HashMap<String, ComputedValue>) -> Self {
        Self { params, body, env }
    }
}
