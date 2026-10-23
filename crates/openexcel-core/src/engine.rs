use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use crate::evaluator::{DependencyTracker, Evaluator, GridReader};
use crate::functions::FunctionRegistry;
use crate::graph::{CycleDetector, DependencyGraph};
use crate::grid::WorkbookGrid;
use crate::parser::parse_formula;
use crate::spill::SpillManager;
use crate::ast::AstNode;
use crate::types::{
    Cell, CellAddress, CellInput, ComputedValue, DefinedName, ErrorCode,
    RangeRef, ResourceLimits, TableDefinition, Workbook,
};

fn extract_ast_dependencies(
    node: &AstNode,
    current_addr: &CellAddress,
    grid: &WorkbookGrid,
    graph: &mut DependencyGraph,
) {
    match node {
        AstNode::CellRef { sheet, row, col, .. } => {
            let sheet_id = match sheet {
                Some(s) => grid.resolve_sheet_id(s).unwrap_or(s).to_string(),
                None => current_addr.sheet_id.clone(),
            };
            let target = CellAddress {
                sheet_id,
                row: *row,
                col: *col,
            };
            graph.add_cell_dependency(current_addr, &target);
        }
        AstNode::Range { from, to } => {
            if let (
                AstNode::CellRef { sheet: s1, row: r1, col: c1, .. },
                AstNode::CellRef { sheet: s2, row: r2, col: c2, .. },
            ) = (&**from, &**to)
            {
                let sheet_str = s1.as_ref().or(s2.as_ref());
                let sheet_id = match sheet_str {
                    Some(s) => grid.resolve_sheet_id(s).unwrap_or(s).to_string(),
                    None => current_addr.sheet_id.clone(),
                };
                let top = (*r1).min(*r2);
                let bottom = (*r1).max(*r2);
                let left = (*c1).min(*c2);
                let right = (*c1).max(*c2);
                let range_ref = RangeRef {
                    sheet_id: sheet_id.clone(),
                    top,
                    left,
                    bottom,
                    right,
                };
                graph.add_range_dependency(current_addr, range_ref);

                let cell_count = ((bottom - top + 1) as usize).saturating_mul((right - left + 1) as usize);
                if cell_count <= 2048 {
                    for r in top..=bottom {
                        for c in left..=right {
                            graph.add_cell_dependency(
                                current_addr,
                                &CellAddress {
                                    sheet_id: sheet_id.clone(),
                                    row: r,
                                    col: c,
                                },
                            );
                        }
                    }
                }
            } else {
                extract_ast_dependencies(from, current_addr, grid, graph);
                extract_ast_dependencies(to, current_addr, grid, graph);
            }
        }
        AstNode::Unary { expr, .. } => {
            extract_ast_dependencies(expr, current_addr, grid, graph);
        }
        AstNode::Binary { left, right, .. } => {
            extract_ast_dependencies(left, current_addr, grid, graph);
            extract_ast_dependencies(right, current_addr, grid, graph);
        }
        AstNode::FunctionCall { args, .. } => {
            for arg in args {
                extract_ast_dependencies(arg, current_addr, grid, graph);
            }
        }
        AstNode::ArrayLiteral { elements, .. } => {
            for elem in elements {
                extract_ast_dependencies(elem, current_addr, grid, graph);
            }
        }
        AstNode::Apply { callee, args } => {
            extract_ast_dependencies(callee, current_addr, grid, graph);
            for arg in args {
                extract_ast_dependencies(arg, current_addr, grid, graph);
            }
        }
        _ => {}
    }
}

pub struct DeterministicPrng {
    state: u64,
}

impl DeterministicPrng {
    pub fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 { 12345 } else { seed },
        }
    }

    pub fn next_f64(&mut self) -> f64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        (x as f64) / (u64::MAX as f64)
    }
}

pub struct EngineGridReader<'a> {
    pub grid: &'a WorkbookGrid,
    pub computed: &'a RefCell<HashMap<CellAddress, ComputedValue>>,
    pub spills: &'a RefCell<SpillManager>,
    pub cycle_detector: &'a RefCell<CycleDetector>,
    pub graph: &'a RefCell<DependencyGraph>,
    pub registry: &'a FunctionRegistry,
    pub limits: &'a ResourceLimits,
    pub tables: &'a HashMap<String, Vec<TableDefinition>>,
    pub names: &'a [DefinedName],
    pub now_ms: i64,
    pub random_seed: u64,
}

