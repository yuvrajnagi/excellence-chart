use openexcel_core::{
    CellAddress, CellInput, CellRect, DefinedName, Sheet, SheetProperties,
    TableColumn, TableDefinition, Workbook, WorkbookProperties,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_date_system() -> String {
    "1900".to_string()
}

fn default_locale() -> String {
    "en-US".to_string()
}

fn default_row_height() -> f64 {
    20.0
}

fn default_col_width() -> f64 {
    80.0
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireWorkbookProperties {
    pub name: String,
    #[serde(alias = "dateSystem", alias = "date_system", default = "default_date_system")]
    pub date_system: String,
    #[serde(default = "default_locale")]
    pub locale: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireTableColumn {
    pub id: String,
    pub name: String,
    #[serde(alias = "calculatedFormula", alias = "calculated_formula", default)]
    pub calculated_formula: Option<String>,
    #[serde(alias = "totalsFormula", alias = "totals_formula", default)]
    pub totals_formula: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireTableDefinition {
    pub id: String,
    pub name: String,
    pub range: CellRect,
    #[serde(default)]
    pub columns: Vec<WireTableColumn>,
    #[serde(alias = "totalsRow", alias = "totals_row", default)]
    pub totals_row: bool,
    #[serde(alias = "styleId", alias = "style_id", default)]
    pub style_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireSheetProperties {
    pub name: String,
    #[serde(alias = "tabColor", alias = "tab_color", default)]
    pub tab_color: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(alias = "defaultRowHeight", alias = "default_row_height", default = "default_row_height")]
    pub default_row_height: f64,
    #[serde(alias = "defaultColumnWidth", alias = "default_column_width", default = "default_col_width")]
    pub default_column_width: f64,
    #[serde(default)]
    pub tables: Vec<WireTableDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireCell {
    pub input: CellInput,
    #[serde(alias = "styleId", alias = "style_id", default)]
    pub style_id: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireSheet {
    pub id: String,
    pub properties: WireSheetProperties,
    #[serde(default)]
    pub tiles: HashMap<String, HashMap<String, WireCell>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireDefinedName {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub scope: Option<String>,
    pub formula: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireWorkbook {
    pub id: String,
    #[serde(default)]
    pub revision: u64,
    pub properties: WireWorkbookProperties,
    #[serde(alias = "sheetOrder", alias = "sheet_order")]
    pub sheet_order: Vec<String>,
    #[serde(default)]
    pub sheets: HashMap<String, WireSheet>,
    #[serde(default)]
    pub names: Vec<WireDefinedName>,
}

impl WireWorkbook {
    pub fn into_workbook(self) -> Workbook {
        let sheets = self
            .sheets
            .into_iter()
            .map(|(k, s)| {
                let sheet = Sheet {
                    id: s.id,
                    properties: SheetProperties {
                        name: s.properties.name,
                        tab_color: s.properties.tab_color,
                        hidden: s.properties.hidden,
                        default_row_height: s.properties.default_row_height,
                        default_column_width: s.properties.default_column_width,
                        tables: s
                            .properties
                            .tables
                            .into_iter()
                            .map(|t| TableDefinition {
                                id: t.id,
                                name: t.name,
                                range: t.range,
                                columns: t
                                    .columns
                                    .into_iter()
                                    .map(|c| TableColumn {
                                        id: c.id,
                                        name: c.name,
                                        calculated_formula: c.calculated_formula,
                                        totals_formula: c.totals_formula,
                                    })
                                    .collect(),
                                totals_row: t.totals_row,
                                style_id: t.style_id,
                            })
                            .collect(),
                    },
                    tiles: s
                        .tiles
                        .into_iter()
                        .map(|(tk, t)| {
                            let tile = t
                                .into_iter()
                                .map(|(ck, c)| {
                                    (
                                        ck,
                                        openexcel_core::Cell {
                                            input: c.input,
                                            style_id: c.style_id,
                                            note: c.note,
                                        },
                                    )
                                })
                                .collect();
                            (tk, tile)
                        })
                        .collect(),
                };
                (k, sheet)
            })
            .collect();

        Workbook {
            id: self.id,
            revision: self.revision,
            properties: WorkbookProperties {
                name: self.properties.name,
                date_system: self.properties.date_system,
                locale: self.properties.locale,
            },
            sheet_order: self.sheet_order,
            sheets,
            names: self
                .names
                .into_iter()
                .map(|n| DefinedName {
                    id: n.id,
                    name: n.name,
                    scope: n.scope,
                    formula: n.formula,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireCellAddress {
    #[serde(alias = "sheetId", alias = "sheet_id")]
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
}

impl From<WireCellAddress> for CellAddress {
    fn from(w: WireCellAddress) -> Self {
        CellAddress {
            sheet_id: w.sheet_id,
            row: w.row,
            col: w.col,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WasmRecalcResult {
    #[serde(rename = "calculatedCount", alias = "calculated_count")]
    pub calculated_count: usize,
    pub errors: Vec<WasmRecalcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WasmRecalcError {
    #[serde(rename = "sheetId", alias = "sheet_id")]
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
    pub code: String,
    pub address: String,
}

pub fn create_default_workbook() -> Workbook {
    let sheet_id = "Sheet1".to_string();
    let mut sheets = HashMap::new();
    sheets.insert(
        sheet_id.clone(),
        Sheet {
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
        },
    );

    Workbook {
        id: "wb_default".to_string(),
        revision: 1,
        properties: WorkbookProperties {
            name: "Workbook1".to_string(),
            date_system: "1900".to_string(),
            locale: "en-US".to_string(),
        },
        sheet_order: vec![sheet_id],
        sheets,
        names: vec![],
    }
}

pub fn parse_workbook_json(json_str: &str) -> Result<Workbook, String> {
    if let Ok(wb) = serde_json::from_str::<Workbook>(json_str) {
        return Ok(wb);
    }
    match serde_json::from_str::<WireWorkbook>(json_str) {
        Ok(wire) => Ok(wire.into_workbook()),
        Err(err) => Err(format!("Failed to parse Workbook JSON: {err}")),
    }
}
