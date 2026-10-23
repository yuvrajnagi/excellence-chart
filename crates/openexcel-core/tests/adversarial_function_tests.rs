use openexcel_core::*;
use std::collections::HashMap;

fn create_engine() -> Engine {
    let sheet_id = "sheet1".to_string();
    let mut sheets = HashMap::new();
    let mut sheet = Sheet {
        id: sheet_id.clone(),
        properties: SheetProperties {
            name: "Sheet1".to_string(),
            tab_color: None,
            hidden: false,
            default_row_height: 20.0,
            default_column_width: 80.0,
            tables: vec![],
        },
        tiles: HashMap::new(),
    };

    let seed: &[(&str, Scalar)] = &[
        ("A1", Scalar::number(10.0)),
        ("A2", Scalar::number(20.0)),
        ("A3", Scalar::number(30.0)),
        ("A4", Scalar::number(40.0)),
        ("A5", Scalar::number(50.0)),
        ("B1", Scalar::string("Apple")),
        ("B2", Scalar::string("Banana")),
        ("B3", Scalar::string("Apple")),
        ("B4", Scalar::string("Orange")),
        ("B5", Scalar::string("Banana")),
        ("C1", Scalar::number(100.0)),
        ("C2", Scalar::number(200.0)),
        ("C3", Scalar::number(300.0)),
        ("C4", Scalar::number(400.0)),
        ("C5", Scalar::number(500.0)),
    ];

    let mut grid = SheetGrid::new(&sheet_id, "Sheet1");
    for &(pos, ref val) in seed {
        let addr = parse_address(pos, &sheet_id).unwrap();
        grid.set_cell(addr.row, addr.col, Cell::value(val.clone()));
    }
    sheet.tiles = grid.tiles;
    sheets.insert(sheet_id.clone(), sheet);

    let wb = Workbook {
        id: "wb1".to_string(),
        revision: 1,
        properties: WorkbookProperties {
            name: "Test Workbook".to_string(),
            date_system: "1900".to_string(),
            locale: "en-US".to_string(),
        },
        sheet_order: vec![sheet_id],
        sheets,
        names: vec![],
    };

    let mut engine = Engine::new(&wb);
    engine.set_clock(1704153600000); // 2024-01-02T00:00:00Z -> serial 45293
    engine.set_seed(42);
    engine
}

fn eval(engine: &mut Engine, formula: &str) -> ComputedValue {
    let origin = CellAddress {
        sheet_id: "sheet1".to_string(),
        row: 0,
        col: 10,
    };
    engine.evaluate_formula(formula, &origin, None, None)
}

