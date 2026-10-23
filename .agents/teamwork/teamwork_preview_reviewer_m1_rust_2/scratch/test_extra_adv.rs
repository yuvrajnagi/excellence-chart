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
    let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

    // 1. UTF-8 multi-byte characters
    let v_len = engine.evaluate_formula("=LEN(\"🚀🔥\")", &origin, None, None);
    println!("LEN(\"🚀🔥\"): {:?}", v_len.to_scalar());
    assert_eq!(v_len.to_scalar(), Scalar::number(2.0));

    let v_mid = engine.evaluate_formula("=MID(\"你好世界\", 2, 2)", &origin, None, None);
    println!("MID(\"你好世界\", 2, 2): {:?}", v_mid.to_scalar());
    assert_eq!(v_mid.to_scalar(), Scalar::string("好世"));

    // 2. Self-cycle in range: A1 = SUM(A1:A5)
    engine.set_cell("sheet1", 0, 0, Cell::formula("=SUM(A1:A5)"));
    engine.recalculate();
    let v_circ_range = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    println!("A1 = SUM(A1:A5): {:?}", v_circ_range.error_code());
    assert_eq!(v_circ_range.error_code(), Some(ErrorCode::Circ));

    println!("All extra adversarial tests PASSED!");
}
