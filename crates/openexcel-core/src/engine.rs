use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use crate::evaluator::{DependencyTracker, Evaluator, GridReader};
use crate::functions::FunctionRegistry;
use crate::graph::{CycleDetector, DependencyGraph};
use crate::grid::WorkbookGrid;
use crate::parser::parse_formula;
use crate::spill::SpillManager;
use crate::types::{
    Cell, CellAddress, CellInput, ComputedValue, DefinedName, ErrorCode,
    RangeRef, ResourceLimits, TableDefinition, Workbook,
};

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

        // 1. Check computed value cache
        if let Some(val) = self.computed.borrow().get(&addr) {
            return Ok(val.clone());
        }

        // 2. Check if this cell is a spilled child of an anchor
        if let Some(anchor) = self.spills.borrow().get_anchor_for_child(&addr).cloned() {
            if let Some(ComputedValue::Array { rows, cols, values, .. }) = self.computed.borrow().get(&anchor) {
                let r = (row - anchor.row) as usize;
                let c = (col - anchor.col) as usize;
                if r < *rows && c < *cols {
                    let val = values[r * (*cols) + c].clone();
                    return Ok(ComputedValue::Scalar(val));
                }
            }
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
                                    Ok(_) => {
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
        for (sheet_id, sheet_grid) in &grid.sheets {
            for (r, c, cell) in sheet_grid.iter_cells() {
                if matches!(cell.input, CellInput::Formula { .. }) {
                    dirty.insert(CellAddress {
                        sheet_id: sheet_id.clone(),
                        row: r,
                        col: c,
                    });
                }
            }
        }

        Self {
            grid,
            graph: RefCell::new(DependencyGraph::new()),
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
            self.dirty.insert(child);
        }

        // If cell was a child of a spill, invalidate the anchor
        if let Some(anchor) = self.spills.borrow().get_anchor_for_child(&addr).cloned() {
            self.computed.borrow_mut().remove(&anchor);
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

        let dirty_list: Vec<CellAddress> = self.dirty.drain().collect();
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

        for addr in &dirty_list {
            self.computed.borrow_mut().remove(addr);
        }

        for addr in dirty_list {
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
