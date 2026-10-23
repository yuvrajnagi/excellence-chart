use openexcel_core::*;
use std::collections::HashMap;

fn create_test_workbook() -> Workbook {
    let sheet1_id = "sheet1".to_string();
    let sheet2_id = "sheet2".to_string();
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
        id: "wb_adv".to_string(),
        revision: 1,
        properties: WorkbookProperties {
            name: "Adversarial WB".to_string(),
            date_system: "1900".to_string(),
            locale: "en-US".to_string(),
        },
        sheet_order: vec![sheet1_id, sheet2_id],
        sheets,
        names: vec![],
    }
}

fn main() {
    let mut passed = 0;
    let mut failed = 0;

    macro_rules! test_case {
        ($name:expr, $expr:expr) => {
            print!("TEST: {} ... ", $name);
            match std::panic::catch_unwind(|| { $expr }) {
                Ok(_) => {
                    println!("PASS");
                    passed += 1;
                }
                Err(err) => {
                    println!("FAIL: {:?}", err);
                    failed += 1;
                }
            }
        };
    }

    // 1. Cycle Detection Stress Tests
    test_case!("Cycle: Self-referencing formula (A1 = =A1 + 1)", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        engine.set_cell("sheet1", 0, 0, Cell::formula("=A1 + 1"));
        let res = engine.recalculate();
        let v = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        assert_eq!(v.error_code(), Some(ErrorCode::Circ));
        assert!(!res.errors.is_empty());
    });

    test_case!("Cycle: 3-cell loop (A1 -> B1 -> C1 -> A1)", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        engine.set_cell("sheet1", 0, 0, Cell::formula("=B1"));
        engine.set_cell("sheet1", 0, 1, Cell::formula("=C1"));
        engine.set_cell("sheet1", 0, 2, Cell::formula("=A1"));
        engine.recalculate();
        let va = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        let vb = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
        let vc = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 2 });
        assert_eq!(va.error_code(), Some(ErrorCode::Circ));
        assert_eq!(vb.error_code(), Some(ErrorCode::Circ));
        assert_eq!(vc.error_code(), Some(ErrorCode::Circ));

        // Break cycle: set C1 = 100
        engine.set_cell("sheet1", 0, 2, Cell::value(100.0));
        engine.recalculate();
        let va_rec = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        let vb_rec = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
        assert_eq!(va_rec.to_scalar(), Scalar::number(100.0));
        assert_eq!(vb_rec.to_scalar(), Scalar::number(100.0));
    });

    test_case!("Cycle: Inside conditional (A1 = =IF(TRUE, A1, 10))", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        engine.set_cell("sheet1", 0, 0, Cell::formula("=IF(TRUE, A1, 10)"));
        engine.recalculate();
        let v = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        assert_eq!(v.error_code(), Some(ErrorCode::Circ));
    });

    test_case!("Cycle: Unexecuted branch does not trigger cycle", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        // A1 = IF(FALSE, A1, 42) -> A1 in false branch is never evaluated
        engine.set_cell("sheet1", 0, 0, Cell::formula("=IF(FALSE, A1, 42)"));
        engine.recalculate();
        let v = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        assert_eq!(v.to_scalar(), Scalar::number(42.0));
    });

    test_case!("Cycle: Range cycle detection (A1 = SUM(A1:A5))", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        engine.set_cell("sheet1", 0, 0, Cell::formula("=SUM(A1:A5)"));
        engine.recalculate();
        let v = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        assert_eq!(v.error_code(), Some(ErrorCode::Circ));
    });

    // 2. Spill Manager Edge Cases
    test_case!("Spill: Boundary collision at extreme row and col", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        // SEQUENCE overflowing bottom row
        let last_row = GRID_ROWS - 1;
        engine.set_cell("sheet1", last_row, 0, Cell::formula("=SEQUENCE(2, 1)"));
        engine.recalculate();
        let v_row = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: last_row, col: 0 });
        assert_eq!(v_row.error_code(), Some(ErrorCode::Spill));

        // SEQUENCE overflowing right column
        let last_col = GRID_COLUMNS - 1;
        engine.set_cell("sheet1", 0, last_col, Cell::formula("=SEQUENCE(1, 2)"));
        engine.recalculate();
        let v_col = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: last_col });
        assert_eq!(v_col.error_code(), Some(ErrorCode::Spill));
    });

    test_case!("Spill: Collision with authored cell returns #SPILL!", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        engine.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(3, 3)"));
        engine.set_cell("sheet1", 1, 1, Cell::value("BLOCKER"));
        engine.recalculate();

        let v_anchor = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        assert_eq!(v_anchor.error_code(), Some(ErrorCode::Spill));
    });

    test_case!("Spill: Authoring over spill child causes anchor to return #SPILL!", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        engine.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(3, 3)"));
        engine.recalculate();
        let v1 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        assert!(v1.is_array());

        // Now author a new formula in B2 (1, 1)
        engine.set_cell("sheet1", 1, 1, Cell::formula("=SEQUENCE(2, 2)"));
        let res = engine.recalculate();

        // A1 must now be in error #SPILL!
        let v1_after = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        assert_eq!(v1_after.error_code(), Some(ErrorCode::Spill));

        // B2 is valid and spilled
        let v2 = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 1 });
        assert!(v2.is_array());
        assert!(res.errors.iter().any(|(addr, err)| addr.row == 0 && addr.col == 0 && *err == ErrorCode::Spill));
    });

    test_case!("Spill: Overly large array exceeds max_array_cells", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        // SEQUENCE asking for 2,000 x 2,000 = 4,000,000 cells (limit is 1,000,000)
        engine.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(2000, 2000)"));
        engine.recalculate();
        let v = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
        assert_eq!(v.error_code(), Some(ErrorCode::Calc));
    });

    // 3. Parser & Precedence Edge Cases
    test_case!("Parser: Operator precedence and associativity", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

        // Excel -2^2 == 4
        let v1 = engine.evaluate_formula("=-2^2", &origin, None, None);
        assert_eq!(v1.to_scalar(), Scalar::number(4.0));

        // 2^3^2 == 512 (right-associative: 2^(3^2) = 2^9 = 512)
        let v2 = engine.evaluate_formula("=2^3^2", &origin, None, None);
        assert_eq!(v2.to_scalar(), Scalar::number(512.0));

        // 5% * 2 == 0.1
        let v3 = engine.evaluate_formula("=5% * 2", &origin, None, None);
        assert!((v3.to_scalar().as_f64().unwrap() - 0.1).abs() < 1e-6);

        // Multiple chained percents: 500%% == 0.05
        let v4 = engine.evaluate_formula("=500%%", &origin, None, None);
        assert!((v4.to_scalar().as_f64().unwrap() - 0.05).abs() < 1e-6);

        // Scientific notation
        let v5 = engine.evaluate_formula("=1.5e2 + 2.5E-1", &origin, None, None);
        assert!((v5.to_scalar().as_f64().unwrap() - 150.25).abs() < 1e-6);

        // Quoted string escape
        let v6 = engine.evaluate_formula("=\"Hello \"\"World\"\"!\"", &origin, None, None);
        assert_eq!(v6.to_scalar(), Scalar::string("Hello \"World\"!"));

        // Case insensitivity
        let v7 = engine.evaluate_formula("=sUm(1, 2, 3)", &origin, None, None);
        assert_eq!(v7.to_scalar(), Scalar::number(6.0));
    });

    test_case!("Parser: Syntax errors return #PARSE!", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

        let v1 = engine.evaluate_formula("=", &origin, None, None);
        assert_eq!(v1.error_code(), Some(ErrorCode::Parse));

        let v2 = engine.evaluate_formula("=1+", &origin, None, None);
        assert_eq!(v2.error_code(), Some(ErrorCode::Parse));

        let v3 = engine.evaluate_formula("=((1+2)", &origin, None, None);
        assert_eq!(v3.error_code(), Some(ErrorCode::Parse));
    });

    // 4. Function Library Edge Cases
    test_case!("Functions: Lotus 1-2-3 / Excel 1900 date system quirk", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

        // Serial 60 is Feb 29, 1900
        let vy = engine.evaluate_formula("=YEAR(60)", &origin, None, None);
        let vm = engine.evaluate_formula("=MONTH(60)", &origin, None, None);
        let vd = engine.evaluate_formula("=DAY(60)", &origin, None, None);
        assert_eq!(vy.to_scalar(), Scalar::number(1900.0));
        assert_eq!(vm.to_scalar(), Scalar::number(2.0));
        assert_eq!(vd.to_scalar(), Scalar::number(29.0));

        // Serial 61 is March 1, 1900
        let vy61 = engine.evaluate_formula("=YEAR(61)", &origin, None, None);
        let vm61 = engine.evaluate_formula("=MONTH(61)", &origin, None, None);
        let vd61 = engine.evaluate_formula("=DAY(61)", &origin, None, None);
        assert_eq!(vy61.to_scalar(), Scalar::number(1900.0));
        assert_eq!(vm61.to_scalar(), Scalar::number(3.0));
        assert_eq!(vd61.to_scalar(), Scalar::number(1.0));
    });

    test_case!("Functions: Financial IRR & NPV edge cases", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

        // IRR with all positive flows must return #NUM!
        let v_irr_pos = engine.evaluate_formula("=IRR({100; 200; 300})", &origin, None, None);
        assert_eq!(v_irr_pos.error_code(), Some(ErrorCode::Num));

        // IRR with standard cashflow: -100 then 110 -> 0.10 (10%)
        let v_irr_valid = engine.evaluate_formula("=IRR({-100; 110})", &origin, None, None);
        assert!((v_irr_valid.to_scalar().as_f64().unwrap() - 0.10).abs() < 1e-4);

        // NPV with 10% rate
        let v_npv = engine.evaluate_formula("=NPV(0.1, 110, 121)", &origin, None, None);
        // 110 / 1.1 + 121 / 1.21 = 100 + 100 = 200
        assert!((v_npv.to_scalar().as_f64().unwrap() - 200.0).abs() < 1e-4);
    });

    test_case!("Functions: Wildcard and Criteria in XMATCH, COUNTIF, SEARCH", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

        engine.set_cell("sheet1", 0, 0, Cell::value("Apple"));
        engine.set_cell("sheet1", 1, 0, Cell::value("Banana"));
        engine.set_cell("sheet1", 2, 0, Cell::value("Apricot"));
        engine.recalculate();

        // COUNTIF with wildcard "Ap*" -> 2
        let v_countif = engine.evaluate_formula("=COUNTIF(A1:A3, \"Ap*\")", &origin, None, None);
        assert_eq!(v_countif.to_scalar(), Scalar::number(2.0));

        // SEARCH with wildcard "b?n*" -> 1
        let v_search = engine.evaluate_formula("=SEARCH(\"b?n*\", \"Banana\")", &origin, None, None);
        assert_eq!(v_search.to_scalar(), Scalar::number(1.0));

        // XMATCH with wildcard mode (match_mode = 2)
        let v_xmatch = engine.evaluate_formula("=XMATCH(\"B*a\", A1:A3, 2)", &origin, None, None);
        assert_eq!(v_xmatch.to_scalar(), Scalar::number(2.0));
    });

    test_case!("Functions: Lambda Application & LET scoping", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

        // Multi-argument LAMBDA direct invocation
        let v_lam = engine.evaluate_formula("=LAMBDA(x, y, x * 2 + y)(10, 5)", &origin, None, None);
        assert_eq!(v_lam.to_scalar(), Scalar::number(25.0));

        // LET scoping with unused expression containing error
        let v_let = engine.evaluate_formula("=LET(unused, 1/0, x, 5, y, x * 4, y + 2)", &origin, None, None);
        assert_eq!(v_let.to_scalar(), Scalar::number(22.0));
    });

    test_case!("Functions: Unicode character handling (LEN, MID)", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

        let v_len = engine.evaluate_formula("=LEN(\"🚀🔥\")", &origin, None, None);
        assert_eq!(v_len.to_scalar(), Scalar::number(2.0));

        let v_mid = engine.evaluate_formula("=MID(\"你好世界\", 2, 2)", &origin, None, None);
        assert_eq!(v_mid.to_scalar(), Scalar::string("好世"));
    });

    // 5. Deep Dependency Chain Stress Test
    test_case!("Engine: 500-cell linear dependency chain", {
        let wb = create_test_workbook();
        let mut engine = Engine::new(&wb);
        engine.set_cell("sheet1", 0, 0, Cell::value(1.0));
        for r in 1..500 {
            let formula = format!("=A{} + 1", r);
            engine.set_cell("sheet1", r, 0, Cell::formula(formula));
        }
        let res = engine.recalculate();
        assert_eq!(res.calculated_count, 500); // 1 root value cell + 499 formula cells
        let val_last = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 499, col: 0 });
        assert_eq!(val_last.to_scalar(), Scalar::number(500.0));

        // Modify root A1 = 10
        engine.set_cell("sheet1", 0, 0, Cell::value(10.0));
        let res2 = engine.recalculate();
        assert_eq!(res2.calculated_count, 500);
        let val_last_upd = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 499, col: 0 });
        assert_eq!(val_last_upd.to_scalar(), Scalar::number(509.0));
    });

    println!("\n==========================================");
    println!("ADVERSARIAL STRESS TEST SUMMARY");
    println!("PASSED: {}", passed);
    println!("FAILED: {}", failed);
    println!("==========================================");

    if failed > 0 {
        std::process::exit(1);
    }
}