impl<'a> GridReader for EngineGridReader<'a> {
    fn read_cell(&self, sheet_id: &str, row: u32, col: u32) -> Result<ComputedValue, ErrorCode> {
        let actual_sheet_id = self.grid.resolve_sheet_id(sheet_id).unwrap_or(sheet_id).to_string();
        let addr = CellAddress {
            sheet_id: actual_sheet_id.clone(),
            row,
            col,
        };

        // 1. Check if this cell is a spilled child of an anchor
        let anchor_opt = self.spills.borrow().get_anchor_for_child(&addr).cloned();
        if let Some(anchor) = anchor_opt {
            let anchor_computed = self.computed.borrow().contains_key(&anchor);
            if !anchor_computed {
                let _ = self.read_cell(&anchor.sheet_id, anchor.row, anchor.col);
            }
            if let Some(ComputedValue::Array { rows, cols, values, .. }) = self.computed.borrow().get(&anchor) {
                let r = (row - anchor.row) as usize;
                let c = (col - anchor.col) as usize;
                if r < *rows && c < *cols {
                    let val = values[r * (*cols) + c].clone();
                    return Ok(ComputedValue::Scalar(val));
                }
            }
        }

        // 2. Check computed value cache
        let cached_opt = self.computed.borrow().get(&addr).cloned();
        if let Some(val) = cached_opt {
            return Ok(val);
        }

        // 3. Check authored cell in grid
        if let Some(cell) = self.grid.get_cell(&actual_sheet_id, row, col) {
            match &cell.input {
                CellInput::Value { value } => {
                    let cv = ComputedValue::Scalar(value.clone());
                    self.computed.borrow_mut().insert(addr, cv.clone());
                    Ok(cv)
                }
                CellInput::Formula { source } => {
                    // On-demand evaluation for formula cell
                    if self.cycle_detector.borrow().is_active(&addr) {
                        return Err(ErrorCode::Circ);
                    }

                    self.cycle_detector.borrow_mut().enter(&addr)?;
                    self.graph.borrow_mut().clear_dependencies(&addr);

                    let ast = match parse_formula(source) {
                        Ok(node) => node,
                        Err(code) => {
                            self.cycle_detector.borrow_mut().exit(&addr);
                            self.computed.borrow_mut().insert(addr.clone(), ComputedValue::error(code));
                            return Err(code);
                        }
                    };

                    let mut prng = DeterministicPrng::new(self.random_seed);
                    let computed_res = {
                        let mut dep_tracker = EngineRefCellDepCollector {
                            from_cell: addr.clone(),
                            graph: self.graph,
                        };
                        let mut evaluator = Evaluator::new(
                            self,
                            Some(&mut dep_tracker),
                            self.registry,
                            self.limits,
                            self.now_ms,
                            || prng.next_f64(),
                        );
                        let env = HashMap::new();
                        evaluator.eval_ast(&ast, &addr, &env)
                    };

                    self.cycle_detector.borrow_mut().exit(&addr);

                    let computed_res = match computed_res {
                        Ok(ComputedValue::Lambda { .. }) => Err(ErrorCode::Calc),
                        other => other,
                    };

                    match computed_res {
                        Ok(val) => {
                            if let ComputedValue::Array { rows, cols, .. } = &val {
                                let is_occupied = |s: &str, r: u32, c: u32| -> bool {
                                    if let Some(c_cell) = self.grid.get_cell(s, r, c) {
                                        match &c_cell.input {
                                            CellInput::Value { value } => !value.is_null(),
                                            CellInput::Formula { .. } => true,
                                        }
                                    } else {
                                        false
                                    }
                                };
                                match self.spills.borrow_mut().register_spill(&addr, *rows, *cols, is_occupied) {
                                    Ok(Some(rect)) => {
                                        for r in rect.top..=rect.bottom {
                                            for c in rect.left..=rect.right {
                                                if r == addr.row && c == addr.col {
                                                    continue;
                                                }
                                                let child_addr = CellAddress {
                                                    sheet_id: addr.sheet_id.clone(),
                                                    row: r,
                                                    col: c,
                                                };
                                                self.computed.borrow_mut().remove(&child_addr);
                                            }
                                        }
                                        self.computed.borrow_mut().insert(addr.clone(), val.clone());
                                        Ok(val)
                                    }
                                    Ok(None) => {
                                        self.computed.borrow_mut().insert(addr.clone(), val.clone());
                                        Ok(val)
                                    }
                                    Err(spill_err) => {
                                        let err_val = ComputedValue::error(spill_err);
                                        self.computed.borrow_mut().insert(addr.clone(), err_val);
                                        Err(spill_err)
                                    }
                                }
                            } else {
                                self.spills.borrow_mut().clear_spill(&addr);
                                self.computed.borrow_mut().insert(addr.clone(), val.clone());
                                Ok(val)
                            }
                        }
                        Err(code) => {
                            let err_val = ComputedValue::error(code);
                            self.computed.borrow_mut().insert(addr.clone(), err_val);
                            Err(code)
                        }
                    }
                }
            }
        } else {
            Ok(ComputedValue::null())
        }
    }

