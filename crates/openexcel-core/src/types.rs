use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;
use std::fmt;

pub const GRID_ROWS: u32 = 1048576;
pub const GRID_COLUMNS: u32 = 16384;
pub const TILE_ROWS: u32 = 128;
pub const TILE_COLUMNS: u32 = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "#NULL!")]
    Null,
    #[serde(rename = "#DIV/0!")]
    Div0,
    #[serde(rename = "#VALUE!")]
    Value,
    #[serde(rename = "#REF!")]
    Ref,
    #[serde(rename = "#NAME?")]
    Name,
    #[serde(rename = "#NUM!")]
    Num,
    #[serde(rename = "#N/A")]
    NA,
    #[serde(rename = "#SPILL!")]
    Spill,
    #[serde(rename = "#CALC!")]
    Calc,
    #[serde(rename = "#CIRC!")]
    Circ,
    #[serde(rename = "#PARSE!")]
    Parse,
}

impl ErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorCode::Null => "#NULL!",
            ErrorCode::Div0 => "#DIV/0!",
            ErrorCode::Value => "#VALUE!",
            ErrorCode::Ref => "#REF!",
            ErrorCode::Name => "#NAME?",
            ErrorCode::Num => "#NUM!",
            ErrorCode::NA => "#N/A",
            ErrorCode::Spill => "#SPILL!",
            ErrorCode::Calc => "#CALC!",
            ErrorCode::Circ => "#CIRC!",
            ErrorCode::Parse => "#PARSE!",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "#NULL!" => Some(ErrorCode::Null),
            "#DIV/0!" => Some(ErrorCode::Div0),
            "#VALUE!" => Some(ErrorCode::Value),
            "#REF!" => Some(ErrorCode::Ref),
            "#NAME?" => Some(ErrorCode::Name),
            "#NUM!" => Some(ErrorCode::Num),
            "#N/A" => Some(ErrorCode::NA),
            "#SPILL!" => Some(ErrorCode::Spill),
            "#CALC!" => Some(ErrorCode::Calc),
            "#CIRC!" => Some(ErrorCode::Circ),
            "#PARSE!" => Some(ErrorCode::Parse),
            _ => None,
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Scalar {
    Null,
    Number { value: f64 },
    String { value: String },
    Boolean { value: bool },
    Error { code: ErrorCode, message: Option<String> },
}

impl Scalar {
    pub fn null() -> Self {
        Scalar::Null
    }

    pub fn number(n: f64) -> Self {
        Scalar::Number { value: n }
    }

    pub fn string(s: impl Into<String>) -> Self {
        Scalar::String { value: s.into() }
    }

    pub fn boolean(b: bool) -> Self {
        Scalar::Boolean { value: b }
    }

    pub fn error(code: ErrorCode) -> Self {
        Scalar::Error { code, message: None }
    }

    pub fn is_error(&self) -> bool {
        matches!(self, Scalar::Error { .. })
    }

    pub fn error_code(&self) -> Option<ErrorCode> {
        match self {
            Scalar::Error { code, .. } => Some(*code),
            _ => None,
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Scalar::Null)
    }

    pub fn as_f64(&self) -> Result<f64, ErrorCode> {
        match self {
            Scalar::Number { value } => Ok(*value),
            Scalar::Boolean { value } => Ok(if *value { 1.0 } else { 0.0 }),
            Scalar::Null => Ok(0.0),
            Scalar::String { value } => {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    Ok(0.0)
                } else if let Ok(n) = trimmed.parse::<f64>() {
                    if n.is_finite() {
                        Ok(n)
                    } else {
                        Err(ErrorCode::Num)
                    }
                } else {
                    Err(ErrorCode::Value)
                }
            }
            Scalar::Error { code, .. } => Err(*code),
        }
    }

    pub fn as_string(&self) -> Result<String, ErrorCode> {
        match self {
            Scalar::String { value } => Ok(value.clone()),
            Scalar::Number { value } => {
                if value.fract() == 0.0 && *value >= (i64::MIN as f64) && *value <= (i64::MAX as f64) {
                    Ok(format!("{}", *value as i64))
                } else {
                    Ok(format!("{}", value))
                }
            }
            Scalar::Boolean { value } => Ok(if *value { "TRUE".to_string() } else { "FALSE".to_string() }),
            Scalar::Null => Ok(String::new()),
            Scalar::Error { code, .. } => Err(*code),
        }
    }

    pub fn as_bool(&self) -> Result<bool, ErrorCode> {
        match self {
            Scalar::Boolean { value } => Ok(*value),
            Scalar::Number { value } => Ok(*value != 0.0),
            Scalar::Null => Ok(false),
            Scalar::String { value } => {
                let lower = value.trim().to_lowercase();
                if lower == "true" {
                    Ok(true)
                } else if lower == "false" {
                    Ok(false)
                } else if let Ok(n) = lower.parse::<f64>() {
                    Ok(n != 0.0)
                } else {
                    Err(ErrorCode::Value)
                }
            }
            Scalar::Error { code, .. } => Err(*code),
        }
    }

    pub fn to_string_lossy(&self) -> String {
        match self {
            Scalar::Null => String::new(),
            Scalar::Number { value } => {
                if value.fract() == 0.0 && *value >= (i64::MIN as f64) && *value <= (i64::MAX as f64) {
                    format!("{}", *value as i64)
                } else {
                    format!("{}", value)
                }
            }
            Scalar::String { value } => value.clone(),
            Scalar::Boolean { value } => if *value { "TRUE".to_string() } else { "FALSE".to_string() },
            Scalar::Error { code, .. } => code.as_str().to_string(),
        }
    }
}

