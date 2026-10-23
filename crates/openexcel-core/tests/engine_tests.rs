use openexcel_core::*;
use std::collections::HashMap;

fn create_empty_workbook() -> Workbook {
    let mut sheets = HashMap::new();
    let sheet1_id = "sheet1".to_string();
    sheets.insert(
        sheet1_id.clone(),
        Sheet {
            id: sheet1_id.clone(),
            properties: SheetProperties {
                name: "Sheet1".to_string(),
                tab_color: None,
                hidden: false,
                default_row_height: 20.0,
                default_column_width: 80.0,
                tables: vec![],
            },
            tiles: HashMap::new(),
        },
    );

    let sheet2_id = "sheet2".to_string();
    sheets.insert(
        sheet2_id.clone(),
        Sheet {
            id: sheet2_id.clone(),
            properties: SheetProperties {
                name: "Sheet2".to_string(),
                tab_color: None,
                hidden: false,
                default_row_height: 20.0,
                default_column_width: 80.0,
                tables: vec![],
            },
            tiles: HashMap::new(),
        },
    );

    Workbook {
        id: "wb_test".to_string(),
        revision: 1,
        properties: WorkbookProperties {
            name: "Engine Test".to_string(),
            date_system: "1900".to_string(),
            locale: "en-US".to_string(),
        },
        sheet_order: vec![sheet1_id, sheet2_id],
        sheets,
        names: vec![],
    }
}

#[test]
fn test_sparse_tiling_and_extremes() {
    let mut grid = SheetGrid::new("sheet1", "Sheet1");

    // Origin
    assert!(grid.set_cell(0, 0, Cell::value(1.0)));
    // Extreme corner: row 1,048,575, col 16,383 (XFD1048576)
    assert!(grid.set_cell(GRID_ROWS - 1, GRID_COLUMNS - 1, Cell::value("Corner")));
    // Out of bounds
    assert!(!grid.set_cell(GRID_ROWS, GRID_COLUMNS, Cell::value(0.0)));

    assert_eq!(grid.cell_count(), 2);
    assert_eq!(grid.tile_count(), 2); // Stored in two separate 128x32 tiles

    let origin_cell = grid.get_cell(0, 0).unwrap();
    assert_eq!(origin_cell.input, CellInput::Value { value: Scalar::number(1.0) });

    let corner_cell = grid.get_cell(GRID_ROWS - 1, GRID_COLUMNS - 1).unwrap();
    assert_eq!(corner_cell.input, CellInput::Value { value: Scalar::string("Corner") });

    // Test rect query
    let rect = CellRect { top: 0, left: 0, bottom: 10, right: 10 };
    let found = grid.query_rect(&rect);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0, 0);
    assert_eq!(found[0].1, 0);
}

#[test]
fn test_cycle_detection_without_hanging() {
    let wb = create_empty_workbook();
    let mut engine = Engine::new(&wb);

    // Direct cycle: A1 = B1, B1 = A1
    engine.set_cell("sheet1", 0, 0, Cell::formula("=B1"));
    engine.set_cell("sheet1", 0, 1, Cell::formula("=A1"));

    let res = engine.recalculate();
    assert!(!res.errors.is_empty(), "Cycle must produce errors");

    let val_a1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    let val_b1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });

    assert_eq!(val_a1.error_code(), Some(ErrorCode::Circ), "A1 must return #CIRC!");
    assert_eq!(val_b1.error_code(), Some(ErrorCode::Circ), "B1 must return #CIRC!");

    // Self cycle: C1 = C1 + 1
    engine.set_cell("sheet1", 0, 2, Cell::formula("=C1+1"));
    let val_c1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 2 });
    assert_eq!(val_c1.error_code(), Some(ErrorCode::Circ), "C1 must return #CIRC!");
}

#[test]
fn test_dynamic_array_spill_and_collision() {
    let wb = create_empty_workbook();
    let mut engine = Engine::new(&wb);

    // A1 = SEQUENCE(2, 2, 10, 5) -> 2x2 matrix: [10, 15; 20, 25]
    engine.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(2, 2, 10, 5)"));
    engine.recalculate();

    // Verify anchor
    let val_a1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    assert!(val_a1.is_array());

    // Verify spilled children: A2, B1, B2
    let val_b1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    let val_a2 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 0 });
    let val_b2 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 1 });

    assert_eq!(val_b1.to_scalar(), Scalar::number(15.0));
    assert_eq!(val_a2.to_scalar(), Scalar::number(20.0));
    assert_eq!(val_b2.to_scalar(), Scalar::number(25.0));

    // Now introduce collision: place a value in B2
    engine.set_cell("sheet1", 1, 1, Cell::value(999.0));
    engine.recalculate();

    // Anchor A1 must now return #SPILL!
    let val_a1_spill = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    assert_eq!(val_a1_spill.error_code(), Some(ErrorCode::Spill), "A1 must return #SPILL! when blocked");

    // Remove collision by setting B2 to Null
    engine.set_cell("sheet1", 1, 1, Cell::value(Scalar::Null));
    engine.recalculate();

    // Anchor A1 must spill again successfully
    let val_a1_recovered = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    assert!(val_a1_recovered.is_array());
}