    fn resolve_sheet_name(&self, sheet_name_or_id: &str) -> Option<String> {
        self.grid.resolve_sheet_id(sheet_name_or_id).map(|s| s.to_string())
    }

    fn get_table(&self, sheet_id: &str, table_name: &str) -> Option<&TableDefinition> {
        let actual_sheet_id = self.grid.resolve_sheet_id(sheet_id).unwrap_or(sheet_id);
        if let Some(tbls) = self.tables.get(actual_sheet_id) {
            return tbls.iter().find(|t| t.name.eq_ignore_ascii_case(table_name));
        }
        for tbls in self.tables.values() {
            if let Some(t) = tbls.iter().find(|t| t.name.eq_ignore_ascii_case(table_name)) {
                return Some(t);
            }
        }
        None
    }

    fn get_defined_name(&self, scope_sheet_id: Option<&str>, name: &str) -> Option<&DefinedName> {
        self.names.iter().find(|n| {
            n.name.eq_ignore_ascii_case(name)
                && (n.scope.is_none() || n.scope.as_deref() == scope_sheet_id)
        })
    }
}

pub struct EngineRefCellDepCollector<'a> {
    pub from_cell: CellAddress,
    pub graph: &'a RefCell<DependencyGraph>,
}

impl<'a> DependencyTracker for EngineRefCellDepCollector<'a> {
    fn track_cell_dep(&mut self, _from: &CellAddress, to: &CellAddress) {
        self.graph.borrow_mut().add_cell_dependency(&self.from_cell, to);
    }

    fn track_range_dep(&mut self, _from: &CellAddress, range: RangeRef) {
        self.graph.borrow_mut().add_range_dependency(&self.from_cell, range);
    }
}

#[derive(Debug, Clone, Default)]
pub struct RecalcResult {
    pub calculated_count: usize,
    pub errors: Vec<(CellAddress, ErrorCode)>,
}

pub struct Engine {
    pub grid: WorkbookGrid,
    pub graph: RefCell<DependencyGraph>,
    pub spills: RefCell<SpillManager>,
    pub computed: RefCell<HashMap<CellAddress, ComputedValue>>,
    pub cycle_detector: RefCell<CycleDetector>,
    pub registry: FunctionRegistry,
    pub limits: ResourceLimits,
    pub tables: HashMap<String, Vec<TableDefinition>>,
    pub names: Vec<DefinedName>,
    pub now_ms: i64,
    pub random_seed: u64,
    pub blocked_spills: HashSet<CellAddress>,
    dirty: HashSet<CellAddress>,
}

impl Engine {
    pub fn new(wb: &Workbook) -> Self {
        let grid = WorkbookGrid::from_workbook(wb);
        let mut tables = HashMap::new();
        for (sheet_id, sheet) in &wb.sheets {
            tables.insert(sheet_id.clone(), sheet.properties.tables.clone());
        }

        let mut dirty = HashSet::new();
        let mut graph = DependencyGraph::new();
        for (sheet_id, sheet_grid) in &grid.sheets {
            for (r, c, cell) in sheet_grid.iter_cells() {
                if let CellInput::Formula { source } = &cell.input {
                    let addr = CellAddress {
                        sheet_id: sheet_id.clone(),
                        row: r,
                        col: c,
                    };
                    dirty.insert(addr.clone());
                    if let Ok(ast) = parse_formula(source) {
                        extract_ast_dependencies(&ast, &addr, &grid, &mut graph);
                    }
                }
            }
        }

        Self {
            grid,
            graph: RefCell::new(graph),
            spills: RefCell::new(SpillManager::new()),
            computed: RefCell::new(HashMap::new()),
            cycle_detector: RefCell::new(CycleDetector::new()),
            registry: FunctionRegistry::new(),
            limits: ResourceLimits::default(),
            tables,
            names: wb.names.clone(),
            now_ms: 1704153600000, // 2024-01-02T00:00:00.000Z
            random_seed: 12345,
            blocked_spills: HashSet::new(),
            dirty,
        }
    }