impl Serialize for Scalar {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(tag = "kind")]
        enum TaggedError<'a> {
            #[serde(rename = "error")]
            Error { code: ErrorCode, message: Option<&'a String> },
        }

        match self {
            Scalar::Null => serializer.serialize_none(),
            Scalar::Number { value } => serializer.serialize_f64(*value),
            Scalar::String { value } => serializer.serialize_str(value),
            Scalar::Boolean { value } => serializer.serialize_bool(*value),
            Scalar::Error { code, message } => {
                TaggedError::Error { code: *code, message: message.as_ref() }.serialize(serializer)
            }
        }
    }
}

impl<'de> Deserialize<'de> for Scalar {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let val = serde_json::Value::deserialize(deserializer)?;
        match val {
            serde_json::Value::Null => Ok(Scalar::Null),
            serde_json::Value::Bool(b) => Ok(Scalar::Boolean { value: b }),
            serde_json::Value::Number(num) => {
                let n = num.as_f64().unwrap_or(0.0);
                Ok(Scalar::Number { value: n })
            }
            serde_json::Value::String(s) => Ok(Scalar::String { value: s }),
            serde_json::Value::Object(map) => {
                if let Some(kind) = map.get("kind").and_then(|k| k.as_str()) {
                    match kind {
                        "null" => Ok(Scalar::Null),
                        "number" => {
                            let n = map.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                            Ok(Scalar::Number { value: n })
                        }
                        "string" => {
                            let s = map.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            Ok(Scalar::String { value: s })
                        }
                        "boolean" => {
                            let b = map.get("value").and_then(|v| v.as_bool()).unwrap_or(false);
                            Ok(Scalar::Boolean { value: b })
                        }
                        "error" => {
                            let code_str = map.get("code").and_then(|c| c.as_str()).unwrap_or("#VALUE!");
                            let code = ErrorCode::from_str_opt(code_str).unwrap_or(ErrorCode::Value);
                            let msg = map.get("message").and_then(|m| m.as_str()).map(|s| s.to_string());
                            Ok(Scalar::Error { code, message: msg })
                        }
                        _ => Err(serde::de::Error::custom(format!("Unknown scalar kind: {}", kind))),
                    }
                } else if let Some(code_val) = map.get("code").and_then(|c| c.as_str()) {
                    let code = ErrorCode::from_str_opt(code_val).unwrap_or(ErrorCode::Value);
                    let msg = map.get("message").and_then(|m| m.as_str()).map(|s| s.to_string());
                    Ok(Scalar::Error { code, message: msg })
                } else {
                    Err(serde::de::Error::custom("Invalid object structure for Scalar"))
                }
            }
            _ => Err(serde::de::Error::custom("Unsupported JSON type for Scalar")),
        }
    }
}

impl From<f64> for Scalar {
    fn from(v: f64) -> Self {
        Scalar::Number { value: v }
    }
}

impl From<i64> for Scalar {
    fn from(v: i64) -> Self {
        Scalar::Number { value: v as f64 }
    }
}

impl From<i32> for Scalar {
    fn from(v: i32) -> Self {
        Scalar::Number { value: v as f64 }
    }
}

impl From<&str> for Scalar {
    fn from(s: &str) -> Self {
        Scalar::String { value: s.to_string() }
    }
}

impl From<String> for Scalar {
    fn from(s: String) -> Self {
        Scalar::String { value: s }
    }
}

impl From<bool> for Scalar {
    fn from(b: bool) -> Self {
        Scalar::Boolean { value: b }
    }
}

