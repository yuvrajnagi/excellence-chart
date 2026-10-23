use std::collections::HashMap;
use crate::ast::{AstNode, BinaryOp, UnaryOp};
use crate::functions::criteria::compare_scalars;
use crate::functions::{invoke_standard_function, FunctionRegistry};
use crate::parser::parse_formula;
use crate::types::{
    CellAddress, ComputedValue, DefinedName, ErrorCode, RangeRef, ResourceLimits,
    Scalar, TableDefinition,
};

pub trait GridReader {
    fn read_cell(&self, sheet_id: &str, row: u32, col: u32) -> Result<ComputedValue, ErrorCode>;
    fn resolve_sheet_name(&self, sheet_name_or_id: &str) -> Option<String>;
    fn get_table(&self, sheet_id: &str, table_name: &str) -> Option<&TableDefinition>;
    fn get_defined_name(&self, scope_sheet_id: Option<&str>, name: &str) -> Option<&DefinedName>;
}

pub trait DependencyTracker {
    fn track_cell_dep(&mut self, from: &CellAddress, to: &CellAddress);
    fn track_range_dep(&mut self, from: &CellAddress, range: RangeRef);
}

pub struct Evaluator<'a, R: GridReader, D: DependencyTracker, F: FnMut() -> f64> {
    pub reader: &'a R,
    pub dep_tracker: Option<&'a mut D>,
    pub registry: &'a FunctionRegistry,
    pub limits: &'a ResourceLimits,
    pub now_ms: i64,
    pub random_fn: F,
    pub steps: usize,
    pub lambda_depth: usize,
}

impl<'a, R: GridReader, D: DependencyTracker, F: FnMut() -> f64> Evaluator<'a, R, D, F> {
    pub fn new(
        reader: &'a R,
        dep_tracker: Option<&'a mut D>,
        registry: &'a FunctionRegistry,
        limits: &'a ResourceLimits,
        now_ms: i64,
        random_fn: F,
    ) -> Self {
        Self {
            reader,
            dep_tracker,
            registry,
            limits,
            now_ms,
            random_fn,
            steps: 0,
            lambda_depth: 0,
        }
    }