#[test]
fn test_adversarial_math() {
    let mut engine = create_engine();

    // 1. SUM
    assert_eq!(eval(&mut engine, "=SUM(Z1:Z10)").to_scalar(), Scalar::number(0.0));
    assert_eq!(eval(&mut engine, "=SUM(A1:B3)").to_scalar(), Scalar::number(60.0));
    assert_eq!(eval(&mut engine, "=SUM(1, 2, 1/0)").error_code(), Some(ErrorCode::Div0));
    assert_eq!(eval(&mut engine, "=SUM({1, 2; 3, 4})").to_scalar(), Scalar::number(10.0));

    // 2. AVERAGEIF
    assert_eq!(eval(&mut engine, "=AVERAGEIF(B1:B5, \"Apple\", A1:A5)").to_scalar(), Scalar::number(20.0));
    assert_eq!(eval(&mut engine, "=AVERAGEIF(B1:B5, \"*nana*\", A1:A5)").to_scalar(), Scalar::number(35.0)); // Banana (20) + Banana (50) = 70/2 = 35
    assert_eq!(eval(&mut engine, "=AVERAGEIF(B1:B5, \"*an*\", A1:A5)").to_scalar(), Scalar::number(110.0 / 3.0)); // Banana, Orange, Banana
    assert_eq!(eval(&mut engine, "=AVERAGEIF(A1:A5, \">25\")").to_scalar(), Scalar::number(40.0));
    assert_eq!(eval(&mut engine, "=AVERAGEIF(B1:B5, \"Grape\", A1:A5)").error_code(), Some(ErrorCode::Div0));
    // Averageif with unequal range lengths evaluates available elements without crashing
    assert_eq!(eval(&mut engine, "=AVERAGEIF(B1:B5, \"Apple\", A1:A3)").to_scalar(), Scalar::number(20.0));

    // 3. SUBTOTAL (codes 1..11 and 101..111)
    // 1 / 101: AVERAGE
    assert_eq!(eval(&mut engine, "=SUBTOTAL(1, A1:A3)").to_scalar(), Scalar::number(20.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(101, A1:A3)").to_scalar(), Scalar::number(20.0));

    // 2 / 102: COUNT
    assert_eq!(eval(&mut engine, "=SUBTOTAL(2, A1:A3)").to_scalar(), Scalar::number(3.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(102, A1:A3)").to_scalar(), Scalar::number(3.0));

    // 3 / 103: COUNTA
    assert_eq!(eval(&mut engine, "=SUBTOTAL(3, A1:A3)").to_scalar(), Scalar::number(3.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(103, A1:A3)").to_scalar(), Scalar::number(3.0));

    // 4 / 104: MAX
    assert_eq!(eval(&mut engine, "=SUBTOTAL(4, A1:A3)").to_scalar(), Scalar::number(30.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(104, A1:A3)").to_scalar(), Scalar::number(30.0));

    // 5 / 105: MIN
    assert_eq!(eval(&mut engine, "=SUBTOTAL(5, A1:A3)").to_scalar(), Scalar::number(10.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(105, A1:A3)").to_scalar(), Scalar::number(10.0));

    // 6 / 106: PRODUCT
    assert_eq!(eval(&mut engine, "=SUBTOTAL(6, A1:A3)").to_scalar(), Scalar::number(6000.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(106, A1:A3)").to_scalar(), Scalar::number(6000.0));

    // 7 / 107: STDEV.S
    assert_eq!(eval(&mut engine, "=SUBTOTAL(7, A1:A3)").to_scalar(), Scalar::number(10.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(107, A1:A3)").to_scalar(), Scalar::number(10.0));

    // 8 / 108: STDEV.P
    if let Scalar::Number { value } = eval(&mut engine, "=SUBTOTAL(8, A1:A3)").to_scalar() {
        assert!((value - 8.16496580927726).abs() < 1e-6);
    } else {
        panic!("SUBTOTAL 8 failed");
    }
    if let Scalar::Number { value } = eval(&mut engine, "=SUBTOTAL(108, A1:A3)").to_scalar() {
        assert!((value - 8.16496580927726).abs() < 1e-6);
    } else {
        panic!("SUBTOTAL 108 failed");
    }

    // 9 / 109: SUM
    assert_eq!(eval(&mut engine, "=SUBTOTAL(9, A1:A3)").to_scalar(), Scalar::number(60.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(109, A1:A3)").to_scalar(), Scalar::number(60.0));

    // 10 / 110: VAR.S
    assert_eq!(eval(&mut engine, "=SUBTOTAL(10, A1:A3)").to_scalar(), Scalar::number(100.0));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(110, A1:A3)").to_scalar(), Scalar::number(100.0));

    // 11 / 111: VAR.P
    if let Scalar::Number { value } = eval(&mut engine, "=SUBTOTAL(11, A1:A3)").to_scalar() {
        assert!((value - 66.66666666666667).abs() < 1e-6);
    } else {
        panic!("SUBTOTAL 11 failed");
    }
    if let Scalar::Number { value } = eval(&mut engine, "=SUBTOTAL(111, A1:A3)").to_scalar() {
        assert!((value - 66.66666666666667).abs() < 1e-6);
    } else {
        panic!("SUBTOTAL 111 failed");
    }

    // Invalid SUBTOTAL codes
    assert_eq!(eval(&mut engine, "=SUBTOTAL(0, A1:A3)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(12, A1:A3)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(100, A1:A3)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(112, A1:A3)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(-1, A1:A3)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=SUBTOTAL(9.5, A1:A3)").error_code(), Some(ErrorCode::Value));

    // 4. MOD with negative numbers
    assert_eq!(eval(&mut engine, "=MOD(3, 2)").to_scalar(), Scalar::number(1.0));
    assert_eq!(eval(&mut engine, "=MOD(-3, 2)").to_scalar(), Scalar::number(1.0));
    assert_eq!(eval(&mut engine, "=MOD(3, -2)").to_scalar(), Scalar::number(-1.0));
    assert_eq!(eval(&mut engine, "=MOD(-3, -2)").to_scalar(), Scalar::number(-1.0));
    assert_eq!(eval(&mut engine, "=MOD(-7, 3)").to_scalar(), Scalar::number(2.0));
    assert_eq!(eval(&mut engine, "=MOD(7, -3)").to_scalar(), Scalar::number(-2.0));
    assert_eq!(eval(&mut engine, "=MOD(-7, -3)").to_scalar(), Scalar::number(-1.0));
    assert_eq!(eval(&mut engine, "=MOD(-5.5, 2)").to_scalar(), Scalar::number(0.5));
    assert_eq!(eval(&mut engine, "=MOD(5.5, -2)").to_scalar(), Scalar::number(-0.5));
    assert_eq!(eval(&mut engine, "=MOD(5, 0)").error_code(), Some(ErrorCode::Div0));
    assert_eq!(eval(&mut engine, "=MOD(-5, 0)").error_code(), Some(ErrorCode::Div0));
}

#[test]
fn test_adversarial_logical() {
    let mut engine = create_engine();

    // 1. IF with array conditions
    // 2x2 boolean array condition with scalar branches
    let if_res = eval(&mut engine, "=IF({TRUE, FALSE; FALSE, TRUE}, 10, 20)");
    match if_res {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 2);
            assert_eq!(cols, 2);
            assert_eq!(values[0], Scalar::number(10.0));
            assert_eq!(values[1], Scalar::number(20.0));
            assert_eq!(values[2], Scalar::number(20.0));
            assert_eq!(values[3], Scalar::number(10.0));
        }
        _ => panic!("Expected array result from IF with array condition, got {:?}", if_res),
    }

    // IF with array condition and array branches
    let if_arr_branch = eval(&mut engine, "=IF({TRUE, FALSE; FALSE, TRUE}, {1, 2; 3, 4}, {10, 20; 30, 40})");
    match if_arr_branch {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 2);
            assert_eq!(cols, 2);
            assert_eq!(values[0], Scalar::number(1.0));
            assert_eq!(values[1], Scalar::number(20.0));
            assert_eq!(values[2], Scalar::number(30.0));
            assert_eq!(values[3], Scalar::number(4.0));
        }
        _ => panic!("Expected array result, got {:?}", if_arr_branch),
    }

    // IF with array condition containing an error cell
    let if_err = eval(&mut engine, "=IF({TRUE, #DIV/0!}, 1, 2)");
    match if_err {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 1);
            assert_eq!(cols, 2);
            assert_eq!(values[0], Scalar::number(1.0));
            assert_eq!(values[1], Scalar::error(ErrorCode::Div0));
        }
        _ => panic!("Expected array result with error cell, got {:?}", if_err),
    }

    // IF with dimension mismatch between condition and branch array
    let if_mismatch = eval(&mut engine, "=IF({TRUE, FALSE}, {1; 2; 3}, 0)");
    assert_eq!(if_mismatch.error_code(), Some(ErrorCode::Value));

    // 2. SWITCH
    // Number matching
    assert_eq!(eval(&mut engine, "=SWITCH(2, 1, \"one\", 2, \"two\", \"other\")").to_scalar(), Scalar::string("two"));
    // Default value when no match
    assert_eq!(eval(&mut engine, "=SWITCH(99, 1, \"one\", 2, \"two\", \"other\")").to_scalar(), Scalar::string("other"));
    // No match without default -> #N/A
    assert_eq!(eval(&mut engine, "=SWITCH(99, 1, \"one\", 2, \"two\")").error_code(), Some(ErrorCode::NA));
    // Case sensitivity / insensitivity in SWITCH: Excel strings are case-insensitive
    assert_eq!(eval(&mut engine, "=SWITCH(\"apple\", \"Apple\", 1, 2)").to_scalar(), Scalar::number(1.0));
    // Target error propagation
    assert_eq!(eval(&mut engine, "=SWITCH(#DIV/0!, 1, \"a\", \"def\")").error_code(), Some(ErrorCode::Div0));
    // Lazy evaluation of non-matching branches (1/0 in unselected branch should not execute)
    assert_eq!(eval(&mut engine, "=SWITCH(1, 1, 42, 2, 1/0, 1/0)").to_scalar(), Scalar::number(42.0));

    // 3. CHOOSE
    assert_eq!(eval(&mut engine, "=CHOOSE(1, 10, 20, 30)").to_scalar(), Scalar::number(10.0));
    assert_eq!(eval(&mut engine, "=CHOOSE(3, 10, 20, 30)").to_scalar(), Scalar::number(30.0));
    // Fractional index truncates
    assert_eq!(eval(&mut engine, "=CHOOSE(2.9, 10, 20, 30)").to_scalar(), Scalar::number(20.0));
    // Index out of bounds
    assert_eq!(eval(&mut engine, "=CHOOSE(0, 10, 20)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=CHOOSE(4, 10, 20, 30)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=CHOOSE(-1, 10, 20)").error_code(), Some(ErrorCode::Value));
    // Lazy evaluation: unselected branches with errors
    assert_eq!(eval(&mut engine, "=CHOOSE(2, 1/0, 99, 1/0)").to_scalar(), Scalar::number(99.0));
}

#[test]
fn test_adversarial_bindings() {
    let mut engine = create_engine();

    // 1. LET with nested / sequential variables
    assert_eq!(eval(&mut engine, "=LET(a, 2, b, a * 3, c, a + b, c * 10)").to_scalar(), Scalar::number(80.0));
    // LET with inner LET (nested scoping and variable shadowing)
    assert_eq!(eval(&mut engine, "=LET(x, 1, y, LET(x, 10, x * 2), x + y)").to_scalar(), Scalar::number(21.0));
    // Unused erroneous bindings do not fail evaluation if unused
    assert_eq!(eval(&mut engine, "=LET(unused, 1/0, x, 5, x * 2)").to_scalar(), Scalar::number(10.0));
    // Used erroneous bindings correctly propagate the error
    assert_eq!(eval(&mut engine, "=LET(err, 1/0, y, err + 1, y)").error_code(), Some(ErrorCode::Div0));
    // LET invalid variable name (literal number instead of name) -> #NAME?
    assert_eq!(eval(&mut engine, "=LET(123, 1, 2)").error_code(), Some(ErrorCode::Name));
    // LET invalid arity (even count or < 3) -> #VALUE!
    assert_eq!(eval(&mut engine, "=LET(x, 1)").error_code(), Some(ErrorCode::Value));

    // 2. LAMBDA application
    // Basic immediate application
    assert_eq!(eval(&mut engine, "=LAMBDA(x, x * x)(6)").to_scalar(), Scalar::number(36.0));
    // Multi-parameter application
    assert_eq!(eval(&mut engine, "=LAMBDA(x, y, x * 2 + y)(3, 4)").to_scalar(), Scalar::number(10.0));
    // Bare uninvoked LAMBDA produces #CALC!
    assert_eq!(eval(&mut engine, "=LAMBDA(x, x + 1)").error_code(), Some(ErrorCode::Calc));
    // Parameter count mismatch -> #VALUE!
    assert_eq!(eval(&mut engine, "=LAMBDA(x, y, x + y)(1)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=LAMBDA(x, x + 1)(1, 2)").error_code(), Some(ErrorCode::Value));

    // What about invoking a named lambda from LET?
    let let_lambda = eval(&mut engine, "=LET(f, LAMBDA(x, x + 1), f(5))");
    println!("LET(f, LAMBDA, f(5)) result: {:?}", let_lambda);

    // What about nested lambda returning lambda: LAMBDA(x, LAMBDA(y, x + y))(2)(3)
    let nested_lambda = eval(&mut engine, "=LAMBDA(x, LAMBDA(y, x + y))(2)(3)");
    println!("LAMBDA currying result: {:?}", nested_lambda);

    // What about recursive lambda?
    let rec_lambda = eval(&mut engine, "=LET(fact, LAMBDA(self, n, IF(n <= 1, 1, n * self(self, n - 1))), fact(fact, 5))");
    println!("Recursive lambda result: {:?}", rec_lambda);
}

#[test]
fn test_adversarial_dynamic_array() {
    let mut engine = create_engine();

    // 1. FILTER
    // Normal filter matching rows
    let f1 = eval(&mut engine, "=FILTER(A1:A5, A1:A5 >= 30)");
    match f1 {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 3);
            assert_eq!(cols, 1);
            assert_eq!(values[0], Scalar::number(30.0));
            assert_eq!(values[1], Scalar::number(40.0));
            assert_eq!(values[2], Scalar::number(50.0));
        }
        _ => panic!("Expected array from FILTER, got {:?}", f1),
    }

    // Empty filter with NO if_empty returns #CALC!
    assert_eq!(eval(&mut engine, "=FILTER(A1:A5, A1:A5 > 1000)").error_code(), Some(ErrorCode::Calc));
    // Empty filter WITH if_empty returns the fallback value
    assert_eq!(eval(&mut engine, "=FILTER(A1:A5, A1:A5 > 1000, \"None\")").to_scalar(), Scalar::string("None"));
    assert_eq!(eval(&mut engine, "=FILTER(A1:A5, A1:A5 > 1000, 0)").to_scalar(), Scalar::number(0.0));
    // Include array length mismatch returns #VALUE!
    assert_eq!(eval(&mut engine, "=FILTER(A1:A5, {TRUE, FALSE})").error_code(), Some(ErrorCode::Value));

    // 2. SORTBY multiple keys
    // Array: {1, 20; 2, 10; 1, 10; 2, 20}
    // Sort key 1 asc (col 1), sort key 2 desc (col 2)
    // Key 1: {1; 2; 1; 2} -> sorted 1s first, then 2s
    // Key 2 for 1s: {20; 10} -> desc: 20, then 10 -> rows (1,20), (1,10)
    // Key 2 for 2s: {10; 20} -> desc: 20, then 10 -> rows (2,20), (2,10)
    let sb = eval(&mut engine, "=SORTBY({1, 20; 2, 10; 1, 10; 2, 20}, {1; 2; 1; 2}, 1, {20; 10; 10; 20}, -1)");
    match sb {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 4);
            assert_eq!(cols, 2);
            assert_eq!(values[0], Scalar::number(1.0));
            assert_eq!(values[1], Scalar::number(20.0));
            assert_eq!(values[2], Scalar::number(1.0));
            assert_eq!(values[3], Scalar::number(10.0));
            assert_eq!(values[4], Scalar::number(2.0));
            assert_eq!(values[5], Scalar::number(20.0));
            assert_eq!(values[6], Scalar::number(2.0));
            assert_eq!(values[7], Scalar::number(10.0));
        }
        _ => panic!("Expected array from SORTBY, got {:?}", sb),
    }

    // Invalid sort order (not 1 or -1) -> #VALUE!
    assert_eq!(eval(&mut engine, "=SORTBY({1; 2}, {1; 2}, 0)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=SORTBY({1; 2}, {1; 2}, 2)").error_code(), Some(ErrorCode::Value));
    // Mismatched key length -> #VALUE!
    assert_eq!(eval(&mut engine, "=SORTBY({1; 2; 3}, {1; 2})").error_code(), Some(ErrorCode::Value));

    // 3. UNIQUE
    // Basic deduplication
    let u1 = eval(&mut engine, "=UNIQUE({1; 2; 1; 3; 2})");
    match u1 {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 3);
            assert_eq!(cols, 1);
            assert_eq!(values[0], Scalar::number(1.0));
            assert_eq!(values[1], Scalar::number(2.0));
            assert_eq!(values[2], Scalar::number(3.0));
        }
        _ => panic!("Expected array from UNIQUE, got {:?}", u1),
    }

    // exactly_once = TRUE
    let u_once = eval(&mut engine, "=UNIQUE({1; 2; 1; 3; 2; 4}, FALSE, TRUE)");
    match u_once {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 2);
            assert_eq!(cols, 1);
            assert_eq!(values[0], Scalar::number(3.0));
            assert_eq!(values[1], Scalar::number(4.0));
        }
        _ => panic!("Expected array from UNIQUE exactly_once, got {:?}", u_once),
    }

    // exactly_once with NO items occurring once -> #CALC!
    assert_eq!(eval(&mut engine, "=UNIQUE({1; 2; 1; 2}, FALSE, TRUE)").error_code(), Some(ErrorCode::Calc));

    // by_col = TRUE
    let u_col = eval(&mut engine, "=UNIQUE({1, 2, 1, 3; 10, 20, 10, 30}, TRUE, FALSE)");
    match u_col {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 2);
            assert_eq!(cols, 3);
            assert_eq!(values[0], Scalar::number(1.0));
            assert_eq!(values[1], Scalar::number(2.0));
            assert_eq!(values[2], Scalar::number(3.0));
            assert_eq!(values[3], Scalar::number(10.0));
            assert_eq!(values[4], Scalar::number(20.0));
            assert_eq!(values[5], Scalar::number(30.0));
        }
        _ => panic!("Expected array from UNIQUE by_col, got {:?}", u_col),
    }

    // 4. SEQUENCE
    let seq = eval(&mut engine, "=SEQUENCE(3, 2, 10, 5)");
    match seq {
        ComputedValue::Array { rows, cols, values, .. } => {
            assert_eq!(rows, 3);
            assert_eq!(cols, 2);
            assert_eq!(values[0], Scalar::number(10.0));
            assert_eq!(values[1], Scalar::number(15.0));
            assert_eq!(values[2], Scalar::number(20.0));
            assert_eq!(values[3], Scalar::number(25.0));
            assert_eq!(values[4], Scalar::number(30.0));
            assert_eq!(values[5], Scalar::number(35.0));
        }
        _ => panic!("Expected array from SEQUENCE, got {:?}", seq),
    }

    // Invalid dimensions -> #CALC!
    assert_eq!(eval(&mut engine, "=SEQUENCE(0)").error_code(), Some(ErrorCode::Calc));
    assert_eq!(eval(&mut engine, "=SEQUENCE(-2)").error_code(), Some(ErrorCode::Calc));
    assert_eq!(eval(&mut engine, "=SEQUENCE(2, 0)").error_code(), Some(ErrorCode::Calc));
    assert_eq!(eval(&mut engine, "=SEQUENCE(2.5)").error_code(), Some(ErrorCode::Calc));
}

