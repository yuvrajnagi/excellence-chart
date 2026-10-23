use openexcel_core::*;
use std::collections::HashMap;

fn create_test_engine() -> Engine {
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

    // A1:A3 = 10, 20, 30
    // A4 = "text"
    // B1:B3 = "North", "South", "North"
    // C1:C3 = 100, 200, 300
    let seed: &[(&str, Scalar)] = &[
        ("A1", Scalar::number(10.0)),
        ("A2", Scalar::number(20.0)),
        ("A3", Scalar::number(30.0)),
        ("A4", Scalar::string("text")),
        ("B1", Scalar::string("North")),
        ("B2", Scalar::string("South")),
        ("B3", Scalar::string("North")),
        ("C1", Scalar::number(100.0)),
        ("C2", Scalar::number(200.0)),
        ("C3", Scalar::number(300.0)),
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
    engine.set_seed(12345);
    engine
}

enum ExpectedValue<'a> {
    Num(f64),
    Str(&'a str),
    Bool(bool),
    Err(ErrorCode),
    Matrix(Vec<Vec<Scalar>>),
    InRange(f64, f64),
}

fn assert_matches(actual: &ComputedValue, expected: ExpectedValue) {
    match expected {
        ExpectedValue::Num(expected_n) => {
            let s = actual.to_scalar();
            match s {
                Scalar::Number { value } => {
                    assert!(
                        (value - expected_n).abs() < 1e-6,
                        "Expected {}, got {}",
                        expected_n,
                        value
                    );
                }
                _ => panic!("Expected number {}, got {:?}", expected_n, actual),
            }
        }
        ExpectedValue::Str(expected_s) => {
            let s = actual.to_scalar();
            match s {
                Scalar::String { value } => {
                    assert_eq!(value, expected_s);
                }
                _ => panic!("Expected string {:?}, got {:?}", expected_s, actual),
            }
        }
        ExpectedValue::Bool(expected_b) => {
            let s = actual.to_scalar();
            match s {
                Scalar::Boolean { value } => {
                    assert_eq!(value, expected_b);
                }
                _ => panic!("Expected bool {}, got {:?}", expected_b, actual),
            }
        }
        ExpectedValue::Err(expected_code) => {
            let code = actual.error_code().unwrap_or_else(|| {
                panic!("Expected error {:?}, got {:?}", expected_code, actual)
            });
            assert_eq!(code, expected_code);
        }
        ExpectedValue::Matrix(expected_matrix) => {
            let rows = expected_matrix.len();
            let cols = expected_matrix[0].len();
            let mut expected_flat = Vec::with_capacity(rows * cols);
            for r in expected_matrix {
                for c in r {
                    expected_flat.push(c);
                }
            }
            match actual {
                ComputedValue::Array { rows: ar, cols: ac, values: av, .. } => {
                    assert_eq!(*ar, rows, "Row count mismatch");
                    assert_eq!(*ac, cols, "Col count mismatch");
                    assert_eq!(av.len(), expected_flat.len(), "Flat length mismatch");
                    for (i, (actual_s, expected_s)) in av.iter().zip(expected_flat.iter()).enumerate() {
                        match (actual_s, expected_s) {
                            (Scalar::Number { value: v1 }, Scalar::Number { value: v2 }) => {
                                assert!(
                                    (v1 - v2).abs() < 1e-6,
                                    "Element {} mismatch: got {}, expected {}",
                                    i,
                                    v1,
                                    v2
                                );
                            }
                            _ => assert_eq!(actual_s, expected_s, "Element {} mismatch", i),
                        }
                    }
                }
                _ => panic!("Expected matrix, got {:?}", actual),
            }
        }
        ExpectedValue::InRange(min, max_exclusive) => {
            let s = actual.to_scalar();
            match s {
                Scalar::Number { value } => {
                    assert!(
                        value >= min && value < max_exclusive,
                        "Value {} not in [{}, {})",
                        value,
                        min,
                        max_exclusive
                    );
                }
                _ => panic!("Expected number in range, got {:?}", actual),
            }
        }
    }
}

#[test]
fn test_all_88_standard_functions() {
    let mut engine = create_test_engine();
    let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 10 };

    let cases: Vec<(&str, &str, ExpectedValue)> = vec![
        ("SUM", "=SUM(A1:A3)", ExpectedValue::Num(60.0)),
        ("AVERAGE", "=AVERAGE(A1:A3)", ExpectedValue::Num(20.0)),
        ("MIN", "=MIN(A1:A3)", ExpectedValue::Num(10.0)),
        ("MAX", "=MAX(A1:A3)", ExpectedValue::Num(30.0)),
        ("COUNT", "=COUNT(A1:A5)", ExpectedValue::Num(3.0)),
        ("COUNTA", "=COUNTA(A1:A5)", ExpectedValue::Num(4.0)),
        ("COUNTIF", "=COUNTIF(B1:B3,\"North\")", ExpectedValue::Num(2.0)),
        ("COUNTIFS", "=COUNTIFS(B1:B3,\"North\",A1:A3,\">10\")", ExpectedValue::Num(1.0)),
        ("SUMIF", "=SUMIF(B1:B3,\"North\",A1:A3)", ExpectedValue::Num(40.0)),
        ("SUMIFS", "=SUMIFS(C1:C3,B1:B3,\"North\",A1:A3,\">=20\")", ExpectedValue::Num(300.0)),
        ("AVERAGEIF", "=AVERAGEIF(B1:B3,\"North\",A1:A3)", ExpectedValue::Num(20.0)),
        ("IF", "=IF(TRUE,7,1/0)", ExpectedValue::Num(7.0)),
        ("IFS", "=IFS(FALSE,1,TRUE,2)", ExpectedValue::Num(2.0)),
        ("AND", "=AND(TRUE,1,2>1)", ExpectedValue::Bool(true)),
        ("OR", "=OR(FALSE,0,2>1)", ExpectedValue::Bool(true)),
        ("NOT", "=NOT(FALSE)", ExpectedValue::Bool(true)),
        ("IFERROR", "=IFERROR(1/0,42)", ExpectedValue::Num(42.0)),
        ("IFNA", "=IFNA(#N/A,17)", ExpectedValue::Num(17.0)),
        ("SWITCH", "=SWITCH(\"b\",\"a\",1,\"b\",2,3)", ExpectedValue::Num(2.0)),
        ("LET", "=LET(x,10,y,x+2,y*3)", ExpectedValue::Num(36.0)),
        ("LAMBDA", "=LAMBDA(x,x+1)(2)", ExpectedValue::Num(3.0)),
        ("INDEX", "=INDEX(C1:C3,2)", ExpectedValue::Num(200.0)),
        ("MATCH", "=MATCH(20,A1:A3,0)", ExpectedValue::Num(2.0)),
        ("XMATCH", "=XMATCH(\"North\",B1:B3,0,-1)", ExpectedValue::Num(3.0)),
        ("XLOOKUP", "=XLOOKUP(20,A1:A3,C1:C3)", ExpectedValue::Num(200.0)),
        ("VLOOKUP", "=VLOOKUP(20,A1:C3,3,FALSE)", ExpectedValue::Num(200.0)),
        ("HLOOKUP", "=HLOOKUP(20,{10,20,30;100,200,300},2,FALSE)", ExpectedValue::Num(200.0)),
        ("FILTER", "=FILTER(A1:A3,A1:A3>10)", ExpectedValue::Matrix(vec![vec![Scalar::number(20.0)], vec![Scalar::number(30.0)]])),
        ("SORT", "=SORT({3;1;2})", ExpectedValue::Matrix(vec![vec![Scalar::number(1.0)], vec![Scalar::number(2.0)], vec![Scalar::number(3.0)]])),
        ("SORTBY", "=SORTBY({3;1;2},{30;10;20})", ExpectedValue::Matrix(vec![vec![Scalar::number(1.0)], vec![Scalar::number(2.0)], vec![Scalar::number(3.0)]])),
        ("UNIQUE", "=UNIQUE({1;2;1;3})", ExpectedValue::Matrix(vec![vec![Scalar::number(1.0)], vec![Scalar::number(2.0)], vec![Scalar::number(3.0)]])),
        ("SEQUENCE", "=SEQUENCE(2,2,5,2)", ExpectedValue::Matrix(vec![vec![Scalar::number(5.0), Scalar::number(7.0)], vec![Scalar::number(9.0), Scalar::number(11.0)]])),
        ("TRANSPOSE", "=TRANSPOSE({1,2;3,4})", ExpectedValue::Matrix(vec![vec![Scalar::number(1.0), Scalar::number(3.0)], vec![Scalar::number(2.0), Scalar::number(4.0)]])),
        ("TAKE", "=TAKE({1;2;3},-2)", ExpectedValue::Matrix(vec![vec![Scalar::number(2.0)], vec![Scalar::number(3.0)]])),
        ("DROP", "=DROP({1;2;3},-1)", ExpectedValue::Matrix(vec![vec![Scalar::number(1.0)], vec![Scalar::number(2.0)]])),
        ("CHOOSE", "=CHOOSE(2,1/0,8,1/0)", ExpectedValue::Num(8.0)),
        ("OFFSET", "=SUM(OFFSET(A1,1,0,2,1))", ExpectedValue::Num(50.0)),
        ("INDIRECT", "=INDIRECT(\"A2\")", ExpectedValue::Num(20.0)),
        ("TEXT", "=TEXT(12.5,\"$0.00\")", ExpectedValue::Str("$12.50")),
        ("VALUE", "=VALUE(\"12.5%\")", ExpectedValue::Num(0.125)),
        ("LEFT", "=LEFT(\"OpenExcel\",4)", ExpectedValue::Str("Open")),
        ("RIGHT", "=RIGHT(\"OpenExcel\",5)", ExpectedValue::Str("Excel")),
        ("MID", "=MID(\"abcdef\",2,3)", ExpectedValue::Str("bcd")),
        ("LEN", "=LEN(\"OpenExcel\")", ExpectedValue::Num(9.0)),
        ("TRIM", "=TRIM(\"  a   b  \")", ExpectedValue::Str("a b")),
        ("SUBSTITUTE", "=SUBSTITUTE(\"a-b-b\",\"b\",\"x\",2)", ExpectedValue::Str("a-b-x")),
        ("REPLACE", "=REPLACE(\"abcdef\",2,3,\"X\")", ExpectedValue::Str("aXef")),
        ("CONCAT", "=CONCAT(\"Open\",\"Excel\")", ExpectedValue::Str("OpenExcel")),
        ("TEXTJOIN", "=TEXTJOIN(\"-\",TRUE,{\"a\",\"\",\"b\"})", ExpectedValue::Str("a-b")),
        ("FIND", "=FIND(\"E\",\"OpenExcel\")", ExpectedValue::Num(5.0)),
        ("SEARCH", "=SEARCH(\"e?c\",\"OpenExcel\")", ExpectedValue::Num(5.0)),
        ("UPPER", "=UPPER(\"Abc\")", ExpectedValue::Str("ABC")),
        ("LOWER", "=LOWER(\"AbC\")", ExpectedValue::Str("abc")),
        ("PROPER", "=PROPER(\"hELLO wORLD\")", ExpectedValue::Str("Hello World")),
        ("ROUND", "=ROUND(-1.25,1)", ExpectedValue::Num(-1.3)),
        ("ROUNDUP", "=ROUNDUP(-1.21,1)", ExpectedValue::Num(-1.3)),
        ("ROUNDDOWN", "=ROUNDDOWN(-1.29,1)", ExpectedValue::Num(-1.2)),
        ("INT", "=INT(-1.2)", ExpectedValue::Num(-2.0)),
        ("MOD", "=MOD(-3,2)", ExpectedValue::Num(1.0)),
        ("ABS", "=ABS(-7)", ExpectedValue::Num(7.0)),
        ("POWER", "=POWER(2,10)", ExpectedValue::Num(1024.0)),
        ("SQRT", "=SQRT(81)", ExpectedValue::Num(9.0)),
        ("RAND", "=RAND()", ExpectedValue::InRange(0.0, 1.0)),
        ("RANDBETWEEN", "=RANDBETWEEN(4,4)", ExpectedValue::Num(4.0)),
        ("TODAY", "=TODAY()", ExpectedValue::Num(45293.0)),
        ("NOW", "=NOW()", ExpectedValue::Num(45293.0)),
        ("DATE", "=DATE(2024,1,1)", ExpectedValue::Num(45292.0)),
        ("YEAR", "=YEAR(DATE(2024,2,29))", ExpectedValue::Num(2024.0)),
        ("MONTH", "=MONTH(DATE(2024,2,29))", ExpectedValue::Num(2.0)),
        ("DAY", "=DAY(DATE(2024,2,29))", ExpectedValue::Num(29.0)),
        ("EDATE", "=EDATE(DATE(2024,1,31),1)", ExpectedValue::Num(45351.0)),
        ("EOMONTH", "=EOMONTH(DATE(2024,1,1),0)", ExpectedValue::Num(45322.0)),
        ("NETWORKDAYS", "=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7))", ExpectedValue::Num(5.0)),
        ("WORKDAY", "=WORKDAY(DATE(2024,1,5),1)", ExpectedValue::Num(45299.0)),
        ("PMT", "=PMT(0,10,100)", ExpectedValue::Num(-10.0)),
        ("PV", "=PV(0,10,-10)", ExpectedValue::Num(100.0)),
        ("FV", "=FV(0,10,-10)", ExpectedValue::Num(100.0)),
        ("NPV", "=NPV(0.1,110)", ExpectedValue::Num(100.0)),
        ("IRR", "=IRR({-100;110})", ExpectedValue::Num(0.1)),
        ("STDEV.S", "=STDEV.S(A1:A3)", ExpectedValue::Num(10.0)),
        ("STDEV.P", "=STDEV.P(A1:A3)", ExpectedValue::Num(8.16496580927726)),
        ("VAR.S", "=VAR.S(A1:A3)", ExpectedValue::Num(100.0)),
        ("VAR.P", "=VAR.P(A1:A3)", ExpectedValue::Num(66.66666666666667)),
        ("MEDIAN", "=MEDIAN(1,8,3,6)", ExpectedValue::Num(4.5)),
        ("LARGE", "=LARGE(A1:A3,2)", ExpectedValue::Num(20.0)),
        ("SMALL", "=SMALL(A1:A3,2)", ExpectedValue::Num(20.0)),
        ("RANK.EQ", "=RANK.EQ(20,A1:A3,0)", ExpectedValue::Num(2.0)),
        ("SUBTOTAL", "=SUBTOTAL(9,A1:A3)", ExpectedValue::Num(60.0)),
    ];

    assert_eq!(cases.len(), 88, "Must test exactly 88 standard functions");

    for (_name, formula, expected) in cases {
        let actual = engine.evaluate_formula(formula, &origin, None, None);
        assert_matches(&actual, expected);
    }
}

