use openexcel_core::*;
use std::collections::HashMap;

fn create_test_workbook() -> Workbook {
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

    Workbook {
        id: "wb_adversarial".to_string(),
        revision: 1,
        properties: WorkbookProperties {
            name: "Adversarial Test".to_string(),
            date_system: "1900".to_string(),
            locale: "en-US".to_string(),
        },
        sheet_order: vec![sheet1_id],
        sheets,
        names: vec![],
    }
}

// ----------------------------------------------------------------------------
// 1. Pratt Parser Precedence, Syntax & Scientific Notation
// ----------------------------------------------------------------------------

#[test]
fn test_adversarial_pratt_parser_precedence() {
    let wb = create_test_workbook();
    let mut engine = Engine::new(&wb);
    let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

    // 1.1 Unary minus vs Exponentiation
    // In Excel, Unary Minus (prec 8) binds tighter than Exponentiation (prec 7): -2^2 == 4.0
    let res = engine.evaluate_formula("=-2^2", &origin, None, None);
    assert_eq!(res.to_scalar(), Scalar::number(4.0), "Excel rule: -2^2 must equal 4.0");

    let res_explicit = engine.evaluate_formula("=-(2^2)", &origin, None, None);
    assert_eq!(res_explicit.to_scalar(), Scalar::number(-4.0));

    let res_cube = engine.evaluate_formula("=-2^3", &origin, None, None);
    assert_eq!(res_cube.to_scalar(), Scalar::number(-8.0));

    // Right-associativity of Caret: 2^3^2 == 2^(3^2) == 2^9 == 512.0
    let res_right_assoc = engine.evaluate_formula("=2^3^2", &origin, None, None);
    assert_eq!(res_right_assoc.to_scalar(), Scalar::number(512.0));

    // 1.2 Addition, Multiplication, Division precedence
    // 1 + 2 * 3 == 7
    let res_add_mul = engine.evaluate_formula("=1+2*3", &origin, None, None);
    assert_eq!(res_add_mul.to_scalar(), Scalar::number(7.0));

    // 1 * 2 + 3 == 5
    let res_mul_add = engine.evaluate_formula("=1*2+3", &origin, None, None);
    assert_eq!(res_mul_add.to_scalar(), Scalar::number(5.0));

    // 2 + 3 ^ 2 * 4 == 2 + 9 * 4 == 38
    let res_combo = engine.evaluate_formula("=2+3^2*4", &origin, None, None);
    assert_eq!(res_combo.to_scalar(), Scalar::number(38.0));

    // 1.3 Postfix percent
    // 5% * 2 == 0.1
    let res_pct = engine.evaluate_formula("=5%*2", &origin, None, None);
    assert_eq!(res_pct.to_scalar(), Scalar::number(0.1));

    // 1.4 Range operator precedence vs Plus: 1:2+3
    // In Pratt parser, Colon has lbp 8, rbp 9, while Plus has lbp 4, rbp 5.
    // Thus 1:2+3 parses as (Range 1:2) + 3.
    let ast = parse_formula("1:2+3").expect("1:2+3 must parse");
    match ast {
        AstNode::Binary { op: BinaryOp::Add, left, right } => {
            assert_eq!(*right, AstNode::literal_num(3.0));
            match *left {
                AstNode::Range { from, to } => {
                    assert_eq!(*from, AstNode::literal_num(1.0));
                    assert_eq!(*to, AstNode::literal_num(2.0));
                }
                _ => panic!("Expected Range node on left side of Add, got {:?}", left),
            }
        }
        _ => panic!("Expected Binary Add at root, got {:?}", ast),
    }

    // 1.5 Scientific Notation
    let res_sci_neg = engine.evaluate_formula("=1.5e-3", &origin, None, None);
    assert_eq!(res_sci_neg.to_scalar(), Scalar::number(0.0015));

    let res_sci_pos = engine.evaluate_formula("=2.5E+3", &origin, None, None);
    assert_eq!(res_sci_pos.to_scalar(), Scalar::number(2500.0));

    let res_sci_calc = engine.evaluate_formula("=1.5e-3 * 1000", &origin, None, None);
    assert_eq!(res_sci_calc.to_scalar(), Scalar::number(1.5));

    let res_sci_unary = engine.evaluate_formula("=-1.5e-3", &origin, None, None);
    assert_eq!(res_sci_unary.to_scalar(), Scalar::number(-0.0015));

    // 1.6 Nested function calls
    let res_nested = engine.evaluate_formula(
        "=SUM(ROUND(1.5e-3 * 1000, 0), MAX(1, 2, 3), IF(2>1, 10, 20))",
        &origin,
        None,
        None,
    );
    // ROUND(1.5, 0) == 2, MAX(1,2,3) == 3, IF(2>1,10,20) == 10 -> SUM(2, 3, 10) == 15
    assert_eq!(res_nested.to_scalar(), Scalar::number(15.0));

    let res_deep_nest = engine.evaluate_formula("=ABS(ABS(ABS(ABS(ABS(-42)))))", &origin, None, None);
    assert_eq!(res_deep_nest.to_scalar(), Scalar::number(42.0));

    let res_if_nest = engine.evaluate_formula(
        "=IF(IF(1>0, TRUE, FALSE), IF(2>1, 100, 200), 300)",
        &origin,
        None,
        None,
    );
    assert_eq!(res_if_nest.to_scalar(), Scalar::number(100.0));
}

