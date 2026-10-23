use openexcel_wasm::WasmEngine;

#[test]
fn test_wasm_engine_lifecycle_and_basic_formulas() {
    let mut engine = WasmEngine::new();

    // Direct formula evaluation
    let res = engine
        .evaluate_formula("Sheet1", 0, 0, "=1+2*3")
        .expect("formula evaluation should succeed");
    let val: f64 = serde_json::from_str(&res).unwrap();
    assert_eq!(val, 7.0);

    let res_sum = engine
        .evaluate_formula("Sheet1", 0, 0, "=SUM(10, 20, 30)")
        .expect("SUM formula should succeed");
    let val_sum: f64 = serde_json::from_str(&res_sum).unwrap();
    assert_eq!(val_sum, 60.0);

    // Set cells and evaluate dependency chain
    engine
        .set_cell_value("Sheet1", 0, 0, "15")
        .expect("set cell value should succeed");
    engine
        .set_cell_formula("Sheet1", 0, 1, "=A1*2")
        .expect("set cell formula should succeed");

    assert!(engine.recalculate().is_ok());

    let addrs_json = r#"[
        {"sheetId": "Sheet1", "row": 0, "col": 0},
        {"sheetId": "Sheet1", "row": 0, "col": 1}
    ]"#;
    let computed_json = engine
        .get_computed_values(addrs_json)
        .expect("get_computed_values should succeed");

    let map: std::collections::HashMap<String, serde_json::Value> =
        serde_json::from_str(&computed_json).unwrap();

    assert_eq!(map.get("Sheet1/0:0").unwrap().as_f64(), Some(15.0));
    assert_eq!(map.get("Sheet1/0:1").unwrap().as_f64(), Some(30.0));
}

#[test]
fn test_update_workbook_snake_case() {
    let mut engine = WasmEngine::new();

    let wb_json = r#"{
        "id": "wb_snake",
        "revision": 1,
        "properties": {
            "name": "SnakeWorkbook",
            "date_system": "1900",
            "locale": "en-US"
        },
        "sheet_order": ["sheet1"],
        "sheets": {
            "sheet1": {
                "id": "sheet1",
                "properties": {
                    "name": "Sheet1",
                    "tab_color": null,
                    "hidden": false,
                    "default_row_height": 20.0,
                    "default_column_width": 80.0,
                    "tables": []
                },
                "tiles": {
                    "0:0": {
                        "0:0": { "input": { "kind": "value", "value": 50 } },
                        "0:1": { "input": { "kind": "formula", "source": "=A1*3" } }
                    }
                }
            }
        },
        "names": []
    }"#;

    engine
        .update_workbook(wb_json)
        .expect("update_workbook with snake_case json should succeed");

    assert!(engine.recalculate().is_ok());

    let addrs = r#"[{"sheet_id": "sheet1", "row": 0, "col": 1}]"#;
    let values_json = engine.get_computed_values(addrs).unwrap();
    let map: std::collections::HashMap<String, serde_json::Value> =
        serde_json::from_str(&values_json).unwrap();

    assert_eq!(map.get("sheet1/0:1").unwrap().as_f64(), Some(150.0));
}

#[test]
fn test_update_workbook_camel_case_ts_model() {
    let mut engine = WasmEngine::new();

    let ts_wb_json = r#"{
        "schemaVersion": 1,
        "id": "wb_camel",
        "revision": 2,
        "properties": {
            "name": "CamelWorkbook",
            "dateSystem": "1900",
            "locale": "en-US",
            "author": "Tester",
            "description": "Integration test",
            "createdAt": "2026-10-23T00:00:00Z",
            "modifiedAt": "2026-10-23T00:00:00Z",
            "activeSheetId": "Sheet1",
            "theme": { "name": "Office", "fontFamily": "Calibri", "colors": [] },
            "namedStyles": {}
        },
        "sheetOrder": ["Sheet1"],
        "sheets": {
            "Sheet1": {
                "id": "Sheet1",
                "properties": {
                    "name": "Sheet1",
                    "tabColor": null,
                    "hidden": false,
                    "defaultRowHeight": 22.5,
                    "defaultColumnWidth": 90.0,
                    "rowInfo": {},
                    "columnInfo": {},
                    "groups": [],
                    "merges": [],
                    "conditionalFormats": [],
                    "validations": [],
                    "tables": [],
                    "pivots": [],
                    "charts": [],
                    "view": {
                        "freezeRows": 0, "freezeColumns": 0, "zoom": 1,
                        "scrollRow": 0, "scrollColumn": 0,
                        "active": { "row": 0, "col": 0 }, "selection": [], "gridlines": true
                    }
                },
                "tiles": {
                    "0:0": {
                        "0:0": { "input": { "kind": "value", "value": 25 } },
                        "0:1": { "input": { "kind": "value", "value": 75 } },
                        "1:0": { "input": { "kind": "formula", "source": "=AVERAGE(A1, B1)" } }
                    }
                }
            }
        },
        "names": []
    }"#;

    engine
        .update_workbook(ts_wb_json)
        .expect("update_workbook with TypeScript model camelCase should succeed");

    assert!(engine.recalculate().is_ok());

    let addrs = r#"[{"sheetId": "Sheet1", "row": 1, "col": 0}]"#;
    let values_json = engine.get_computed_values(addrs).unwrap();
    let map: std::collections::HashMap<String, serde_json::Value> =
        serde_json::from_str(&values_json).unwrap();

    assert_eq!(map.get("Sheet1/1:0").unwrap().as_f64(), Some(50.0));
}