    pub fn eval_ast(
        &mut self,
        ast: &AstNode,
        current_addr: &CellAddress,
        env: &HashMap<String, ComputedValue>,
    ) -> Result<ComputedValue, ErrorCode> {
        self.steps += 1;
        if self.steps > self.limits.max_evaluation_steps {
            return Err(ErrorCode::Calc);
        }

        match ast {
            AstNode::Literal(s) => Ok(ComputedValue::Scalar(s.clone())),

            AstNode::NameRef(name) => {
                let lower = name.to_lowercase();
                if let Some(val) = env.get(&lower) {
                    return Ok(val.clone());
                }
                // Workbook defined name
                if let Some(def_name) = self.reader.get_defined_name(Some(&current_addr.sheet_id), name) {
                    let parsed = parse_formula(&def_name.formula)?;
                    return self.eval_ast(&parsed, current_addr, env);
                }
                Err(ErrorCode::Name)
            }

            AstNode::CellRef { sheet, row, col, .. } => {
                let sheet_id = match sheet {
                    Some(s) => self.reader.resolve_sheet_name(s).unwrap_or_else(|| s.clone()),
                    None => current_addr.sheet_id.clone(),
                };
                let target = CellAddress {
                    sheet_id: sheet_id.clone(),
                    row: *row,
                    col: *col,
                };
                if let Some(tracker) = self.dep_tracker.as_mut() {
                    tracker.track_cell_dep(current_addr, &target);
                }
                self.reader.read_cell(&sheet_id, *row, *col)
            }

            AstNode::Range { from, to } => {
                let (from_sheet, r1, c1) = self.extract_ref_coords(from, current_addr)?;
                let (_to_sheet, r2, c2) = self.extract_ref_coords(to, current_addr)?;

                let top = r1.min(r2);
                let bottom = r1.max(r2);
                let left = c1.min(c2);
                let right = c1.max(c2);

                let rows = (bottom - top + 1) as usize;
                let cols = (right - left + 1) as usize;

                if rows.checked_mul(cols).is_none_or(|t| t > self.limits.max_array_cells) {
                    return Err(ErrorCode::Calc);
                }

                let range_ref = RangeRef {
                    sheet_id: from_sheet.clone(),
                    top,
                    bottom,
                    left,
                    right,
                };
                if let Some(tracker) = self.dep_tracker.as_mut() {
                    tracker.track_range_dep(current_addr, range_ref);
                }

                let mut values = Vec::with_capacity(rows * cols);
                for r in top..=bottom {
                    for c in left..=right {
                        let cell_val = self.reader.read_cell(&from_sheet, r, c)?;
                        values.push(cell_val.to_scalar());
                    }
                }

                ComputedValue::array(rows, cols, values)
            }

            AstNode::StructuredRef { table, section, column } => {
                let tbl = self.reader.get_table(&current_addr.sheet_id, table).ok_or(ErrorCode::Ref)?;
                let mut top = tbl.range.top;
                let mut bottom = tbl.range.bottom;
                let mut left = tbl.range.left;
                let mut right = tbl.range.right;

                if let Some(sec) = section {
                    if sec == "@" || sec == "#This Row" || sec == "#this row" {
                        if current_addr.row < tbl.range.top || current_addr.row > tbl.range.bottom {
                            return Err(ErrorCode::Ref);
                        }
                        top = current_addr.row;
                        bottom = current_addr.row;
                    } else if sec.eq_ignore_ascii_case("#headers") {
                        bottom = top;
                    } else if sec.eq_ignore_ascii_case("#totals") {
                        if !tbl.totals_row {
                            return Err(ErrorCode::Ref);
                        }
                        top = bottom;
                    }
                }

                if let Some(col_name) = column {
                    let col_idx = tbl.columns.iter().position(|c| c.name.eq_ignore_ascii_case(col_name)).ok_or(ErrorCode::Ref)?;
                    left = tbl.range.left + col_idx as u32;
                    right = left;
                }

                let rows = (bottom - top + 1) as usize;
                let cols = (right - left + 1) as usize;
                let mut values = Vec::with_capacity(rows * cols);
                for r in top..=bottom {
                    for c in left..=right {
                        let cell_val = self.reader.read_cell(&current_addr.sheet_id, r, c)?;
                        values.push(cell_val.to_scalar());
                    }
                }
                ComputedValue::array(rows, cols, values)
            }

            AstNode::ArrayLiteral { rows, cols, elements } => {
                let mut values = Vec::with_capacity(elements.len());
                for elem in elements {
                    let v = self.eval_ast(elem, current_addr, env)?;
                    values.push(v.to_scalar());
                }
                ComputedValue::array(*rows, *cols, values)
            }

            AstNode::Unary { op, expr } => {
                let val = self.eval_ast(expr, current_addr, env)?;
                let s = val.to_scalar();
                match op {
                    UnaryOp::Plus => {
                        let n = s.as_f64()?;
                        Ok(ComputedValue::number(n))
                    }
                    UnaryOp::Minus => {
                        let n = s.as_f64()?;
                        Ok(ComputedValue::number(-n))
                    }
                    UnaryOp::Percent => {
                        let n = s.as_f64()?;
                        Ok(ComputedValue::number(n / 100.0))
                    }
                }
            }

            AstNode::Binary { op, left, right } => {
                let left_val = self.eval_ast(left, current_addr, env)?;
                let right_val = self.eval_ast(right, current_addr, env)?;

                self.eval_binary_op(*op, left_val, right_val)
            }

            AstNode::FunctionCall { name, args } => {
                self.eval_function_call(name, args, current_addr, env)
            }

            AstNode::Apply { callee, args } => {
                self.eval_apply(callee, args, current_addr, env)
            }
        }
    }

    fn extract_ref_coords(
        &self,
        node: &AstNode,
        current_addr: &CellAddress,
    ) -> Result<(String, u32, u32), ErrorCode> {
        match node {
            AstNode::CellRef { sheet, row, col, .. } => {
                let s_id = match sheet {
                    Some(s) => self.reader.resolve_sheet_name(s).unwrap_or_else(|| s.clone()),
                    None => current_addr.sheet_id.clone(),
                };
                Ok((s_id, *row, *col))
            }
            _ => Err(ErrorCode::Ref),
        }
    }