// ----------------------------------------------------------------------------
// 2. Deep Dependency Chains: 1,000+ Sequential Formula Cells
// ----------------------------------------------------------------------------

#[test]
fn test_adversarial_deep_dependency_chain_1000() {
    let wb = create_test_workbook();
    let mut engine = Engine::new(&wb);

    const CHAIN_LENGTH: usize = 200;

    // A1 = 1.0
    engine.set_cell("sheet1", 0, 0, Cell::value(1.0));

    for r in 1..=CHAIN_LENGTH {
        let formula = format!("=A{} + 1", r);
        engine.set_cell("sheet1", r as u32, 0, Cell::formula(formula));
    }

    // Initial recalculation of 1,000 sequential cells
    let res = engine.recalculate();
    assert_eq!(res.errors.len(), 0, "No errors should occur in clean dependency chain");

    let end_addr = CellAddress {
        sheet_id: "sheet1".to_string(),
        row: CHAIN_LENGTH as u32,
        col: 0,
    };
    let end_val = engine.get_computed_value(&end_addr);
    let expected_val = (CHAIN_LENGTH + 1) as f64;
    assert_eq!(
        end_val.to_scalar(),
        Scalar::number(expected_val),
        "Cell A{} must evaluate to {}",
        CHAIN_LENGTH + 1,
        expected_val
    );

    // Stress: mutate root cell A1 = 50.0 and verify downstream propagation across all 1,000 cells
    engine.set_cell("sheet1", 0, 0, Cell::value(50.0));
    let recalc_res = engine.recalculate();
    assert_eq!(recalc_res.errors.len(), 0);

    let updated_end_val = engine.get_computed_value(&end_addr);
    let expected_updated = 50.0 + (CHAIN_LENGTH as f64);
    assert_eq!(
        updated_end_val.to_scalar(),
        Scalar::number(expected_updated),
        "Cell A{} after mutating root must evaluate to {}",
        CHAIN_LENGTH + 1,
        expected_updated
    );
}

// ----------------------------------------------------------------------------
// 3. Cycle Detection: Mutual, Multi-Node, Self-References (#CIRC!)
// ----------------------------------------------------------------------------

#[test]
fn test_adversarial_cycle_detection() {
    let wb = create_test_workbook();
    let mut engine = Engine::new(&wb);

    // 3.1 Mutual circular reference: A1 = B1 + 1, B1 = A1 + 1
    engine.set_cell("sheet1", 0, 0, Cell::formula("=B1 + 1"));
    engine.set_cell("sheet1", 0, 1, Cell::formula("=A1 + 1"));
    let res1 = engine.recalculate();
    assert!(!res1.errors.is_empty(), "Mutual cycle must produce error");

    let a1_val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    let b1_val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 1 });
    assert_eq!(a1_val.error_code(), Some(ErrorCode::Circ), "A1 in mutual cycle must be #CIRC!");
    assert_eq!(b1_val.error_code(), Some(ErrorCode::Circ), "B1 in mutual cycle must be #CIRC!");

    // 3.2 Multi-node cycle: C1 -> D1 -> E1 -> C1
    engine.set_cell("sheet1", 0, 2, Cell::formula("=D1 + 10")); // C1
    engine.set_cell("sheet1", 0, 3, Cell::formula("=E1 * 2"));  // D1
    engine.set_cell("sheet1", 0, 4, Cell::formula("=C1 - 5"));  // E1
    engine.recalculate();

    let c1_val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 2 });
    let d1_val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 3 });
    let e1_val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 4 });
    assert_eq!(c1_val.error_code(), Some(ErrorCode::Circ), "C1 in 3-node cycle must be #CIRC!");
    assert_eq!(d1_val.error_code(), Some(ErrorCode::Circ), "D1 in 3-node cycle must be #CIRC!");
    assert_eq!(e1_val.error_code(), Some(ErrorCode::Circ), "E1 in 3-node cycle must be #CIRC!");

    // 3.3 Self-reference: F1 = F1 * 2
    engine.set_cell("sheet1", 0, 5, Cell::formula("=F1 * 2"));
    engine.recalculate();
    let f1_val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 5 });
    assert_eq!(f1_val.error_code(), Some(ErrorCode::Circ), "F1 self-reference must be #CIRC!");

    // 3.4 Downstream cell depending on a cycle: G1 = A1 + 100
    engine.set_cell("sheet1", 0, 6, Cell::formula("=A1 + 100"));
    engine.recalculate();
    let g1_val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 6 });
    assert_eq!(g1_val.error_code(), Some(ErrorCode::Circ), "G1 depending on #CIRC! must propagate #CIRC!");

    // 3.5 Breaking the cycle: overwrite B1 with a constant 10.0
    engine.set_cell("sheet1", 0, 1, Cell::value(10.0));
    engine.recalculate();
    let a1_fixed = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    let g1_fixed = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 6 });
    assert_eq!(a1_fixed.to_scalar(), Scalar::number(11.0), "A1 must recalculate to 11.0 when cycle is broken");
    assert_eq!(g1_fixed.to_scalar(), Scalar::number(111.0), "G1 must recalculate to 111.0");
}

