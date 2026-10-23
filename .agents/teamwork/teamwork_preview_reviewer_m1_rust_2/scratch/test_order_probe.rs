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
    engine.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(3, 3)"));
    engine.set_cell("sheet1", 1, 1, Cell::value("BLOCKER"));
    engine.recalculate();

    engine.set_cell("sheet1", 1, 1, Cell::value(Scalar::Null));
    engine.recalculate();

    let a1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    let child = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 1 });
    println!("A1: is_array={}", a1.is_array());
    println!("Child (1, 1): {:?}", child);
}
