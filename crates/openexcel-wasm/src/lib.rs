use wasm_bindgen::prelude::*;

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