#[test]
fn test_circular_reference_detection() {
    let mut engine = WasmEngine::new();

    // A1 depends on B1, B1 depends on A1
    engine.set_cell_formula("Sheet1", 0, 0, "=B1+1").unwrap();
    engine.set_cell_formula("Sheet1", 0, 1, "=A1+1").unwrap();

    let recalc = engine.recalculate_core();
    assert!(!recalc.errors.is_empty());
    assert!(recalc.errors.iter().any(|e| e.code == "#CIRC!"));

    let values_json = engine
        .get_computed_values(r#"["Sheet1/0:0", "Sheet1/0:1"]"#)
        .unwrap();
    let map: std::collections::HashMap<String, serde_json::Value> =
        serde_json::from_str(&values_json).unwrap();

    let a1_err = map.get("Sheet1/0:0").unwrap();
    assert_eq!(a1_err.get("kind").unwrap().as_str(), Some("error"));
    assert_eq!(a1_err.get("code").unwrap().as_str(), Some("#CIRC!"));
}

#[test]
fn test_dynamic_array_spill_and_collision() {
    let mut engine = WasmEngine::new();

    // SEQUENCE(2, 2) spills into (0,0), (0,1), (1,0), (1,1)
    engine
        .set_cell_formula("Sheet1", 0, 0, "=SEQUENCE(2, 2)")
        .unwrap();

    let recalc = engine.recalculate_core();
    assert_eq!(recalc.errors.len(), 0);

    let addrs = r#"[
        "Sheet1/0:0",
        "Sheet1/0:1",
        "Sheet1/1:0",
        "Sheet1/1:1"
    ]"#;
    let values_json = engine.get_computed_values(addrs).unwrap();
    let map: std::collections::HashMap<String, serde_json::Value> =
        serde_json::from_str(&values_json).unwrap();

    let anchor = map.get("Sheet1/0:0").unwrap();
    assert_eq!(anchor.get("kind").unwrap().as_str(), Some("array"));
    assert_eq!(anchor.get("rows").unwrap().as_u64(), Some(2));
    assert_eq!(anchor.get("cols").unwrap().as_u64(), Some(2));

    // Spilled children cells
    assert_eq!(map.get("Sheet1/0:1").unwrap().as_f64(), Some(2.0));
    assert_eq!(map.get("Sheet1/1:0").unwrap().as_f64(), Some(3.0));
    assert_eq!(map.get("Sheet1/1:1").unwrap().as_f64(), Some(4.0));

    // Now introduce an obstacle in the spill zone at (0, 1)
    engine.set_cell_value("Sheet1", 0, 1, "999").unwrap();
    let recalc_blocked = engine.recalculate_core();
    assert!(recalc_blocked.errors.iter().any(|e| e.code == "#SPILL!"));

    let val_json = engine.get_value("Sheet1", 0, 0).unwrap();
    let val_err: serde_json::Value = serde_json::from_str(&val_json).unwrap();
    assert_eq!(val_err.get("code").unwrap().as_str(), Some("#SPILL!"));
}

#[test]
fn test_standard_excel_functions_suite() {
    let mut engine = WasmEngine::new();

    // Logical
    let if_res = engine
        .evaluate_formula("Sheet1", 0, 0, "=IF(10 > 5, \"YES\", \"NO\")")
        .unwrap();
    assert_eq!(serde_json::from_str::<String>(&if_res).unwrap(), "YES");

    // Math
    let power_res = engine
        .evaluate_formula("Sheet1", 0, 0, "=POWER(2, 8)")
        .unwrap();
    assert_eq!(serde_json::from_str::<f64>(&power_res).unwrap(), 256.0);

    // Text
    let text_res = engine
        .evaluate_formula("Sheet1", 0, 0, "=CONCAT(\"Open\", \"Excel\")")
        .unwrap();
    assert_eq!(serde_json::from_str::<String>(&text_res).unwrap(), "OpenExcel");

    // Lookups with array
    engine.set_cell_value("Sheet1", 0, 0, "100").unwrap();
    engine.set_cell_value("Sheet1", 1, 0, "200").unwrap();
    engine.set_cell_value("Sheet1", 2, 0, "300").unwrap();
    let match_res = engine
        .evaluate_formula("Sheet1", 3, 0, "=MATCH(200, A1:A3, 0)")
        .unwrap();
    assert_eq!(serde_json::from_str::<f64>(&match_res).unwrap(), 2.0);
}

#[test]
fn test_version_and_address_helpers() {
    assert_eq!(openexcel_wasm::openexcel_version(), "0.1.0");
    assert_eq!(openexcel_wasm::format_address(0, 0), "A1");
    assert_eq!(openexcel_wasm::format_address(9, 2), "C10");
    assert_eq!(openexcel_wasm::format_address(1048575, 16383), "XFD1048576");
}