#[test]
fn test_adversarial_financial() {
    let mut engine = create_engine();

    // 1. IRR
    // Simple 1-period: -100, +110 -> 10%
    if let Scalar::Number { value } = eval(&mut engine, "=IRR({-100; 110})").to_scalar() {
        assert!((value - 0.1).abs() < 1e-6);
    } else {
        panic!("IRR simple failed");
    }

    // Multi-period cash flows: -1000, 300, 400, 400, 300 -> rate ~ 14.895%
    if let Scalar::Number { value } = eval(&mut engine, "=IRR({-1000; 300; 400; 400; 300})").to_scalar() {
        assert!((value - 0.14895).abs() < 1e-3, "Expected 0.14895, got {}", value);
    } else {
        panic!("IRR multi-period failed");
    }

    // No sign change: all positive -> #NUM!
    assert_eq!(eval(&mut engine, "=IRR({100; 200; 300})").error_code(), Some(ErrorCode::Num));
    // No sign change: all negative -> #NUM!
    assert_eq!(eval(&mut engine, "=IRR({-100; -200; -300})").error_code(), Some(ErrorCode::Num));

    // 2. PMT
    // Normal monthly mortgage: 5% annual rate, 30 years (360 months), $200,000
    // PMT(0.05/12, 360, 200000) -> -1073.64
    if let Scalar::Number { value } = eval(&mut engine, "=PMT(0.05/12, 360, 200000)").to_scalar() {
        assert!((value - -1073.6432).abs() < 1e-2);
    } else {
        panic!("PMT mortgage failed");
    }

    // Zero interest rate
    assert_eq!(eval(&mut engine, "=PMT(0, 10, 100)").to_scalar(), Scalar::number(-10.0));
    // Zero periods -> #DIV/0!
    assert_eq!(eval(&mut engine, "=PMT(0.05, 0, 100)").error_code(), Some(ErrorCode::Div0));
    assert_eq!(eval(&mut engine, "=PMT(0, 0, 100)").error_code(), Some(ErrorCode::Div0));

    // Payment at beginning of period (type = 1)
    if let Scalar::Number { value } = eval(&mut engine, "=PMT(0.05/12, 360, 200000, 0, 1)").to_scalar() {
        assert!((value - -1069.191).abs() < 1e-2);
    } else {
        panic!("PMT type 1 failed");
    }

    // 3. NPV
    // Rate 10%, cash flows 100, 100, 100
    // 100/1.1 + 100/1.21 + 100/1.331 = 248.685199...
    if let Scalar::Number { value } = eval(&mut engine, "=NPV(0.1, 100, 100, 100)").to_scalar() {
        assert!((value - 248.685199144).abs() < 1e-4);
    } else {
        panic!("NPV failed");
    }

    // Zero discount rate: sum of cash flows
    assert_eq!(eval(&mut engine, "=NPV(0, 100, 200, 300)").to_scalar(), Scalar::number(600.0));
}

