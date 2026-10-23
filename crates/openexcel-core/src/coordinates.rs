use crate::types::{CellAddress, RangeRef, GRID_COLUMNS, GRID_ROWS, TILE_COLUMNS, TILE_ROWS};

pub fn valid_position(row: u32, col: u32) -> bool {
    row < GRID_ROWS && col < GRID_COLUMNS
}

pub fn cell_key(row: u32, col: u32) -> Option<String> {
    if valid_position(row, col) {
        Some(format!("{}:{}", row, col))
    } else {
        None
    }
}

pub fn cell_key_to_coords(key: &str) -> Option<(u32, u32)> {
    let mut parts = key.split(':');
    let row = parts.next()?.parse::<u32>().ok()?;
    let col = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_none() && valid_position(row, col) {
        Some((row, col))
    } else {
        None
    }
}

pub fn tile_key(row: u32, col: u32) -> Option<String> {
    if valid_position(row, col) {
        Some(format!("{}:{}", row / TILE_ROWS, col / TILE_COLUMNS))
    } else {
        None
    }
}

pub fn tile_key_to_coords(key: &str) -> Option<(u32, u32)> {
    let mut parts = key.split(':');
    let t_row = parts.next()?.parse::<u32>().ok()?;
    let t_col = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_none() {
        Some((t_row, t_col))
    } else {
        None
    }
}

pub fn col_to_letters(mut col: u32) -> String {
    let mut letters = Vec::new();
    loop {
        letters.push(b'A' + (col % 26) as u8);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    letters.reverse();
    String::from_utf8(letters).unwrap_or_default()
}

pub fn letters_to_col(letters: &str) -> Option<u32> {
    if letters.is_empty() || letters.len() > 3 {
        return None;
    }
    let mut col: u32 = 0;
    for b in letters.bytes() {
        let val = match b {
            b'A'..=b'Z' => (b - b'A' + 1) as u32,
            b'a'..=b'z' => (b - b'a' + 1) as u32,
            _ => return None,
        };
        col = col.checked_mul(26)?.checked_add(val)?;
    }
    if col == 0 || col > GRID_COLUMNS {
        None
    } else {
        Some(col - 1)
    }
}

pub fn format_address(addr: &CellAddress) -> String {
    if !valid_position(addr.row, addr.col) {
        return "#REF!".to_string();
    }
    format!("{}{}", col_to_letters(addr.col), addr.row + 1)
}

pub fn parse_cell_reference(text: &str) -> Option<(Option<String>, u32, u32, bool, bool)> {
    let text = text.trim();
    let (sheet, cell_part) = if let Some(idx) = text.rfind('!') {
        let sheet_raw = &text[..idx];
        let sheet_name = if sheet_raw.starts_with('\'') && sheet_raw.ends_with('\'') && sheet_raw.len() >= 2 {
            &sheet_raw[1..sheet_raw.len() - 1]
        } else {
            sheet_raw
        };
        (Some(sheet_name.to_string()), &text[idx + 1..])
    } else {
        (None, text)
    };

    let cell_part = cell_part.trim();
    let abs_col = cell_part.starts_with('$');
    let rem = if abs_col { &cell_part[1..] } else { cell_part };

    let split_pos = rem.find(|c: char| c.is_ascii_digit())?;
    let col_str = &rem[..split_pos];
    let abs_row = col_str.ends_with('$');
    let col_str = if abs_row { &col_str[..col_str.len() - 1] } else { col_str };
    let row_str = &rem[split_pos..];

    let col = letters_to_col(col_str)?;
    let row = row_str.parse::<u32>().ok()?.checked_sub(1)?;

    if valid_position(row, col) {
        Some((sheet, row, col, abs_row, abs_col))
    } else {
        None
    }
}

pub fn parse_address(text: &str, default_sheet: &str) -> Option<CellAddress> {
    let (sheet, row, col, _, _) = parse_cell_reference(text)?;
    Some(CellAddress {
        sheet_id: sheet.unwrap_or_else(|| default_sheet.to_string()),
        row,
        col,
    })
}

pub fn parse_range(text: &str, default_sheet: &str) -> Option<RangeRef> {
    let text = text.trim();
    if let Some((start_str, end_str)) = text.split_once(':') {
        let start = parse_cell_reference(start_str)?;
        let end = parse_cell_reference(end_str)?;
        let sheet = start.0.or(end.0).unwrap_or_else(|| default_sheet.to_string());
        let top = start.1.min(end.1);
        let bottom = start.1.max(end.1);
        let left = start.2.min(end.2);
        let right = start.2.max(end.2);
        Some(RangeRef {
            sheet_id: sheet,
            top,
            bottom,
            left,
            right,
        })
    } else {
        let single = parse_cell_reference(text)?;
        let sheet = single.0.unwrap_or_else(|| default_sheet.to_string());
        Some(RangeRef {
            sheet_id: sheet,
            top: single.1,
            bottom: single.1,
            left: single.2,
            right: single.2,
        })
    }
}

pub fn format_range(range: &RangeRef) -> String {
    let top_left = format!("{}{}", col_to_letters(range.left), range.top + 1);
    let bottom_right = format!("{}{}", col_to_letters(range.right), range.bottom + 1);
    if range.top == range.bottom && range.left == range.right {
        format!("{}!{}", range.sheet_id, top_left)
    } else {
        format!("{}!{}:{}", range.sheet_id, top_left, bottom_right)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coordinates_bijective() {
        assert_eq!(col_to_letters(0), "A");
        assert_eq!(col_to_letters(25), "Z");
        assert_eq!(col_to_letters(26), "AA");
        assert_eq!(col_to_letters(16383), "XFD");

        assert_eq!(letters_to_col("A"), Some(0));
        assert_eq!(letters_to_col("Z"), Some(25));
        assert_eq!(letters_to_col("AA"), Some(26));
        assert_eq!(letters_to_col("XFD"), Some(16383));
    }

    #[test]
    fn test_parse_and_format_address() {
        let addr = parse_address("B10", "sheet1").unwrap();
        assert_eq!(addr.row, 9);
        assert_eq!(addr.col, 1);
        assert_eq!(format_address(&addr), "B10");

        let addr_abs = parse_address("$C$5", "sheet1").unwrap();
        assert_eq!(addr_abs.row, 4);
        assert_eq!(addr_abs.col, 2);

        let cross_sheet = parse_address("Sheet2!D12", "sheet1").unwrap();
        assert_eq!(cross_sheet.sheet_id, "Sheet2");
        assert_eq!(cross_sheet.row, 11);
        assert_eq!(cross_sheet.col, 3);
    }

    #[test]
    fn test_parse_range() {
        let r = parse_range("A1:B3", "sheet1").unwrap();
        assert_eq!(r.sheet_id, "sheet1");
        assert_eq!(r.top, 0);
        assert_eq!(r.bottom, 2);
        assert_eq!(r.left, 0);
        assert_eq!(r.right, 1);

        let r_quoted = parse_range("'My Sheet'!$C$5:E10", "sheet1").unwrap();
        assert_eq!(r_quoted.sheet_id, "My Sheet");
        assert_eq!(r_quoted.top, 4);
        assert_eq!(r_quoted.bottom, 9);
        assert_eq!(r_quoted.left, 2);
        assert_eq!(r_quoted.right, 4);
    }
}