    pub fn set_clock(&mut self, now_ms: i64) {
        self.now_ms = now_ms;
    }

    pub fn set_seed(&mut self, seed: u64) {
        self.random_seed = seed;
    }

    pub fn set_cell(&mut self, sheet_id: &str, row: u32, col: u32, cell: Cell) {
        let actual_id = self.grid.resolve_sheet_id(sheet_id).unwrap_or(sheet_id).to_string();
        let addr = CellAddress {
            sheet_id: actual_id.clone(),
            row,
            col,
        };

        // If cell was an anchor, clear its spill
        let cleared = self.spills.borrow_mut().clear_spill(&addr);
        for child in cleared {
            self.computed.borrow_mut().remove(&child);
            self.dirty.insert(child);
        }

        // If cell was a child of a spill, invalidate the anchor and remove child from computed
        if let Some(anchor) = self.spills.borrow().get_anchor_for_child(&addr).cloned() {
            self.computed.borrow_mut().remove(&anchor);
            self.computed.borrow_mut().remove(&addr);
            self.dirty.insert(anchor);
        }

        // Invalidate all downstream dependents from previous calculations
        let dependents = self.graph.borrow().get_downstream_worklist(std::slice::from_ref(&addr));
        for d in dependents {
            self.computed.borrow_mut().remove(&d);
            self.dirty.insert(d);
        }

        // Re-evaluate any blocked spills in the sheet when cell edits occur
        for blocked in self.blocked_spills.clone() {
            self.computed.borrow_mut().remove(&blocked);
            self.dirty.insert(blocked);
        }

        self.graph.borrow_mut().clear_dependencies(&addr);
        if let CellInput::Formula { source } = &cell.input {
            if let Ok(ast) = parse_formula(source) {
                extract_ast_dependencies(&ast, &addr, &self.grid, &mut self.graph.borrow_mut());
            }
        }

        self.computed.borrow_mut().remove(&addr);
        self.grid.set_cell(&actual_id, row, col, cell);
        self.dirty.insert(addr);
    }

    pub fn evaluate_formula(
        &mut self,
        formula: &str,
        origin: &CellAddress,
        now_ms: Option<i64>,
        random_seed: Option<u64>,
    ) -> ComputedValue {
        let epoch = now_ms.unwrap_or(self.now_ms);
        let seed = random_seed.unwrap_or(self.random_seed);
        let mut prng = DeterministicPrng::new(seed);

        let ast = match parse_formula(formula) {
            Ok(node) => node,
            Err(code) => return ComputedValue::error(code),
        };

        let reader = EngineGridReader {
            grid: &self.grid,
            computed: &self.computed,
            spills: &self.spills,
            cycle_detector: &self.cycle_detector,
            graph: &self.graph,
            registry: &self.registry,
            limits: &self.limits,
            tables: &self.tables,
            names: &self.names,
            now_ms: epoch,
            random_seed: seed,
        };

        let mut evaluator = Evaluator::new(
            &reader,
            None::<&mut EngineRefCellDepCollector>,
            &self.registry,
            &self.limits,
            epoch,
            || prng.next_f64(),
        );

        let env = HashMap::new();
        match evaluator.eval_ast(&ast, origin, &env) {
            Ok(ComputedValue::Lambda { .. }) => ComputedValue::error(ErrorCode::Calc),
            Ok(val) => val,
            Err(code) => ComputedValue::error(code),
        }
    }

    pub fn get_computed_value(&mut self, addr: &CellAddress) -> ComputedValue {
        let actual_sheet_id = match self.grid.resolve_sheet_id(&addr.sheet_id) {
            Some(id) => id.to_string(),
            None => return ComputedValue::null(),
        };
        let canonical_addr = CellAddress {
            sheet_id: actual_sheet_id,
            row: addr.row,
            col: addr.col,
        };

        if self.dirty.contains(&canonical_addr) {
            self.recalculate();
        }

        let reader = EngineGridReader {
            grid: &self.grid,
            computed: &self.computed,
            spills: &self.spills,
            cycle_detector: &self.cycle_detector,
            graph: &self.graph,
            registry: &self.registry,
            limits: &self.limits,
            tables: &self.tables,
            names: &self.names,
            now_ms: self.now_ms,
            random_seed: self.random_seed,
        };

        reader.read_cell(&canonical_addr.sheet_id, canonical_addr.row, canonical_addr.col).unwrap_or(ComputedValue::null())
    }