impl From<ErrorCode> for Scalar {
    fn from(c: ErrorCode) -> Self {
        Scalar::Error { code: c, message: None }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrayValue {
    pub rows: usize,
    pub cols: usize,
    pub values: Vec<Scalar>,
}

impl ArrayValue {
    pub fn new(rows: usize, cols: usize, values: Vec<Scalar>) -> Result<Self, ErrorCode> {
        if rows < 1 || cols < 1 || rows.checked_mul(cols).is_none_or(|total| total > 1_000_000) {
            return Err(ErrorCode::Calc);
        }
        if values.len() != rows * cols {
            return Err(ErrorCode::Value);
        }
        Ok(Self { rows, cols, values })
    }

    pub fn from_scalar(scalar: Scalar) -> Self {
        Self {
            rows: 1,
            cols: 1,
            values: vec![scalar],
        }
    }

    pub fn get(&self, row: usize, col: usize) -> Option<&Scalar> {
        if row < self.rows && col < self.cols {
            self.values.get(row * self.cols + col)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ComputedValue {
    Array {
        kind: String, // "array"
        rows: usize,
        cols: usize,
        values: Vec<Scalar>,
    },
    Scalar(Scalar),
    #[serde(skip)]
    Lambda {
        params: Vec<String>,
        body: Box<crate::ast::AstNode>,
        env: HashMap<String, ComputedValue>,
    },
}

impl ComputedValue {
    pub fn null() -> Self {
        ComputedValue::Scalar(Scalar::Null)
    }

    pub fn number(n: f64) -> Self {
        ComputedValue::Scalar(Scalar::Number { value: n })
    }

    pub fn string(s: impl Into<String>) -> Self {
        ComputedValue::Scalar(Scalar::String { value: s.into() })
    }

    pub fn boolean(b: bool) -> Self {
        ComputedValue::Scalar(Scalar::Boolean { value: b })
    }

    pub fn error(code: ErrorCode) -> Self {
        ComputedValue::Scalar(Scalar::Error { code, message: None })
    }

    pub fn array(rows: usize, cols: usize, values: Vec<Scalar>) -> Result<Self, ErrorCode> {
        if rows < 1 || cols < 1 || rows.checked_mul(cols).is_none_or(|t| t > 1_000_000) {
            return Err(ErrorCode::Calc);
        }
        if values.len() != rows * cols {
            return Err(ErrorCode::Value);
        }
        Ok(ComputedValue::Array {
            kind: "array".to_string(),
            rows,
            cols,
            values,
        })
    }

    pub fn is_array(&self) -> bool {
        matches!(self, ComputedValue::Array { .. })
    }

    pub fn is_lambda(&self) -> bool {
        matches!(self, ComputedValue::Lambda { .. })
    }

    pub fn is_error(&self) -> bool {
        match self {
            ComputedValue::Scalar(s) => s.is_error(),
            ComputedValue::Array { values, .. } => values.iter().any(|v| v.is_error()),
            ComputedValue::Lambda { .. } => false,
        }
    }

    pub fn error_code(&self) -> Option<ErrorCode> {
        match self {
            ComputedValue::Scalar(s) => s.error_code(),
            ComputedValue::Array { values, .. } => values.iter().find_map(|v| v.error_code()),
            ComputedValue::Lambda { .. } => Some(ErrorCode::Calc),
        }
    }

    pub fn to_scalar(&self) -> Scalar {
        match self {
            ComputedValue::Scalar(s) => s.clone(),
            ComputedValue::Array { values, .. } => values.first().cloned().unwrap_or(Scalar::Null),
            ComputedValue::Lambda { .. } => Scalar::error(ErrorCode::Calc),
        }
    }

    pub fn to_array_value(&self) -> ArrayValue {
        match self {
            ComputedValue::Scalar(s) => ArrayValue::from_scalar(s.clone()),
            ComputedValue::Array { rows, cols, values, .. } => ArrayValue {
                rows: *rows,
                cols: *cols,
                values: values.clone(),
            },
            ComputedValue::Lambda { .. } => ArrayValue::from_scalar(Scalar::error(ErrorCode::Calc)),
        }
    }

    pub fn flat_scalars(&self) -> Vec<Scalar> {
        match self {
            ComputedValue::Scalar(s) => vec![s.clone()],
            ComputedValue::Array { values, .. } => values.clone(),
            ComputedValue::Lambda { .. } => vec![Scalar::error(ErrorCode::Calc)],
        }
    }
}

impl From<Scalar> for ComputedValue {
    fn from(s: Scalar) -> Self {
        ComputedValue::Scalar(s)
    }
}

impl From<ArrayValue> for ComputedValue {
    fn from(arr: ArrayValue) -> Self {
        ComputedValue::Array {
            kind: "array".to_string(),
            rows: arr.rows,
            cols: arr.cols,
            values: arr.values,
        }
    }
}

impl From<f64> for ComputedValue {
    fn from(v: f64) -> Self {
        ComputedValue::Scalar(Scalar::Number { value: v })
    }
}

impl From<i32> for ComputedValue {
    fn from(v: i32) -> Self {
        ComputedValue::Scalar(Scalar::Number { value: v as f64 })
    }
}

impl From<i64> for ComputedValue {
    fn from(v: i64) -> Self {
        ComputedValue::Scalar(Scalar::Number { value: v as f64 })
    }
}

impl From<&str> for ComputedValue {
    fn from(s: &str) -> Self {
        ComputedValue::Scalar(Scalar::String { value: s.to_string() })
    }
}

impl From<String> for ComputedValue {
    fn from(s: String) -> Self {
        ComputedValue::Scalar(Scalar::String { value: s })
    }
}

impl From<bool> for ComputedValue {
    fn from(b: bool) -> Self {
        ComputedValue::Scalar(Scalar::Boolean { value: b })
    }
}

impl From<ErrorCode> for ComputedValue {
    fn from(c: ErrorCode) -> Self {
        ComputedValue::Scalar(Scalar::Error { code: c, message: None })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CellAddress {
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CellRect {
    pub top: u32,
    pub left: u32,
    pub bottom: u32,
    pub right: u32,
}

impl CellRect {
    pub fn contains(&self, row: u32, col: u32) -> bool {
        row >= self.top && row <= self.bottom && col >= self.left && col <= self.right
    }

    pub fn intersects(&self, other: &CellRect) -> bool {
        self.left <= other.right && self.right >= other.left && self.top <= other.bottom && self.bottom >= other.top
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RangeRef {
    pub sheet_id: String,
    pub top: u32,
    pub left: u32,
    pub bottom: u32,
    pub right: u32,
}

impl RangeRef {
    pub fn contains(&self, sheet_id: &str, row: u32, col: u32) -> bool {
        self.sheet_id == sheet_id && row >= self.top && row <= self.bottom && col >= self.left && col <= self.right
    }

    pub fn to_rect(&self) -> CellRect {
        CellRect {
            top: self.top,
            left: self.left,
            bottom: self.bottom,
            right: self.right,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum CellInput {
    #[serde(rename = "value")]
    Value { value: Scalar },
    #[serde(rename = "formula")]
    Formula { source: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cell {
    pub input: CellInput,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl Cell {
    pub fn value(val: impl Into<Scalar>) -> Self {
        Self {
            input: CellInput::Value { value: val.into() },
            style_id: None,
            note: None,
        }
    }

    pub fn formula(source: impl Into<String>) -> Self {
        Self {
            input: CellInput::Formula { source: source.into() },
            style_id: None,
            note: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableColumn {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculated_formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_formula: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableDefinition {
    pub id: String,
    pub name: String,
    pub range: CellRect,
    pub columns: Vec<TableColumn>,
    #[serde(default)]
    pub totals_row: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DefinedName {
    pub id: String,
    pub name: String,
    pub scope: Option<String>,
    pub formula: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetProperties {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_color: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default = "default_row_height")]
    pub default_row_height: f64,
    #[serde(default = "default_col_width")]
    pub default_column_width: f64,
    #[serde(default)]
    pub tables: Vec<TableDefinition>,
}

fn default_row_height() -> f64 { 20.0 }
fn default_col_width() -> f64 { 80.0 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetView {
    #[serde(default)]
    pub freeze_rows: u32,
    #[serde(default)]
    pub freeze_columns: u32,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
    #[serde(default)]
    pub gridlines: bool,
}

fn default_zoom() -> f64 { 1.0 }

impl Default for SheetView {
    fn default() -> Self {
        Self {
            freeze_rows: 0,
            freeze_columns: 0,
            zoom: 1.0,
            gridlines: true,
        }
    }
}

pub type TileStore = HashMap<String, HashMap<String, Cell>>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sheet {
    pub id: String,
    pub properties: SheetProperties,
    #[serde(default)]
    pub tiles: TileStore,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkbookProperties {
    pub name: String,
    #[serde(default = "default_date_system")]
    pub date_system: String, // "1900" or "1904"
    #[serde(default = "default_locale")]
    pub locale: String,
}

fn default_date_system() -> String { "1900".to_string() }
fn default_locale() -> String { "en-US".to_string() }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Workbook {
    pub id: String,
    pub revision: u64,
    pub properties: WorkbookProperties,
    pub sheet_order: Vec<String>,
    pub sheets: HashMap<String, Sheet>,
    #[serde(default)]
    pub names: Vec<DefinedName>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub max_sheets: usize,
    pub max_authored_cells: usize,
    pub max_formula_length: usize,
    pub max_ast_depth: usize,
    pub max_array_cells: usize,
    pub max_evaluation_steps: usize,
    pub max_calculation_ms: u64,
    pub max_lambda_depth: usize,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_sheets: 256,
            max_authored_cells: 2_000_000,
            max_formula_length: 32_768,
            max_ast_depth: 1024,
            max_array_cells: 1_000_000,
            max_evaluation_steps: 50_000_000,
            max_calculation_ms: 30_000,
            max_lambda_depth: 256,
        }
    }
}
