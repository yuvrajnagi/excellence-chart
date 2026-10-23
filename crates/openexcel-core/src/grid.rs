use std::collections::HashMap;
use crate::coordinates::{cell_key, cell_key_to_coords, tile_key, valid_position};
use crate::types::{Cell, CellAddress, CellRect, Sheet, TileStore, Workbook, TILE_COLUMNS, TILE_ROWS};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SheetGrid {
    pub sheet_id: String,
    pub name: String,
    pub tiles: TileStore,
}

impl SheetGrid {
    pub fn new(sheet_id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            sheet_id: sheet_id.into(),
            name: name.into(),
            tiles: HashMap::new(),
        }
    }

    pub fn from_sheet(sheet: &Sheet) -> Self {
        Self {
            sheet_id: sheet.id.clone(),
            name: sheet.properties.name.clone(),
            tiles: sheet.tiles.clone(),
        }
    }

    pub fn get_cell(&self, row: u32, col: u32) -> Option<&Cell> {
        let t_key = tile_key(row, col)?;
        let c_key = cell_key(row, col)?;
        self.tiles.get(&t_key)?.get(&c_key)
    }

    pub fn get_cell_mut(&mut self, row: u32, col: u32) -> Option<&mut Cell> {
        let t_key = tile_key(row, col)?;
        let c_key = cell_key(row, col)?;
        self.tiles.get_mut(&t_key)?.get_mut(&c_key)
    }

    pub fn set_cell(&mut self, row: u32, col: u32, cell: Cell) -> bool {
        if !valid_position(row, col) {
            return false;
        }
        let t_key = match tile_key(row, col) {
            Some(k) => k,
            None => return false,
        };
        let c_key = match cell_key(row, col) {
            Some(k) => k,
            None => return false,
        };
        self.tiles.entry(t_key).or_default().insert(c_key, cell);
        true
    }

    pub fn remove_cell(&mut self, row: u32, col: u32) -> Option<Cell> {
        let t_key = tile_key(row, col)?;
        let c_key = cell_key(row, col)?;
        let tile = self.tiles.get_mut(&t_key)?;
        let removed = tile.remove(&c_key);
        if tile.is_empty() {
            self.tiles.remove(&t_key);
        }
        removed
    }

    pub fn cell_count(&self) -> usize {
        self.tiles.values().map(|t| t.len()).sum()
    }

    pub fn tile_count(&self) -> usize {
        self.tiles.len()
    }

    pub fn iter_cells(&self) -> impl Iterator<Item = (u32, u32, &Cell)> {
        self.tiles.values().flat_map(|tile| {
            tile.iter().filter_map(|(key, cell)| {
                let (r, c) = cell_key_to_coords(key)?;
                Some((r, c, cell))
            })
        })
    }

    pub fn query_rect(&self, rect: &CellRect) -> Vec<(u32, u32, &Cell)> {
        let start_tile_row = rect.top / TILE_ROWS;
        let end_tile_row = rect.bottom / TILE_ROWS;
        let start_tile_col = rect.left / TILE_COLUMNS;
        let end_tile_col = rect.right / TILE_COLUMNS;

        let mut results = Vec::new();
        for tr in start_tile_row..=end_tile_row {
            for tc in start_tile_col..=end_tile_col {
                let t_key = format!("{}:{}", tr, tc);
                if let Some(tile) = self.tiles.get(&t_key) {
                    for (c_key, cell) in tile {
                        if let Some((r, c)) = cell_key_to_coords(c_key) {
                            if rect.contains(r, c) {
                                results.push((r, c, cell));
                            }
                        }
                    }
                }
            }
        }
        results
    }

    pub fn bounds(&self) -> Option<CellRect> {
        let mut min_r = u32::MAX;
        let mut max_r = 0;
        let mut min_c = u32::MAX;
        let mut max_c = 0;
        let mut has_cells = false;

        for (r, c, _) in self.iter_cells() {
            has_cells = true;
            min_r = min_r.min(r);
            max_r = max_r.max(r);
            min_c = min_c.min(c);
            max_c = max_c.max(c);
        }

        if has_cells {
            Some(CellRect {
                top: min_r,
                left: min_c,
                bottom: max_r,
                right: max_c,
            })
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct WorkbookGrid {
    pub sheets: HashMap<String, SheetGrid>,
    pub sheet_order: Vec<String>,
    name_to_id: HashMap<String, String>,
}

impl WorkbookGrid {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_workbook(wb: &Workbook) -> Self {
        let mut grid = Self::new();
        grid.sheet_order = wb.sheet_order.clone();
        for (sheet_id, sheet) in &wb.sheets {
            let sheet_grid = SheetGrid::from_sheet(sheet);
            grid.name_to_id.insert(sheet.properties.name.to_lowercase(), sheet_id.clone());
            grid.sheets.insert(sheet_id.clone(), sheet_grid);
        }
        grid
    }

    pub fn add_sheet(&mut self, sheet_id: impl Into<String>, name: impl Into<String>) {
        let id = sheet_id.into();
        let n = name.into();
        self.name_to_id.insert(n.to_lowercase(), id.clone());
        if !self.sheet_order.contains(&id) {
            self.sheet_order.push(id.clone());
        }
        self.sheets.insert(id.clone(), SheetGrid::new(id, n));
    }

    pub fn resolve_sheet_id<'a>(&'a self, name_or_id: &'a str) -> Option<&'a str> {
        if self.sheets.contains_key(name_or_id) {
            return Some(name_or_id);
        }
        self.name_to_id.get(&name_or_id.to_lowercase()).map(|s| s.as_str())
    }

    pub fn get_cell(&self, sheet_id_or_name: &str, row: u32, col: u32) -> Option<&Cell> {
        let actual_id = self.resolve_sheet_id(sheet_id_or_name)?;
        self.sheets.get(actual_id)?.get_cell(row, col)
    }

    pub fn get_cell_by_address(&self, addr: &CellAddress) -> Option<&Cell> {
        self.get_cell(&addr.sheet_id, addr.row, addr.col)
    }

    pub fn set_cell(&mut self, sheet_id_or_name: &str, row: u32, col: u32, cell: Cell) -> bool {
        let actual_id = match self.resolve_sheet_id(sheet_id_or_name) {
            Some(id) => id.to_string(),
            None => return false,
        };
        if let Some(grid) = self.sheets.get_mut(&actual_id) {
            grid.set_cell(row, col, cell)
        } else {
            false
        }
    }

    pub fn set_cell_by_address(&mut self, addr: &CellAddress, cell: Cell) -> bool {
        self.set_cell(&addr.sheet_id, addr.row, addr.col, cell)
    }

    pub fn remove_cell(&mut self, sheet_id_or_name: &str, row: u32, col: u32) -> Option<Cell> {
        let actual_id = self.resolve_sheet_id(sheet_id_or_name)?.to_string();
        self.sheets.get_mut(&actual_id)?.remove_cell(row, col)
    }
}
