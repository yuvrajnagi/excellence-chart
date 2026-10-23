use std::collections::HashMap;
use crate::types::{CellAddress, CellRect, ErrorCode, GRID_COLUMNS, GRID_ROWS};

#[derive(Debug, Clone, Default)]
pub struct SpillManager {
    /// Maps anchor cell to its occupied spill rectangle
    pub spills: HashMap<CellAddress, CellRect>,
    /// Maps spilled child cell to its parent anchor cell
    pub spill_children: HashMap<CellAddress, CellAddress>,
}

impl SpillManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a spill from `anchor` of size `(rows, cols)`.
    /// `is_cell_occupied` is a callback that tests whether a coordinate has an authored cell value/formula.
    pub fn register_spill<F>(
        &mut self,
        anchor: &CellAddress,
        rows: usize,
        cols: usize,
        is_cell_occupied: F,
    ) -> Result<Option<CellRect>, ErrorCode>
    where
        F: Fn(&str, u32, u32) -> bool,
    {
        // 1x1 result does not spill
        if rows <= 1 && cols <= 1 {
            self.clear_spill(anchor);
            return Ok(None);
        }

        // Boundary check
        let end_row = (anchor.row as usize).saturating_add(rows);
        let end_col = (anchor.col as usize).saturating_add(cols);
        if end_row > GRID_ROWS as usize || end_col > GRID_COLUMNS as usize {
            self.clear_spill(anchor);
            return Err(ErrorCode::Spill);
        }

        let rect = CellRect {
            top: anchor.row,
            left: anchor.col,
            bottom: (end_row - 1) as u32,
            right: (end_col - 1) as u32,
        };

        // Collision check
        for r in 0..rows {
            for c in 0..cols {
                if r == 0 && c == 0 {
                    continue; // The anchor itself is allowed
                }
                let target_row = anchor.row + r as u32;
                let target_col = anchor.col + c as u32;
                let child_addr = CellAddress {
                    sheet_id: anchor.sheet_id.clone(),
                    row: target_row,
                    col: target_col,
                };

                // 1. Is target occupied by an authored cell?
                if is_cell_occupied(&anchor.sheet_id, target_row, target_col) {
                    self.clear_spill(anchor);
                    return Err(ErrorCode::Spill);
                }

                // 2. Is target occupied by another spill anchor or another spill child?
                if let Some(existing_anchor) = self.spill_children.get(&child_addr) {
                    if existing_anchor != anchor {
                        self.clear_spill(anchor);
                        return Err(ErrorCode::Spill);
                    }
                }
                if self.spills.contains_key(&child_addr) && &child_addr != anchor {
                    self.clear_spill(anchor);
                    return Err(ErrorCode::Spill);
                }
            }
        }

        // Clear previous children for this anchor before re-registering
        self.clear_spill(anchor);

        // Register new spill
        for r in 0..rows {
            for c in 0..cols {
                if r == 0 && c == 0 {
                    continue;
                }
                let child_addr = CellAddress {
                    sheet_id: anchor.sheet_id.clone(),
                    row: anchor.row + r as u32,
                    col: anchor.col + c as u32,
                };
                self.spill_children.insert(child_addr, anchor.clone());
            }
        }
        self.spills.insert(anchor.clone(), rect.clone());

        Ok(Some(rect))
    }

    /// Clears any spill rooted at `anchor`, returning all child addresses that were cleared.
    pub fn clear_spill(&mut self, anchor: &CellAddress) -> Vec<CellAddress> {
        let mut cleared_children = Vec::new();
        if let Some(rect) = self.spills.remove(anchor) {
            for r in rect.top..=rect.bottom {
                for c in rect.left..=rect.right {
                    if r == anchor.row && c == anchor.col {
                        continue;
                    }
                    let child_addr = CellAddress {
                        sheet_id: anchor.sheet_id.clone(),
                        row: r,
                        col: c,
                    };
                    if self.spill_children.remove(&child_addr).is_some() {
                        cleared_children.push(child_addr);
                    }
                }
            }
        }
        cleared_children
    }

    pub fn get_anchor_for_child(&self, child: &CellAddress) -> Option<&CellAddress> {
        self.spill_children.get(child)
    }

    pub fn get_spill_rect(&self, anchor: &CellAddress) -> Option<&CellRect> {
        self.spills.get(anchor)
    }

    pub fn is_spill_child(&self, addr: &CellAddress) -> bool {
        self.spill_children.contains_key(addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spill_registration_and_collision() {
        let mut mgr = SpillManager::new();
        let anchor = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

        // Test normal 2x2 spill
        let res = mgr.register_spill(&anchor, 2, 2, |_, _, _| false);
        assert!(res.is_ok());
        assert!(mgr.is_spill_child(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 }));
        assert!(mgr.is_spill_child(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 0 }));
        assert!(mgr.is_spill_child(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 1 }));

        // Collision with occupied cell (1, 1)
        let res_col = mgr.register_spill(&anchor, 2, 2, |_, r, c| r == 1 && c == 1);
        assert_eq!(res_col, Err(ErrorCode::Spill));
        assert!(!mgr.is_spill_child(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 1 }));
    }
}