    fn eval_binary_op(
        &self,
        op: BinaryOp,
        left_val: ComputedValue,
        right_val: ComputedValue,
    ) -> Result<ComputedValue, ErrorCode> {
        // Array broadcasting
        if left_val.is_array() || right_val.is_array() {
            let left_arr = left_val.to_array_value();
            let right_arr = right_val.to_array_value();

            let rows = left_arr.rows.max(right_arr.rows);
            let cols = left_arr.cols.max(right_arr.cols);

            if (left_arr.rows != rows && left_arr.rows != 1)
                || (right_arr.rows != rows && right_arr.rows != 1)
                || (left_arr.cols != cols && left_arr.cols != 1)
                || (right_arr.cols != cols && right_arr.cols != 1)
                || rows.checked_mul(cols).is_none_or(|t| t > self.limits.max_array_cells)
            {
                return Err(ErrorCode::Value);
            }

            let mut out_values = Vec::with_capacity(rows * cols);
            for r in 0..rows {
                for c in 0..cols {
                    let l = left_arr.get(r % left_arr.rows, c % left_arr.cols).unwrap_or(&Scalar::Null);
                    let rv = right_arr.get(r % right_arr.rows, c % right_arr.cols).unwrap_or(&Scalar::Null);
                    let res = self.eval_scalar_binary(op, l, rv);
                    out_values.push(match res {
                        Ok(ComputedValue::Scalar(s)) => s,
                        Err(code) => Scalar::error(code),
                        _ => Scalar::error(ErrorCode::Value),
                    });
                }
            }

            return ComputedValue::array(rows, cols, out_values);
        }

        let l = left_val.to_scalar();
        let r = right_val.to_scalar();
        self.eval_scalar_binary(op, &l, &r)
    }

