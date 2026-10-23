use openexcel_core::*;
use std::collections::HashMap;

fn main() {
    let sheet1_id = "sheet1".to_string();
    let mut sheets = HashMap::new();
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

    let wb = Workbook {
        id: "wb1".to_string(),
        revision: 1,
        properties: WorkbookProperties {
            name: "Test".to_string(),
            date_system: "1900".to_string(),
            locale: "en-US".to_string(),
        },
        sheet_order: vec![sheet1_id],
        sheets,
        names: vec![],
    };

    let mut engine = Engine::new(&wb);

    // Scenario A:
    // A1 = SEQUENCE(2, 2)
    // B1 has a value "BLOCK"
    engine.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(2, 2)"));
    engine.set_cell("sheet1", 0, 1, Cell::value("BLOCK"));
    engine.recalculate();

    let a1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    println!("Initial A1 (blocked by B1): {:?}", a1.error_code());

    // Now remove B1 by deleting cell or setting to empty
    engine.set_cell("sheet1", 0, 1, Cell::value(Scalar::Null));
    engine.recalculate();

    let a1_after = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    let b1_after = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    println!("After unblocking A1: is_array={}, error={:?}", a1_after.is_array(), a1_after.error_code());
    println!("After unblocking B1 (spill child): {:?}", b1_after);

    // Scenario B:
    // A1 = SEQUENCE(2, 2)
    // Recalculate -> A1 spills into A2, B1, B2.
    // Now user types "HELLO" into B1!
    let mut engine2 = Engine::new(&wb);
    engine2.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(2, 2)"));
    engine2.recalculate();
    let b1_spill = engine2.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    println!("\nScenario B initial B1 spilled: {:?}", b1_spill);

    // User types into B1:
    engine2.set_cell("sheet1", 0, 1, Cell::value("HELLO"));
    engine2.recalculate();
    let b1_user = engine2.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    let a1_spill = engine2.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    println!("Scenario B after typing into B1:");
    println!("  B1 computed: {:?}", b1_user);
    println!("  A1 computed: error={:?}", a1_spill.error_code());
}