#[test]
fn test_adversarial_text() {
    let mut engine = create_engine();

    // 1. TEXT format string behavior
    assert_eq!(eval(&mut engine, "=TEXT(12.345, \"0.00\")").to_scalar(), Scalar::string("12.35"));
    assert_eq!(eval(&mut engine, "=TEXT(12, \"0.00\")").to_scalar(), Scalar::string("12.00"));
    assert_eq!(eval(&mut engine, "=TEXT(0.125, \"0.0%\")").to_scalar(), Scalar::string("12.5%"));
    assert_eq!(eval(&mut engine, "=TEXT(42, \"$0.00\")").to_scalar(), Scalar::string("$42.00"));
    assert_eq!(eval(&mut engine, "=TEXT(45292, \"yyyy-mm-dd\")").to_scalar(), Scalar::string("2024-01-01"));

    // 2. TEXTJOIN ignore blanks
    // ignore_empty = TRUE
    assert_eq!(eval(&mut engine, "=TEXTJOIN(\", \", TRUE, \"A\", \"\", \"B\", \"C\")").to_scalar(), Scalar::string("A, B, C"));
    // ignore_empty = FALSE
    assert_eq!(eval(&mut engine, "=TEXTJOIN(\", \", FALSE, \"A\", \"\", \"B\", \"C\")").to_scalar(), Scalar::string("A, , B, C"));
    // Array with empty strings
    assert_eq!(eval(&mut engine, "=TEXTJOIN(\"-\", TRUE, {\"X\", \"\", \"Y\"})").to_scalar(), Scalar::string("X-Y"));
    assert_eq!(eval(&mut engine, "=TEXTJOIN(\"-\", FALSE, {\"X\", \"\", \"Y\"})").to_scalar(), Scalar::string("X--Y"));
    // Error propagation in TEXTJOIN
    assert_eq!(eval(&mut engine, "=TEXTJOIN(\"-\", TRUE, \"A\", 1/0, \"B\")").error_code(), Some(ErrorCode::Div0));

    // 3. SUBSTITUTE instance number
    // All occurrences (no instance arg)
    assert_eq!(eval(&mut engine, "=SUBSTITUTE(\"banana\", \"a\", \"o\")").to_scalar(), Scalar::string("bonono"));
    // Instance 1
    assert_eq!(eval(&mut engine, "=SUBSTITUTE(\"banana\", \"a\", \"o\", 1)").to_scalar(), Scalar::string("bonana"));
    // Instance 2
    assert_eq!(eval(&mut engine, "=SUBSTITUTE(\"banana\", \"a\", \"o\", 2)").to_scalar(), Scalar::string("banona"));
    // Instance 3
    assert_eq!(eval(&mut engine, "=SUBSTITUTE(\"banana\", \"a\", \"o\", 3)").to_scalar(), Scalar::string("banano"));
    // Instance out of range -> unchanged string
    assert_eq!(eval(&mut engine, "=SUBSTITUTE(\"banana\", \"a\", \"o\", 4)").to_scalar(), Scalar::string("banana"));
    // Invalid instance (0 or negative) -> #VALUE!
    assert_eq!(eval(&mut engine, "=SUBSTITUTE(\"banana\", \"a\", \"o\", 0)").error_code(), Some(ErrorCode::Value));
    assert_eq!(eval(&mut engine, "=SUBSTITUTE(\"banana\", \"a\", \"o\", -1)").error_code(), Some(ErrorCode::Value));
    // Empty old_text -> unchanged
    assert_eq!(eval(&mut engine, "=SUBSTITUTE(\"banana\", \"\", \"x\")").to_scalar(), Scalar::string("banana"));
}
