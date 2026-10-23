pub mod types;

use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

use openexcel_core::engine::Engine;
use openexcel_core::types::{Cell, CellAddress, ComputedValue, Scalar};
use types::{
    create_default_workbook, parse_workbook_json, WasmRecalcError, WasmRecalcResult,
    WireCellAddress,
};

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn openexcel_version() -> String {
    "0.1.0".to_string()
}

#[wasm_bindgen]
pub fn format_address(row: u32, col: u32) -> String {
    openexcel_core::col_to_letters(col) + &(row + 1).to_string()
}

fn to_js_error(msg: impl std::fmt::Display) -> JsValue {
    #[cfg(target_arch = "wasm32")]
    {
        JsValue::from_str(&msg.to_string())
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = msg;
        JsValue::NULL
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(untagged)]
enum FlexibleAddress {
    Structured(WireCellAddress),
    Key(String),
}

impl FlexibleAddress {
    fn into_cell_address(self) -> Option<CellAddress> {
        match self {
            FlexibleAddress::Structured(w) => Some(w.into()),
            FlexibleAddress::Key(key) => {
                // Key format: "sheet_id/row:col"
                let slash_idx = key.find('/')?;
                let colon_idx = key[slash_idx + 1..].find(':')? + slash_idx + 1;
                let sheet_id = key[..slash_idx].to_string();
                let row = key[slash_idx + 1..colon_idx].parse::<u32>().ok()?;
                let col = key[colon_idx + 1..].parse::<u32>().ok()?;
                Some(CellAddress { sheet_id, row, col })
            }
        }
    }
}

#[wasm_bindgen]
pub struct WasmEngine {
    engine: RefCell<Engine>,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmEngine {
        let wb = create_default_workbook();
        WasmEngine {
            engine: RefCell::new(Engine::new(&wb)),
        }
    }

    #[wasm_bindgen(js_name = fromJson)]
    pub fn from_json(json_str: &str) -> Result<WasmEngine, JsValue> {
        let mut engine = WasmEngine::new();
        engine.update_workbook(json_str)?;
        Ok(engine)
    }

    #[wasm_bindgen]
    pub fn update_workbook(&mut self, json_str: &str) -> Result<(), JsValue> {
        let wb = parse_workbook_json(json_str).map_err(|e| to_js_error(e))?;
        let (now_ms, random_seed) = {
            let cur = self.engine.borrow();
            (cur.now_ms, cur.random_seed)
        };
        let mut new_engine = Engine::new(&wb);
        new_engine.set_clock(now_ms);
        new_engine.set_seed(random_seed);
        *self.engine.borrow_mut() = new_engine;
        Ok(())
    }

    #[wasm_bindgen(js_name = updateWorkbook)]
    pub fn update_workbook_camel(&mut self, json_str: &str) -> Result<(), JsValue> {
        self.update_workbook(json_str)
    }

    #[wasm_bindgen]
    pub fn recalculate(&mut self) -> Result<JsValue, JsValue> {
        let wasm_res = self.recalculate_core();
        #[cfg(target_arch = "wasm32")]
        {
            serde_wasm_bindgen::to_value(&wasm_res)
                .map_err(|e| to_js_error(format!("Failed to serialize recalculate result: {e}")))
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = wasm_res;
            Ok(JsValue::NULL)
        }
    }

    #[wasm_bindgen(js_name = recalculateJson)]
    pub fn recalculate_json(&mut self) -> Result<String, JsValue> {
        let wasm_res = self.recalculate_core();
        serde_json::to_string(&wasm_res)
            .map_err(|e| to_js_error(format!("Failed to serialize recalculate result: {e}")))
    }

    #[wasm_bindgen]
    pub fn get_computed_values(&self, addresses_json: &str) -> Result<String, JsValue> {
        let addresses: Vec<CellAddress> = match serde_json::from_str::<Vec<FlexibleAddress>>(addresses_json) {
            Ok(items) => items.into_iter().filter_map(|it| it.into_cell_address()).collect(),
            Err(err) => return Err(to_js_error(format!("Invalid addresses JSON: {err}"))),
        };

        let map = self.get_computed_values_core(&addresses);
        serde_json::to_string(&map)
            .map_err(|e| to_js_error(format!("Failed to serialize computed values: {e}")))
    }

    #[wasm_bindgen(js_name = getComputedValues)]
    pub fn get_computed_values_camel(&self, addresses_json: &str) -> Result<String, JsValue> {
        self.get_computed_values(addresses_json)
    }

    #[wasm_bindgen(js_name = evaluateAddresses)]
    pub fn evaluate_addresses_camel(&self, addresses_json: &str) -> Result<String, JsValue> {
        self.get_computed_values(addresses_json)
    }

    #[wasm_bindgen]
    pub fn evaluate_formula(
        &mut self,
        sheet_id: &str,
        row: u32,
        col: u32,
        formula: &str,
    ) -> Result<String, JsValue> {
        let origin = CellAddress {
            sheet_id: sheet_id.to_string(),
            row,
            col,
        };
        let val = self.engine.borrow_mut().evaluate_formula(formula, &origin, None, None);
        serde_json::to_string(&val)
            .map_err(|e| to_js_error(format!("Failed to serialize formula result: {e}")))
    }

    #[wasm_bindgen(js_name = evaluateFormula)]
    pub fn evaluate_formula_camel(
        &mut self,
        sheet_id: &str,
        row: u32,
        col: u32,
        formula: &str,
    ) -> Result<String, JsValue> {
        self.evaluate_formula(sheet_id, row, col, formula)
    }

    #[wasm_bindgen]
    pub fn set_cell_value(
        &mut self,
        sheet_id: &str,
        row: u32,
        col: u32,
        val_json: &str,
    ) -> Result<(), JsValue> {
        let scalar: Scalar = serde_json::from_str(val_json)
            .map_err(|e| to_js_error(format!("Failed to parse scalar: {e}")))?;
        self.engine.borrow_mut().set_cell(sheet_id, row, col, Cell::value(scalar));
        Ok(())
    }

    #[wasm_bindgen]
    pub fn set_cell_formula(
        &mut self,
        sheet_id: &str,
        row: u32,
        col: u32,
        formula: &str,
    ) -> Result<(), JsValue> {
        self.engine.borrow_mut().set_cell(sheet_id, row, col, Cell::formula(formula));
        Ok(())
    }

    #[wasm_bindgen]
    pub fn get_value(
        &self,
        sheet_id: &str,
        row: u32,
        col: u32,
    ) -> Result<String, JsValue> {
        let addr = CellAddress {
            sheet_id: sheet_id.to_string(),
            row,
            col,
        };
        let val = self.engine.borrow_mut().get_computed_value(&addr);
        serde_json::to_string(&val)
            .map_err(|e| to_js_error(format!("Failed to serialize value: {e}")))
    }
}

impl WasmEngine {
    pub fn recalculate_core(&mut self) -> WasmRecalcResult {
        let recalc_res = self.engine.borrow_mut().recalculate();
        WasmRecalcResult {
            calculated_count: recalc_res.calculated_count,
            errors: recalc_res
                .errors
                .into_iter()
                .map(|(addr, err)| WasmRecalcError {
                    sheet_id: addr.sheet_id.clone(),
                    row: addr.row,
                    col: addr.col,
                    code: err.as_str().to_string(),
                    address: format!("{}/{}:{}", addr.sheet_id, addr.row, addr.col),
                })
                .collect(),
        }
    }

    pub fn get_computed_values_core(&self, addresses: &[CellAddress]) -> HashMap<String, ComputedValue> {
        let mut engine = self.engine.borrow_mut();
        let mut map = HashMap::new();
        for addr in addresses {
            let key = format!("{}/{}:{}", addr.sheet_id, addr.row, addr.col);
            let val = engine.get_computed_value(addr);
            map.insert(key, val);
        }
        map
    }

    pub fn set_clock(&mut self, now_ms: i64) {
        self.engine.borrow_mut().set_clock(now_ms);
    }

    pub fn set_seed(&mut self, seed: u64) {
        self.engine.borrow_mut().set_seed(seed);
    }
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}