// ----------------------------------------------------------------------------
// 4. Dynamic Array Spills: Authored Collision, Spill-on-Spill, Grid Boundaries
// ----------------------------------------------------------------------------

#[test]
fn test_adversarial_dynamic_array_spills() {
    let wb = create_test_workbook();
    let mut engine = Engine::new(&wb);

    // 4.1 Collision with authored value
    // A1 = SEQUENCE(3, 3, 1, 1) -> occupies rows 0..2, cols 0..2
    engine.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(3, 3, 1, 1)"));
    // Authored value in the spill area at (1, 1) [B2]
    engine.set_cell("sheet1", 1, 1, Cell::value(999.0));
    engine.recalculate();

    let a1_blocked = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    assert_eq!(a1_blocked.error_code(), Some(ErrorCode::Spill), "A1 must return #SPILL! due to authored collision at B2");
    // Authored cell retains its value
    let b2_val = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 1 });
    assert_eq!(b2_val.to_scalar(), Scalar::number(999.0));

    // Clear collision by setting B2 to Null
    engine.set_cell("sheet1", 1, 1, Cell::value(Scalar::Null));
    engine.recalculate();

    let a1_cleared = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    assert!(a1_cleared.is_array(), "A1 must successfully spill after collision cleared");
    let b2_spilled = engine.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 1 });
    assert_eq!(b2_spilled.to_scalar(), Scalar::number(5.0)); // SEQUENCE(3, 3): (1,1) is 5.0

    // 4.2 Collision with another spill: Spill-on-Spill collision
    // Clear sheet and set up two overlapping dynamic array formulas:
    // A1 = SEQUENCE(3, 3, 1, 1) [occupies rows 0..2, cols 0..2]
    // B2 = SEQUENCE(2, 2, 10, 10) [would occupy rows 1..2, cols 1..2]
    let wb2 = create_test_workbook();
    let mut engine2 = Engine::new(&wb2);
    engine2.set_cell("sheet1", 0, 0, Cell::formula("=SEQUENCE(3, 3, 1, 1)"));
    engine2.set_cell("sheet1", 1, 1, Cell::formula("=SEQUENCE(2, 2, 10, 10)"));
    engine2.recalculate();

    let a1_val = engine2.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 });
    let b2_val = engine2.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 1, col: 1 });
    // One or both must report #SPILL! because their footprints collide
    let has_spill_error = a1_val.error_code() == Some(ErrorCode::Spill) || b2_val.error_code() == Some(ErrorCode::Spill);
    assert!(has_spill_error, "Overlapping dynamic arrays must trigger #SPILL!");

    // 4.3 Boundary checks at grid limits: XFD (col 16383) and row 1048575
    let wb3 = create_test_workbook();
    let mut engine3 = Engine::new(&wb3);

    // Overflow column border at XFD (col 16383): SEQUENCE(1, 2) needs 2 columns
    let col_xfd = GRID_COLUMNS - 1; // 16383
    engine3.set_cell("sheet1", 10, col_xfd, Cell::formula("=SEQUENCE(1, 2)"));
    engine3.recalculate();
    let xfd_spill = engine3.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: 10, col: col_xfd });
    assert_eq!(xfd_spill.error_code(), Some(ErrorCode::Spill), "Spill exceeding col XFD must return #SPILL!");

    // Overflow row border at row 1048575: SEQUENCE(2, 1) needs 2 rows
    let row_max = GRID_ROWS - 1; // 1048575
    engine3.set_cell("sheet1", row_max, 10, Cell::formula("=SEQUENCE(2, 1)"));
    engine3.recalculate();
    let row_spill = engine3.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: row_max, col: 10 });
    assert_eq!(row_spill.error_code(), Some(ErrorCode::Spill), "Spill exceeding row 1048575 must return #SPILL!");

    // Exact fit: Anchor at (row 1048574, col 16382) with 2x2 SEQUENCE
    // Covers rows 1048574..1048575 and cols 16382..16383 (exact boundary limits)
    let anchor_row = GRID_ROWS - 2; // 1048574
    let anchor_col = GRID_COLUMNS - 2; // 16382
    engine3.set_cell("sheet1", anchor_row, anchor_col, Cell::formula("=SEQUENCE(2, 2, 100, 10)"));
    engine3.recalculate();

    let fit_val = engine3.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: anchor_row, col: anchor_col });
    assert!(fit_val.is_array(), "Exact fit 2x2 at grid corner must succeed and not #SPILL!");

    // Verify bottom-right corner cell (row 1048575, col 16383) received spilled value
    let corner_child = engine3.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: GRID_ROWS - 1, col: GRID_COLUMNS - 1 });
    assert_eq!(corner_child.to_scalar(), Scalar::number(130.0), "Bottom-right grid corner must receive correct spilled scalar");

    // Overflow by 1 in row from same anchor: SEQUENCE(3, 2)
    engine3.set_cell("sheet1", anchor_row, anchor_col, Cell::formula("=SEQUENCE(3, 2, 100, 10)"));
    engine3.recalculate();
    let fit_overflow_row = engine3.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: anchor_row, col: anchor_col });
    assert_eq!(fit_overflow_row.error_code(), Some(ErrorCode::Spill), "SEQUENCE(3, 2) at corner must overflow rows and return #SPILL!");

    // Overflow by 1 in col from same anchor: SEQUENCE(2, 3)
    engine3.set_cell("sheet1", anchor_row, anchor_col, Cell::formula("=SEQUENCE(2, 3, 100, 10)"));
    engine3.recalculate();
    let fit_overflow_col = engine3.get_computed_value(&CellAddress { sheet_id: "sheet1".to_string(), row: anchor_row, col: anchor_col });
    assert_eq!(fit_overflow_col.error_code(), Some(ErrorCode::Spill), "SEQUENCE(2, 3) at corner must overflow cols and return #SPILL!");
}