    pub fn get_computed_values(&mut self, addresses: &[CellAddress]) -> HashMap<String, ComputedValue> {
        self.recalculate();
        let mut result = HashMap::new();
        for addr in addresses {
            let key = format!("{}/{}:{}", addr.sheet_id, addr.row, addr.col);
            let val = self.get_computed_value(addr);
            result.insert(key, val);
        }
        result
    }

    pub fn recalculate(&mut self) -> RecalcResult {
        let mut result = RecalcResult::default();
        if self.dirty.is_empty() {
            return result;
        }

        let dirty_set: HashSet<CellAddress> = std::mem::take(&mut self.dirty);

        // 1. Invalidate cached computed entries for all dirty cells
        for addr in &dirty_set {
            self.computed.borrow_mut().remove(addr);
        }

        // 2. Ensure AST dependencies are recorded for all dirty formula cells
        for addr in &dirty_set {
            if !self.graph.borrow().deps.contains_key(addr) {
                if let Some(cell) = self.grid.get_cell(&addr.sheet_id, addr.row, addr.col) {
                    if let CellInput::Formula { source } = &cell.input {
                        if let Ok(ast) = parse_formula(source) {
                            extract_ast_dependencies(&ast, addr, &self.grid, &mut self.graph.borrow_mut());
                        }
                    }
                }
            }
        }

        // 3. Compute in-degree within the dirty set using graph.deps
        let graph_ref = self.graph.borrow();
        let mut in_degree: HashMap<CellAddress, usize> = HashMap::with_capacity(dirty_set.len());
        for u in &dirty_set {
            let mut deg = 0;
            if let Some(deps) = graph_ref.deps.get(u) {
                for d in deps {
                    if dirty_set.contains(d) && d != u {
                        deg += 1;
                    }
                }
            }
            in_degree.insert(u.clone(), deg);
        }

        // 4. Seed queue with cells having in-degree 0 (dependencies/roots)
        let mut queue = std::collections::VecDeque::new();
        for u in &dirty_set {
            if in_degree.get(u) == Some(&0) {
                queue.push_back(u.clone());
            }
        }

        // 5. Kahn's topological sort: dependencies before dependents
        let mut sorted_list = Vec::with_capacity(dirty_set.len());
        let mut visited = HashSet::with_capacity(dirty_set.len());

        while let Some(u) = queue.pop_front() {
            if !visited.insert(u.clone()) {
                continue;
            }
            sorted_list.push(u.clone());

            let direct_dependents = graph_ref.get_direct_dependents(&u);
            for v in direct_dependents {
                if dirty_set.contains(&v) && v != u {
                    if let Some(deg) = in_degree.get_mut(&v) {
                        if *deg > 0 {
                            *deg -= 1;
                            if *deg == 0 {
                                queue.push_back(v);
                            }
                        }
                    }
                }
            }
        }

        // 6. Append any remaining unvisited cells (e.g. cyclic references)
        if sorted_list.len() < dirty_set.len() {
            for u in &dirty_set {
                if visited.insert(u.clone()) {
                    sorted_list.push(u.clone());
                }
            }
        }
        drop(graph_ref);

        let reader = EngineGridReader {
            grid: &self.grid,
            computed: &self.computed,
            spills: &self.spills,
            cycle_detector: &self.cycle_detector,
            graph: &self.graph,
            registry: &self.registry,
            limits: &self.limits,
            tables: &self.tables,
            names: &self.names,
            now_ms: self.now_ms,
            random_seed: self.random_seed,
        };

        for addr in sorted_list {
            match reader.read_cell(&addr.sheet_id, addr.row, addr.col) {
                Ok(val) => {
                    result.calculated_count += 1;
                    if let Some(code) = val.error_code() {
                        if code == ErrorCode::Spill {
                            self.blocked_spills.insert(addr.clone());
                        } else {
                            self.blocked_spills.remove(&addr);
                        }
                        result.errors.push((addr, code));
                    } else {
                        self.blocked_spills.remove(&addr);
                    }
                }
                Err(code) => {
                    if code == ErrorCode::Spill {
                        self.blocked_spills.insert(addr.clone());
                    } else {
                        self.blocked_spills.remove(&addr);
                    }
                    result.errors.push((addr, code));
                }
            }
        }

        result
    }
}
