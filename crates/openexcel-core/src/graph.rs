use std::collections::{HashMap, HashSet};
use crate::types::{CellAddress, ErrorCode, RangeRef};

pub const RANGE_BUCKET_SIZE: u32 = 256;

#[derive(Debug, Clone, Default)]
pub struct DependencyGraph {
    /// Forward dependencies: Cell A depends on Cell B
    pub deps: HashMap<CellAddress, HashSet<CellAddress>>,
    /// Reverse dependencies: Cell B is depended on by Cell A
    pub reverse_deps: HashMap<CellAddress, HashSet<CellAddress>>,
    /// Range dependencies: Cell A depends on Range R
    pub range_deps: HashMap<CellAddress, Vec<RangeRef>>,
    /// Spatial range index: (sheet_id, row / 256) -> set of Cells with range dependencies intersecting this bucket
    pub range_buckets: HashMap<(String, u32), HashSet<CellAddress>>,
}

impl DependencyGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear_dependencies(&mut self, cell: &CellAddress) {
        // Remove forward edges
        if let Some(old_deps) = self.deps.remove(cell) {
            for dep in old_deps {
                if let Some(rev) = self.reverse_deps.get_mut(&dep) {
                    rev.remove(cell);
                    if rev.is_empty() {
                        self.reverse_deps.remove(&dep);
                    }
                }
            }
        }

        // Remove range dependencies and clean spatial index
        if let Some(old_ranges) = self.range_deps.remove(cell) {
            for r in old_ranges {
                let start_bucket = r.top / RANGE_BUCKET_SIZE;
                let end_bucket = r.bottom / RANGE_BUCKET_SIZE;
                for b in start_bucket..=end_bucket {
                    let key = (r.sheet_id.clone(), b);
                    if let Some(bucket_set) = self.range_buckets.get_mut(&key) {
                        bucket_set.remove(cell);
                        if bucket_set.is_empty() {
                            self.range_buckets.remove(&key);
                        }
                    }
                }
            }
        }
    }

    pub fn add_cell_dependency(&mut self, cell: &CellAddress, depends_on: &CellAddress) {
        self.deps.entry(cell.clone()).or_default().insert(depends_on.clone());
        self.reverse_deps.entry(depends_on.clone()).or_default().insert(cell.clone());
    }

    pub fn add_range_dependency(&mut self, cell: &CellAddress, range: RangeRef) {
        let start_bucket = range.top / RANGE_BUCKET_SIZE;
        let end_bucket = range.bottom / RANGE_BUCKET_SIZE;
        for b in start_bucket..=end_bucket {
            let key = (range.sheet_id.clone(), b);
            self.range_buckets.entry(key).or_default().insert(cell.clone());
        }
        self.range_deps.entry(cell.clone()).or_default().push(range);
    }

    /// Finds all direct dependents of `modified_cell` (via direct reverse edges and spatial range index)
    pub fn get_direct_dependents(&self, modified_cell: &CellAddress) -> HashSet<CellAddress> {
        let mut dependents = HashSet::new();

        // 1. Direct cell reverse edges
        if let Some(rev) = self.reverse_deps.get(modified_cell) {
            for d in rev {
                dependents.insert(d.clone());
            }
        }

        // 2. Spatial range index queries
        let bucket = modified_cell.row / RANGE_BUCKET_SIZE;
        let key = (modified_cell.sheet_id.clone(), bucket);
        if let Some(candidates) = self.range_buckets.get(&key) {
            for cand in candidates {
                if let Some(ranges) = self.range_deps.get(cand) {
                    for r in ranges {
                        if r.contains(&modified_cell.sheet_id, modified_cell.row, modified_cell.col) {
                            dependents.insert(cand.clone());
                            break;
                        }
                    }
                }
            }
        }

        dependents
    }

    /// Computes full downstream evaluation worklist in topological / BFS order
    pub fn get_downstream_worklist(&self, modified: &[CellAddress]) -> Vec<CellAddress> {
        let mut worklist = Vec::new();
        let mut visited = HashSet::new();
        let mut queue = std::collections::VecDeque::new();

        for cell in modified {
            visited.insert(cell.clone());
            queue.push_back(cell.clone());
        }

        while let Some(current) = queue.pop_front() {
            let deps = self.get_direct_dependents(&current);
            for d in deps {
                if !visited.contains(&d) {
                    visited.insert(d.clone());
                    worklist.push(d.clone());
                    queue.push_back(d);
                }
            }
        }

        worklist
    }
}

/// Cycle Detector tracking active evaluation call stack
#[derive(Debug, Clone, Default)]
pub struct CycleDetector {
    active: HashSet<CellAddress>,
    stack: Vec<CellAddress>,
}

impl CycleDetector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enter(&mut self, addr: &CellAddress) -> Result<(), ErrorCode> {
        if self.active.contains(addr) {
            return Err(ErrorCode::Circ);
        }
        self.active.insert(addr.clone());
        self.stack.push(addr.clone());
        Ok(())
    }

    pub fn exit(&mut self, addr: &CellAddress) {
        self.active.remove(addr);
        if let Some(pos) = self.stack.iter().rposition(|x| x == addr) {
            self.stack.remove(pos);
        }
    }

    pub fn is_active(&self, addr: &CellAddress) -> bool {
        self.active.contains(addr)
    }

    pub fn depth(&self) -> usize {
        self.stack.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_graph_and_spatial_indexing() {
        let mut graph = DependencyGraph::new();
        let a1 = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };
        let b1 = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 };
        let c1 = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 2 };

        // B1 depends on A1 directly
        graph.add_cell_dependency(&b1, &a1);
        // C1 depends on range A1:A10
        let range = RangeRef { sheet_id: "sheet1".to_string(), top: 0, bottom: 9, left: 0, right: 0 };
        graph.add_range_dependency(&c1, range);

        let dependents = graph.get_direct_dependents(&a1);
        assert!(dependents.contains(&b1));
        assert!(dependents.contains(&c1));
    }

    #[test]
    fn test_cycle_detection() {
        let mut detector = CycleDetector::new();
        let a1 = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };
        let b1 = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 };

        assert!(detector.enter(&a1).is_ok());
        assert!(detector.enter(&b1).is_ok());
        // A1 again -> Cycle!
        assert_eq!(detector.enter(&a1), Err(ErrorCode::Circ));

        detector.exit(&b1);
        detector.exit(&a1);
        assert!(detector.enter(&a1).is_ok());
    }
}