#[test]
fn test_spill_boundary_overflow() {
    let wb = create_empty_workbook();
    let mut engine = Engine::new(&wb);

    // Place SEQUENCE at edge of grid: row 1,048,575, asking for 2 rows -> overflows boundary!
    let edge_row = GRID_ROWS - 1;
    engine.set_cell("sheet1", edge_row, 0, Cell::formula("=SEQUENCE(2, 1)"));
    engine.recalculate();

    let val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: edge_row, col: 0 });
    assert_eq!(val.error_code(), Some(ErrorCode::Spill), "Spill overflowing grid edge must return #SPILL!");
}

#[test]
fn test_deep_dependency_recalculation() {
    let wb = create_empty_workbook();
    let mut engine = Engine::new(&wb);

    // Chain: A1 = 1, A2 = A1 + 1, ..., A200 = A199 + 1
    engine.set_cell("sheet1", 0, 0, Cell::value(1.0));
    for r in 1..200 {
        let formula = format!("=A{} + 1", r);
        engine.set_cell("sheet1", r, 0, Cell::formula(formula));
    }

    engine.recalculate();
    let val_end = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 199, col: 0 });
    assert_eq!(val_end.to_scalar(), Scalar::number(200.0));

    // Now modify root A1 = 100
    engine.set_cell("sheet1", 0, 0, Cell::value(100.0));
    engine.recalculate();

    let val_end_updated = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 199, col: 0 });
    assert_eq!(val_end_updated.to_scalar(), Scalar::number(299.0));
}

#[test]
fn test_spatial_range_dependency_recalculation() {
    let wb = create_empty_workbook();
    let mut engine = Engine::new(&wb);

    // Populate A1:A10 = 10 each
    for r in 0..10 {
        engine.set_cell("sheet1", r, 0, Cell::value(10.0));
    }
    // B1 = SUM(A1:A10) -> 100
    engine.set_cell("sheet1", 0, 1, Cell::formula("=SUM(A1:A10)"));
    engine.recalculate();

    let val_b1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    assert_eq!(val_b1.to_scalar(), Scalar::number(100.0));

    // Modify A5 from 10 to 50
    engine.set_cell("sheet1", 4, 0, Cell::value(50.0));
    engine.recalculate();

    let val_b1_updated = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    assert_eq!(val_b1_updated.to_scalar(), Scalar::number(140.0));
}

#[test]
fn test_cross_sheet_references() {
    let wb = create_empty_workbook();
    let mut engine = Engine::new(&wb);

    // Sheet2!A1 = 42
    engine.set_cell("sheet2", 0, 0, Cell::value(42.0));
    // Sheet1!B1 = Sheet2!A1 * 2
    engine.set_cell("sheet1", 0, 1, Cell::formula("=Sheet2!A1 * 2"));
    engine.recalculate();

    let val_b1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    assert_eq!(val_b1.to_scalar(), Scalar::number(84.0));

    // Update Sheet2!A1 = 10
    engine.set_cell("sheet2", 0, 0, Cell::value(10.0));
    engine.recalculate();

    let val_b1_updated = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    assert_eq!(val_b1_updated.to_scalar(), Scalar::number(20.0));
}

#[test]
fn test_structured_table_references() {
    let mut wb = create_empty_workbook();
    let tbl = TableDefinition {
        id: "tbl1".to_string(),
        name: "DeptTable".to_string(),
        range: CellRect { top: 0, left: 0, bottom: 3, right: 1 },
        columns: vec![
            TableColumn { id: "c1".to_string(), name: "Dept".to_string(), calculated_formula: None, totals_formula: None },
            TableColumn { id: "c2".to_string(), name: "Sales".to_string(), calculated_formula: None, totals_formula: None },
        ],
        totals_row: false,
        style_id: None,
    };
    wb.sheets.get_mut("sheet1").unwrap().properties.tables.push(tbl);

    let mut engine = Engine::new(&wb);

    // Fill table: row 0 is headers ("Dept", "Sales"), rows 1..3 data
    engine.set_cell("sheet1", 0, 0, Cell::value("Dept"));
    engine.set_cell("sheet1", 0, 1, Cell::value("Sales"));
    engine.set_cell("sheet1", 1, 0, Cell::value("East"));
    engine.set_cell("sheet1", 1, 1, Cell::value(100.0));
    engine.set_cell("sheet1", 2, 0, Cell::value("West"));
    engine.set_cell("sheet1", 2, 1, Cell::value(200.0));
    engine.set_cell("sheet1", 3, 0, Cell::value("North"));
    engine.set_cell("sheet1", 3, 1, Cell::value(300.0));

    // Formula: =SUM(DeptTable[Sales])
    engine.set_cell("sheet1", 4, 1, Cell::formula("=SUM(DeptTable[Sales])"));
    engine.recalculate();

    let val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 4, col: 1 });
    assert_eq!(val.to_scalar(), Scalar::number(600.0));
}