#[test]
fn test_all_88_edge_cases() {
    let mut engine = create_test_engine();
    let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 10 };

    let cases: Vec<(&str, &str, ExpectedValue)> = vec![
        ("SUM", "=SUM(A5:A6)", ExpectedValue::Num(0.0)),
        ("AVERAGE", "=AVERAGE(A5:A6)", ExpectedValue::Err(ErrorCode::Div0)),
        ("MIN", "=MIN(A5:A6)", ExpectedValue::Num(0.0)),
        ("MAX", "=MAX(A5:A6)", ExpectedValue::Num(0.0)),
        ("COUNT", "=COUNT(\"x\",TRUE,2)", ExpectedValue::Num(2.0)),
        ("COUNTA", "=COUNTA(\"\",FALSE,0)", ExpectedValue::Num(3.0)),
        ("COUNTIF", "=COUNTIF(B1:B3,\"N*\")", ExpectedValue::Num(2.0)),
        ("COUNTIFS", "=COUNTIFS(A1:A3,\">0\",B1:B2,\"North\")", ExpectedValue::Err(ErrorCode::Value)),
        ("SUMIF", "=SUMIF(B1:B3,\"Missing\",A1:A3)", ExpectedValue::Num(0.0)),
        ("SUMIFS", "=SUMIFS(A1:A3,B1:B2,\"North\")", ExpectedValue::Err(ErrorCode::Value)),
        ("AVERAGEIF", "=AVERAGEIF(B1:B3,\"Missing\",A1:A3)", ExpectedValue::Err(ErrorCode::Div0)),
        ("IF", "=IF(FALSE,1/0,9)", ExpectedValue::Num(9.0)),
        ("IFS", "=IFS(FALSE,1)", ExpectedValue::Err(ErrorCode::NA)),
        ("AND", "=AND(TRUE,#N/A)", ExpectedValue::Err(ErrorCode::NA)),
        ("OR", "=OR(FALSE,#N/A)", ExpectedValue::Err(ErrorCode::NA)),
        ("NOT", "=NOT(\"bad\")", ExpectedValue::Err(ErrorCode::Value)),
        ("IFERROR", "=IFERROR(9,1/0)", ExpectedValue::Num(9.0)),
        ("IFNA", "=IFNA(1/0,17)", ExpectedValue::Err(ErrorCode::Div0)),
        ("SWITCH", "=SWITCH(\"c\",\"a\",1,\"b\",2)", ExpectedValue::Err(ErrorCode::NA)),
        ("LET", "=LET(unused,1/0,x,2,x+3)", ExpectedValue::Num(5.0)),
        ("LAMBDA", "=LAMBDA(x,x+1)", ExpectedValue::Err(ErrorCode::Calc)),
        ("INDEX", "=INDEX(A1:A3,4)", ExpectedValue::Err(ErrorCode::Ref)),
        ("MATCH", "=MATCH(99,A1:A3,0)", ExpectedValue::Err(ErrorCode::NA)),
        ("XMATCH", "=XMATCH(\"Missing\",B1:B3)", ExpectedValue::Err(ErrorCode::NA)),
        ("XLOOKUP", "=XLOOKUP(99,A1:A3,C1:C3,\"missing\")", ExpectedValue::Str("missing")),
        ("VLOOKUP", "=VLOOKUP(20,A1:C3,4,FALSE)", ExpectedValue::Err(ErrorCode::Ref)),
        ("HLOOKUP", "=HLOOKUP(99,{10,20;100,200},2,FALSE)", ExpectedValue::Err(ErrorCode::NA)),
        ("FILTER", "=FILTER(A1:A3,A1:A3>99)", ExpectedValue::Err(ErrorCode::Calc)),
        ("SORT", "=SORT({1;3;2},1,-1)", ExpectedValue::Matrix(vec![vec![Scalar::number(3.0)], vec![Scalar::number(2.0)], vec![Scalar::number(1.0)]])),
        ("SORTBY", "=SORTBY({1;2;3},{1;2})", ExpectedValue::Err(ErrorCode::Value)),
        ("UNIQUE", "=UNIQUE({1;2;1;3},FALSE,TRUE)", ExpectedValue::Matrix(vec![vec![Scalar::number(2.0)], vec![Scalar::number(3.0)]])),
        ("SEQUENCE", "=SEQUENCE(0)", ExpectedValue::Err(ErrorCode::Calc)),
        ("TRANSPOSE", "=TRANSPOSE({1;2;3})", ExpectedValue::Matrix(vec![vec![Scalar::number(1.0), Scalar::number(2.0), Scalar::number(3.0)]])),
        ("TAKE", "=TAKE({1;2;3},0)", ExpectedValue::Err(ErrorCode::Calc)),
        ("DROP", "=DROP({1;2;3},3)", ExpectedValue::Err(ErrorCode::Calc)),
        ("CHOOSE", "=CHOOSE(0,1,2)", ExpectedValue::Err(ErrorCode::Value)),
        ("OFFSET", "=OFFSET(A1,-1,0)", ExpectedValue::Err(ErrorCode::Ref)),
        ("INDIRECT", "=INDIRECT(\"bad reference\")", ExpectedValue::Err(ErrorCode::Ref)),
        ("TEXT", "=TEXT(0,\"0.00\")", ExpectedValue::Str("0.00")),
        ("VALUE", "=VALUE(\"not a number\")", ExpectedValue::Err(ErrorCode::Value)),
        ("LEFT", "=LEFT(\"abc\",-1)", ExpectedValue::Err(ErrorCode::Value)),
        ("RIGHT", "=RIGHT(\"abc\",0)", ExpectedValue::Str("")),
        ("MID", "=MID(\"abc\",0,1)", ExpectedValue::Err(ErrorCode::Value)),
        ("LEN", "=LEN(\"\")", ExpectedValue::Num(0.0)),
        ("TRIM", "=TRIM(\"   \")", ExpectedValue::Str("")),
        ("SUBSTITUTE", "=SUBSTITUTE(\"abc\",\"x\",\"y\")", ExpectedValue::Str("abc")),
        ("REPLACE", "=REPLACE(\"abc\",1,0,\"x\")", ExpectedValue::Str("xabc")),
        ("CONCAT", "=CONCAT(\"a\",#N/A)", ExpectedValue::Err(ErrorCode::NA)),
        ("TEXTJOIN", "=TEXTJOIN(\"-\",FALSE,{\"a\",\"\",\"b\"})", ExpectedValue::Str("a--b")),
        ("FIND", "=FIND(\"x\",\"abc\")", ExpectedValue::Err(ErrorCode::Value)),
        ("SEARCH", "=SEARCH(\"x\",\"abc\")", ExpectedValue::Err(ErrorCode::Value)),
        ("UPPER", "=UPPER(\"\")", ExpectedValue::Str("")),
        ("LOWER", "=LOWER(123)", ExpectedValue::Str("123")),
        ("PROPER", "=PROPER(\"123HELLO\")", ExpectedValue::Str("123Hello")),
        ("ROUND", "=ROUND(125,-1)", ExpectedValue::Num(130.0)),
        ("ROUNDUP", "=ROUNDUP(121,-1)", ExpectedValue::Num(130.0)),
        ("ROUNDDOWN", "=ROUNDDOWN(129,-1)", ExpectedValue::Num(120.0)),
        ("INT", "=INT(0)", ExpectedValue::Num(0.0)),
        ("MOD", "=MOD(3,0)", ExpectedValue::Err(ErrorCode::Div0)),
        ("ABS", "=ABS(#N/A)", ExpectedValue::Err(ErrorCode::NA)),
        ("POWER", "=POWER(-1,0.5)", ExpectedValue::Err(ErrorCode::Num)),
        ("SQRT", "=SQRT(-1)", ExpectedValue::Err(ErrorCode::Num)),
        ("RAND", "=RAND(1)", ExpectedValue::Err(ErrorCode::Value)),
        ("RANDBETWEEN", "=RANDBETWEEN(5,1)", ExpectedValue::Err(ErrorCode::Num)),
        ("TODAY", "=TODAY(1)", ExpectedValue::Err(ErrorCode::Value)),
        ("NOW", "=NOW(1)", ExpectedValue::Err(ErrorCode::Value)),
        ("DATE", "=DATE(2024,13,1)", ExpectedValue::Num(45658.0)),
        ("YEAR", "=YEAR(60)", ExpectedValue::Num(1900.0)),
        ("MONTH", "=MONTH(60)", ExpectedValue::Num(2.0)),
        ("DAY", "=DAY(60)", ExpectedValue::Num(29.0)),
        ("EDATE", "=EDATE(DATE(2024,3,31),-1)", ExpectedValue::Num(45351.0)),
        ("EOMONTH", "=EOMONTH(DATE(2024,3,1),-1)", ExpectedValue::Num(45351.0)),
        ("NETWORKDAYS", "=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7),DATE(2024,1,1))", ExpectedValue::Num(4.0)),
        ("WORKDAY", "=WORKDAY(DATE(2024,1,8),-1)", ExpectedValue::Num(45296.0)),
        ("PMT", "=PMT(0,0,100)", ExpectedValue::Err(ErrorCode::Div0)),
        ("PV", "=PV(0,0,-10,20)", ExpectedValue::Num(-20.0)),
        ("FV", "=FV(0,0,-10,20)", ExpectedValue::Num(-20.0)),
        ("NPV", "=NPV(0,10,20)", ExpectedValue::Num(30.0)),
        ("IRR", "=IRR({1;2;3})", ExpectedValue::Err(ErrorCode::Num)),
        ("STDEV.S", "=STDEV.S(1)", ExpectedValue::Err(ErrorCode::Div0)),
        ("STDEV.P", "=STDEV.P(1)", ExpectedValue::Num(0.0)),
        ("VAR.S", "=VAR.S(1)", ExpectedValue::Err(ErrorCode::Div0)),
        ("VAR.P", "=VAR.P(1)", ExpectedValue::Num(0.0)),
        ("MEDIAN", "=MEDIAN(A5:A6)", ExpectedValue::Err(ErrorCode::Num)),
        ("LARGE", "=LARGE(A1:A3,4)", ExpectedValue::Err(ErrorCode::Num)),
        ("SMALL", "=SMALL(A1:A3,0)", ExpectedValue::Err(ErrorCode::Num)),
        ("RANK.EQ", "=RANK.EQ(20,{10;20;20;30})", ExpectedValue::Num(2.0)),
        ("SUBTOTAL", "=SUBTOTAL(999,A1:A3)", ExpectedValue::Err(ErrorCode::Value)),
    ];

    assert_eq!(cases.len(), 88, "Must test exactly 88 edge cases");

    for (_name, formula, expected) in cases {
        let actual = engine.evaluate_formula(formula, &origin, None, None);
        assert_matches(&actual, expected);
    }
}

#[test]
fn test_all_88_functions_registered() {
    let registry = FunctionRegistry::new();
    let names = registry.function_names();
    assert_eq!(names.len(), 88, "Registry must register all 88 standard functions");
}

#[test]
fn test_arity_rejection() {
    let mut engine = create_test_engine();
    let origin = CellAddress { sheet_id: "sheet1".to_string(), row: 0, col: 10 };
    let registry = FunctionRegistry::new();

    for name in registry.function_names() {
        let def = registry.get(name).unwrap();
        let invalid_formula = if def.min_args > 0 {
            format!("={}()", name)
        } else if let Some(max_a) = def.max_args {
            let args_str = vec!["1"; max_a + 1].join(",");
            format!("={}({})", name, args_str)
        } else {
            continue; // variadic zero-minimum functions have no arity violation
        };

        let actual = engine.evaluate_formula(&invalid_formula, &origin, None, None);
        assert_eq!(
            actual.error_code(),
            Some(ErrorCode::Value),
            "Function {} with formula {} did not reject out-of-contract arity with #VALUE!",
            name,
            invalid_formula
        );
    }
}