    fn eval_scalar_binary(
        &self,
        op: BinaryOp,
        left: &Scalar,
        right: &Scalar,
    ) -> Result<ComputedValue, ErrorCode> {
        if let Scalar::Error { code, .. } = left {
            return Err(*code);
        }
        if let Scalar::Error { code, .. } = right {
            return Err(*code);
        }

        match op {
            BinaryOp::Add => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                Ok(ComputedValue::number(n1 + n2))
            }
            BinaryOp::Subtract => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                Ok(ComputedValue::number(n1 - n2))
            }
            BinaryOp::Multiply => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                Ok(ComputedValue::number(n1 * n2))
            }
            BinaryOp::Divide => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                if n2 == 0.0 {
                    Err(ErrorCode::Div0)
                } else {
                    Ok(ComputedValue::number(n1 / n2))
                }
            }
            BinaryOp::Power => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                if n1 < 0.0 && n2.fract() != 0.0 {
                    return Err(ErrorCode::Num);
                }
                let res = n1.powf(n2);
                if !res.is_finite() {
                    Err(ErrorCode::Num)
                } else {
                    Ok(ComputedValue::number(res))
                }
            }
            BinaryOp::Concat => {
                let s1 = left.as_string()?;
                let s2 = right.as_string()?;
                Ok(ComputedValue::string(format!("{}{}", s1, s2)))
            }
            BinaryOp::Eq => {
                Ok(ComputedValue::boolean(compare_scalars(left, right) == std::cmp::Ordering::Equal))
            }
            BinaryOp::Ne => {
                Ok(ComputedValue::boolean(compare_scalars(left, right) != std::cmp::Ordering::Equal))
            }
            BinaryOp::Lt => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                Ok(ComputedValue::boolean(n1 < n2))
            }
            BinaryOp::Lte => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                Ok(ComputedValue::boolean(n1 <= n2))
            }
            BinaryOp::Gt => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                Ok(ComputedValue::boolean(n1 > n2))
            }
            BinaryOp::Gte => {
                let n1 = left.as_f64()?;
                let n2 = right.as_f64()?;
                Ok(ComputedValue::boolean(n1 >= n2))
            }
            BinaryOp::Range => Err(ErrorCode::Value),
        }
    }

    fn eval_function_call(
        &mut self,
        name: &str,
        args: &[AstNode],
        current_addr: &CellAddress,
        env: &HashMap<String, ComputedValue>,
    ) -> Result<ComputedValue, ErrorCode> {
        let upper = name.to_uppercase();

        // 1. Validate declared arity
        self.registry.validate_arity(&upper, args.len())?;

        // 2. Special forms with short-circuit evaluation
        if upper == "IF" {
            let test_val = self.eval_ast(&args[0], current_addr, env)?;
            match &test_val {
                ComputedValue::Array { rows, cols, values, .. } => {
                    let mut yes_val: Option<ComputedValue> = None;
                    let mut no_val: Option<ComputedValue> = None;
                    let mut out_scalars = Vec::with_capacity(values.len());

                    for (i, cond) in values.iter().enumerate() {
                        if let Scalar::Error { code, .. } = cond {
                            out_scalars.push(Scalar::error(*code));
                            continue;
                        }
                        let is_true = match cond.as_bool() {
                            Ok(b) => b,
                            Err(code) => {
                                out_scalars.push(Scalar::error(code));
                                continue;
                            }
                        };

                        let branch_res = if is_true {
                            if yes_val.is_none() {
                                yes_val = Some(self.eval_ast(&args[1], current_addr, env)?);
                            }
                            yes_val.as_ref().unwrap()
                        } else {
                            if no_val.is_none() {
                                let val = if args.len() >= 3 {
                                    self.eval_ast(&args[2], current_addr, env)?
                                } else {
                                    ComputedValue::boolean(false)
                                };
                                no_val = Some(val);
                            }
                            no_val.as_ref().unwrap()
                        };

                        match branch_res {
                            ComputedValue::Array { rows: br, cols: bc, values: bv, .. } => {
                                if (*br != 1 && *br != *rows) || (*bc != 1 && *bc != *cols) {
                                    return Err(ErrorCode::Value);
                                }
                                let r = i / cols;
                                let c = i % cols;
                                let val = bv.get((r % br) * bc + (c % bc)).cloned().unwrap_or(Scalar::Null);
                                out_scalars.push(val);
                            }
                            ComputedValue::Scalar(s) => {
                                out_scalars.push(s.clone());
                            }
                        }
                    }
                    return ComputedValue::array(*rows, *cols, out_scalars);
                }
                ComputedValue::Scalar(s) => {
                    if let Scalar::Error { code, .. } = s {
                        return Err(*code);
                    }
                    let is_true = s.as_bool()?;
                    if is_true {
                        return self.eval_ast(&args[1], current_addr, env);
                    } else if args.len() >= 3 {
                        return self.eval_ast(&args[2], current_addr, env);
                    } else {
                        return Ok(ComputedValue::boolean(false));
                    }
                }
            }
        }

        if upper == "IFS" {
            if !args.len().is_multiple_of(2) || args.is_empty() {
                return Err(ErrorCode::Value);
            }
            for i in (0..args.len()).step_by(2) {
                let cond_val = self.eval_ast(&args[i], current_addr, env)?.to_scalar();
                if let Scalar::Error { code, .. } = cond_val {
                    return Err(code);
                }
                if cond_val.as_bool()? {
                    return self.eval_ast(&args[i + 1], current_addr, env);
                }
            }
            return Err(ErrorCode::NA);
        }

        if upper == "IFERROR" {
            let first_res = self.eval_ast(&args[0], current_addr, env);
            match first_res {
                Ok(ComputedValue::Array { rows, cols, values, .. }) => {
                    let mut fallback_val: Option<ComputedValue> = None;
                    let mut new_values = Vec::with_capacity(values.len());
                    for (i, val) in values.into_iter().enumerate() {
                        if val.is_error() {
                            if fallback_val.is_none() {
                                fallback_val = Some(self.eval_ast(&args[1], current_addr, env)?);
                            }
                            let fb = fallback_val.as_ref().unwrap();
                            match fb {
                                ComputedValue::Array { values: fb_vals, .. } => {
                                    new_values.push(fb_vals.get(i).cloned().unwrap_or(Scalar::error(ErrorCode::NA)));
                                }
                                ComputedValue::Scalar(s) => new_values.push(s.clone()),
                            }
                        } else {
                            new_values.push(val);
                        }
                    }
                    return ComputedValue::array(rows, cols, new_values);
                }
                Ok(ComputedValue::Scalar(s)) => {
                    if s.is_error() {
                        return self.eval_ast(&args[1], current_addr, env);
                    } else {
                        return Ok(ComputedValue::Scalar(s));
                    }
                }
                Err(_) => return self.eval_ast(&args[1], current_addr, env),
            }
        }

        if upper == "IFNA" {
            let first_res = self.eval_ast(&args[0], current_addr, env);
            match first_res {
                Ok(ComputedValue::Array { rows, cols, values, .. }) => {
                    let mut fallback_val: Option<ComputedValue> = None;
                    let mut new_values = Vec::with_capacity(values.len());
                    for (i, val) in values.into_iter().enumerate() {
                        if let Scalar::Error { code: ErrorCode::NA, .. } = val {
                            if fallback_val.is_none() {
                                fallback_val = Some(self.eval_ast(&args[1], current_addr, env)?);
                            }
                            let fb = fallback_val.as_ref().unwrap();
                            match fb {
                                ComputedValue::Array { values: fb_vals, .. } => {
                                    new_values.push(fb_vals.get(i).cloned().unwrap_or(Scalar::error(ErrorCode::NA)));
                                }
                                ComputedValue::Scalar(s) => new_values.push(s.clone()),
                            }
                        } else {
                            new_values.push(val);
                        }
                    }
                    return ComputedValue::array(rows, cols, new_values);
                }
                Ok(ComputedValue::Scalar(Scalar::Error { code: ErrorCode::NA, .. })) => {
                    return self.eval_ast(&args[1], current_addr, env);
                }
                Ok(val) => return Ok(val),
                Err(ErrorCode::NA) => return self.eval_ast(&args[1], current_addr, env),
                Err(e) => return Err(e),
            }
        }

        if upper == "SWITCH" {
            let target_val = self.eval_ast(&args[0], current_addr, env)?.to_scalar();
            if let Scalar::Error { code, .. } = target_val {
                return Err(code);
            }
            let mut i = 1;
            while i + 1 < args.len() {
                let case_key = self.eval_ast(&args[i], current_addr, env)?.to_scalar();
                if compare_scalars(&target_val, &case_key) == std::cmp::Ordering::Equal {
                    return self.eval_ast(&args[i + 1], current_addr, env);
                }
                i += 2;
            }
            if i < args.len() {
                return self.eval_ast(&args[i], current_addr, env);
            }
            return Err(ErrorCode::NA);
        }

        if upper == "CHOOSE" {
            let idx_f = self.eval_ast(&args[0], current_addr, env)?.to_scalar().as_f64()?;
            let idx = idx_f.trunc() as i64;
            if idx < 1 || idx as usize >= args.len() {
                return Err(ErrorCode::Value);
            }
            return self.eval_ast(&args[idx as usize], current_addr, env);
        }

        if upper == "LET" {
            if args.len().is_multiple_of(2) || args.len() < 3 {
                return Err(ErrorCode::Value);
            }
            let mut local_env = env.clone();
            let mut i = 0;
            while i + 1 < args.len() - 1 {
                let var_name = match &args[i] {
                    AstNode::NameRef(n) => n.to_lowercase(),
                    _ => return Err(ErrorCode::Name),
                };
                let val = self.eval_ast(&args[i + 1], current_addr, &local_env);
                let val_computed = match val {
                    Ok(cv) => cv,
                    Err(code) => ComputedValue::Scalar(Scalar::error(code)),
                };
                local_env.insert(var_name, val_computed);
                i += 2;
            }
            return self.eval_ast(args.last().unwrap(), current_addr, &local_env);
        }

        if upper == "LAMBDA" {
            // A bare LAMBDA without application is #CALC!
            return Err(ErrorCode::Calc);
        }

        if upper == "OFFSET" {
            let origin_node = &args[0];
            let (sheet_id, base_row, base_col, base_rows, base_cols) = match origin_node {
                AstNode::CellRef { sheet, row, col, .. } => {
                    let s = match sheet {
                        Some(name) => self.reader.resolve_sheet_name(name).unwrap_or_else(|| name.clone()),
                        None => current_addr.sheet_id.clone(),
                    };
                    (s, *row, *col, 1u32, 1u32)
                }
                AstNode::Range { from, to } => {
                    let (s, r1, c1) = self.extract_ref_coords(from, current_addr)?;
                    let (_, r2, c2) = self.extract_ref_coords(to, current_addr)?;
                    let rows = r1.max(r2) - r1.min(r2) + 1;
                    let cols = c1.max(c2) - c1.min(c2) + 1;
                    (s, r1.min(r2), c1.min(c2), rows, cols)
                }
                _ => return Err(ErrorCode::Ref),
            };

            let row_offset_f = self.eval_ast(&args[1], current_addr, env)?.to_scalar().as_f64()?;
            let col_offset_f = self.eval_ast(&args[2], current_addr, env)?.to_scalar().as_f64()?;
            let height_f = if args.len() >= 4 {
                self.eval_ast(&args[3], current_addr, env)?.to_scalar().as_f64()?
            } else {
                base_rows as f64
            };
            let width_f = if args.len() >= 5 {
                self.eval_ast(&args[4], current_addr, env)?.to_scalar().as_f64()?
            } else {
                base_cols as f64
            };

            let target_row_i = base_row as i64 + row_offset_f.trunc() as i64;
            let target_col_i = base_col as i64 + col_offset_f.trunc() as i64;
            let height_i = height_f.trunc() as i64;
            let width_i = width_f.trunc() as i64;

            if target_row_i < 0 || target_col_i < 0 || height_i < 1 || width_i < 1 {
                return Err(ErrorCode::Ref);
            }

            let target_row = target_row_i as u32;
            let target_col = target_col_i as u32;
            let height = height_i as u32;
            let width = width_i as u32;

            if target_row + height > crate::types::GRID_ROWS || target_col + width > crate::types::GRID_COLUMNS {
                return Err(ErrorCode::Ref);
            }

            let total_cells = (height as usize) * (width as usize);
            if total_cells > self.limits.max_array_cells {
                return Err(ErrorCode::Ref);
            }

            let mut values = Vec::with_capacity(total_cells);
            for r in target_row..target_row + height {
                for c in target_col..target_col + width {
                    let cell_val = self.reader.read_cell(&sheet_id, r, c)?;
                    values.push(cell_val.to_scalar());
                }
            }

            return if height == 1 && width == 1 {
                Ok(ComputedValue::Scalar(values[0].clone()))
            } else {
                ComputedValue::array(height as usize, width as usize, values)
            };
        }

        if upper == "INDIRECT" {
            let ref_text_val = self.eval_ast(&args[0], current_addr, env)?;
            let ref_text = ref_text_val.to_scalar().as_string()?;
            let parsed = parse_formula(&ref_text).map_err(|_| ErrorCode::Ref)?;
            return match &parsed {
                AstNode::CellRef { .. } | AstNode::Range { .. } => {
                    self.eval_ast(&parsed, current_addr, env)
                }
                _ => Err(ErrorCode::Ref),
            };
        }

        // 3. Standard eager functions
        let mut evaluated_args = Vec::with_capacity(args.len());
        for arg in args {
            evaluated_args.push(self.eval_ast(arg, current_addr, env)?);
        }

        invoke_standard_function(&upper, &evaluated_args, self.now_ms, &mut self.random_fn)
    }

    fn eval_apply(
        &mut self,
        callee: &AstNode,
        args: &[AstNode],
        current_addr: &CellAddress,
        env: &HashMap<String, ComputedValue>,
    ) -> Result<ComputedValue, ErrorCode> {
        self.lambda_depth += 1;
        if self.lambda_depth > self.limits.max_lambda_depth {
            return Err(ErrorCode::Calc);
        }

        if let AstNode::FunctionCall { name, args: lambda_args } = callee {
            if name.eq_ignore_ascii_case("LAMBDA") {
                if lambda_args.is_empty() {
                    return Err(ErrorCode::Value);
                }
                let body = lambda_args.last().unwrap();
                let param_count = lambda_args.len() - 1;
                if args.len() != param_count {
                    return Err(ErrorCode::Value);
                }

                let mut local_env = env.clone();
                for i in 0..param_count {
                    let p_name = match &lambda_args[i] {
                        AstNode::NameRef(n) => n.to_lowercase(),
                        _ => return Err(ErrorCode::Value),
                    };
                    let arg_val = self.eval_ast(&args[i], current_addr, env)?;
                    local_env.insert(p_name, arg_val);
                }

                let res = self.eval_ast(body, current_addr, &local_env);
                self.lambda_depth -= 1;
                return res;
            }
        }

        self.lambda_depth -= 1;
        Err(ErrorCode::Value)
    }
}