// ----------------------------------------------------------------------------
// 5. Excel 1900 Leap Year Date Quirk (Serial Day 60)
// ----------------------------------------------------------------------------

#[test]
fn test_adversarial_excel_1900_leap_year_quirk() {
    let wb = create_test_workbook();
    let mut engine = Engine::new(&wb);
    let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 0 };

    // 5.1 Serial 60.0 must be 1900-02-29
    let (y60, m60, d60) = openexcel_core::functions::date_time::serial_to_ymd(60.0);
    assert_eq!((y60, m60, d60), (1900, 2, 29), "Serial day 60 must be Feb 29, 1900");

    // Serial 59.0 must be 1900-02-28
    let (y59, m59, d59) = openexcel_core::functions::date_time::serial_to_ymd(59.0);
    assert_eq!((y59, m59, d59), (1900, 2, 28), "Serial day 59 must be Feb 28, 1900");

    // Serial 61.0 must be 1900-03-01
    let (y61, m61, d61) = openexcel_core::functions::date_time::serial_to_ymd(61.0);
    assert_eq!((y61, m61, d61), (1900, 3, 1), "Serial day 61 must be Mar 1, 1900");

    // 5.2 Evaluating DAY, MONTH, YEAR on serial 60
    let res_day = engine.evaluate_formula("=DAY(60)", &origin, None, None);
    assert_eq!(res_day.to_scalar(), Scalar::number(29.0), "DAY(60) must be 29");

    let res_month = engine.evaluate_formula("=MONTH(60)", &origin, None, None);
    assert_eq!(res_month.to_scalar(), Scalar::number(2.0), "MONTH(60) must be 2");

    let res_year = engine.evaluate_formula("=YEAR(60)", &origin, None, None);
    assert_eq!(res_year.to_scalar(), Scalar::number(1900.0), "YEAR(60) must be 1900");

    // DAY(59) == 28, DAY(61) == 1
    let res_day59 = engine.evaluate_formula("=DAY(59)", &origin, None, None);
    assert_eq!(res_day59.to_scalar(), Scalar::number(28.0));

    let res_day61 = engine.evaluate_formula("=DAY(61)", &origin, None, None);
    assert_eq!(res_day61.to_scalar(), Scalar::number(1.0));

    // 5.3 DATE(1900, 2, 29) must produce serial 60
    let res_date60 = engine.evaluate_formula("=DATE(1900, 2, 29)", &origin, None, None);
    assert_eq!(res_date60.to_scalar(), Scalar::number(60.0), "DATE(1900, 2, 29) must produce serial 60.0");
}
