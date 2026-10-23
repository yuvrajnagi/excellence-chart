use std::collections::{HashMap, HashSet};
use crate::types::{ComputedValue, ErrorCode, Scalar};
use super::criteria::compare_scalars;

pub fn filter(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let arr = args[0].to_array_value();
    let include = args[1].flat_scalars();

    if include.len() != arr.rows {
        return Err(ErrorCode::Value);
    }

    let mut matched_rows = Vec::new();
    for (r, inc) in include.iter().enumerate().take(arr.rows) {
        if let Ok(b) = inc.as_bool() {
            if b {
                matched_rows.push(r);
            }
        }
    }

    if matched_rows.is_empty() {
        if let Some(if_empty) = args.get(2) {
            return Ok(if_empty.clone());
        } else {
            return Err(ErrorCode::Calc);
        }
    }

    let mut out_values = Vec::with_capacity(matched_rows.len() * arr.cols);
    for r in &matched_rows {
        for c in 0..arr.cols {
            out_values.push(arr.values[r * arr.cols + c].clone());
        }
    }

    ComputedValue::array(matched_rows.len(), arr.cols, out_values)
}

pub fn transpose(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let arr = args[0].to_array_value();
    let mut out_values = vec![Scalar::Null; arr.rows * arr.cols];
    for r in 0..arr.rows {
        for c in 0..arr.cols {
            out_values[c * arr.rows + r] = arr.values[r * arr.cols + c].clone();
        }
    }
    ComputedValue::array(arr.cols, arr.rows, out_values)
}

pub fn sort(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let arr = args[0].to_array_value();
    let sort_index = if args.len() >= 2 {
        args[1].to_scalar().as_f64()?.trunc() as i64
    } else {
        1
    };
    let sort_order = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?.trunc() as i64
    } else {
        1
    };
    let by_col = if args.len() >= 4 {
        args[3].to_scalar().as_bool().unwrap_or(false)
    } else {
        false
    };

    if ![-1, 1].contains(&sort_order) {
        return Err(ErrorCode::Value);
    }

    if by_col {
        // Transpose, sort rows, transpose back
        let transposed = transpose(&[ComputedValue::Array {
            kind: "array".to_string(),
            rows: arr.rows,
            cols: arr.cols,
            values: arr.values,
        }])?;
        let sorted = sort(&[
            transposed,
            ComputedValue::number(sort_index as f64),
            ComputedValue::number(sort_order as f64),
            ComputedValue::boolean(false),
        ])?;
        return transpose(&[sorted]);
    }

    let col_idx = sort_index - 1;
    if col_idx < 0 || col_idx as usize >= arr.cols {
        return Err(ErrorCode::Value);
    }

    let mut row_indices: Vec<usize> = (0..arr.rows).collect();
    row_indices.sort_by(|&r1, &r2| {
        let v1 = &arr.values[r1 * arr.cols + col_idx as usize];
        let v2 = &arr.values[r2 * arr.cols + col_idx as usize];
        let ord = compare_scalars(v1, v2);
        if sort_order == -1 {
            ord.reverse()
        } else {
            ord
        }
    });

    let mut out_values = Vec::with_capacity(arr.rows * arr.cols);
    for r in row_indices {
        for c in 0..arr.cols {
            out_values.push(arr.values[r * arr.cols + c].clone());
        }
    }

    ComputedValue::array(arr.rows, arr.cols, out_values)
}

pub fn sortby(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let arr = args[0].to_array_value();

    struct SortSpec {
        keys: Vec<Scalar>,
        order: i64,
    }

    let mut specs = Vec::new();
    let mut i = 1;
    while i < args.len() {
        let keys = args[i].flat_scalars();
        if keys.len() != arr.rows {
            return Err(ErrorCode::Value);
        }
        let order = if i + 1 < args.len() {
            args[i + 1].to_scalar().as_f64()?.trunc() as i64
        } else {
            1
        };
        if ![-1, 1].contains(&order) {
            return Err(ErrorCode::Value);
        }
        specs.push(SortSpec { keys, order });
        i += 2;
    }

    let mut row_indices: Vec<usize> = (0..arr.rows).collect();
    row_indices.sort_by(|&r1, &r2| {
        for spec in &specs {
            let ord = compare_scalars(&spec.keys[r1], &spec.keys[r2]);
            if ord != std::cmp::Ordering::Equal {
                return if spec.order == -1 { ord.reverse() } else { ord };
            }
        }
        std::cmp::Ordering::Equal
    });

    let mut out_values = Vec::with_capacity(arr.rows * arr.cols);
    for r in row_indices {
        for c in 0..arr.cols {
            out_values.push(arr.values[r * arr.cols + c].clone());
        }
    }

    ComputedValue::array(arr.rows, arr.cols, out_values)
}

pub fn unique(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let arr = args[0].to_array_value();
    let by_col = if args.len() >= 2 {
        args[1].to_scalar().as_bool().unwrap_or(false)
    } else {
        false
    };
    let exactly_once = if args.len() >= 3 {
        args[2].to_scalar().as_bool().unwrap_or(false)
    } else {
        false
    };

    if by_col {
        let transposed = transpose(&[ComputedValue::Array {
            kind: "array".to_string(),
            rows: arr.rows,
            cols: arr.cols,
            values: arr.values,
        }])?;
        let res = unique(&[
            transposed,
            ComputedValue::boolean(false),
            ComputedValue::boolean(exactly_once),
        ])?;
        return transpose(&[res]);
    }

    // Row-based unique
    let mut row_keys = Vec::with_capacity(arr.rows);
    let mut counts: HashMap<String, usize> = HashMap::new();

    for r in 0..arr.rows {
        let row_slice = &arr.values[r * arr.cols..(r + 1) * arr.cols];
        let key = row_slice
            .iter()
            .map(|s| s.to_string_lossy().to_lowercase())
            .collect::<Vec<_>>()
            .join("\x1f");
        *counts.entry(key.clone()).or_default() += 1;
        row_keys.push((r, key));
    }

    let mut seen = HashSet::new();
    let mut selected_rows = Vec::new();

    for (r, key) in row_keys {
        if exactly_once {
            if counts.get(&key) == Some(&1) {
                selected_rows.push(r);
            }
        } else if !seen.contains(&key) {
            seen.insert(key);
            selected_rows.push(r);
        }
    }

    if selected_rows.is_empty() {
        return Err(ErrorCode::Calc);
    }

    let mut out_values = Vec::with_capacity(selected_rows.len() * arr.cols);
    for r in selected_rows.iter() {
        for c in 0..arr.cols {
            out_values.push(arr.values[r * arr.cols + c].clone());
        }
    }

    ComputedValue::array(selected_rows.len(), arr.cols, out_values)
}

pub fn sequence(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let rows_f = args[0].to_scalar().as_f64()?;
    let cols_f = if args.len() >= 2 {
        args[1].to_scalar().as_f64()?
    } else {
        1.0
    };
    let start = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?
    } else {
        1.0
    };
    let step = if args.len() >= 4 {
        args[3].to_scalar().as_f64()?
    } else {
        1.0
    };

    if rows_f.fract() != 0.0 || cols_f.fract() != 0.0 {
        return Err(ErrorCode::Calc);
    }

    let rows = rows_f as i64;
    let cols = cols_f as i64;

    if rows < 1 || cols < 1 || (rows as usize).checked_mul(cols as usize).is_none_or(|t| t > 1_000_000) {
        return Err(ErrorCode::Calc);
    }

    let total = (rows * cols) as usize;
    let mut values = Vec::with_capacity(total);
    for i in 0..total {
        values.push(Scalar::number(start + (i as f64) * step));
    }

    ComputedValue::array(rows as usize, cols as usize, values)
}

pub fn take(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let arr = args[0].to_array_value();
    let rows_arg = args[1].to_scalar().as_f64()?.trunc() as i64;
    let cols_arg = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?.trunc() as i64
    } else {
        arr.cols as i64
    };

    if rows_arg == 0 || cols_arg == 0 {
        return Err(ErrorCode::Calc);
    }

    let select_indices = |total: usize, count: i64| -> Vec<usize> {
        let abs_c = count.unsigned_abs() as usize;
        let c = abs_c.min(total);
        if count > 0 {
            (0..c).collect()
        } else {
            (total - c..total).collect()
        }
    };

    let r_indices = select_indices(arr.rows, rows_arg);
    let c_indices = select_indices(arr.cols, cols_arg);

    if r_indices.is_empty() || c_indices.is_empty() {
        return Err(ErrorCode::Calc);
    }

    let mut out_values = Vec::with_capacity(r_indices.len() * c_indices.len());
    for &r in &r_indices {
        for &c in &c_indices {
            out_values.push(arr.values[r * arr.cols + c].clone());
        }
    }

    ComputedValue::array(r_indices.len(), c_indices.len(), out_values)
}

pub fn drop(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let arr = args[0].to_array_value();
    let rows_arg = args[1].to_scalar().as_f64()?.trunc() as i64;
    let cols_arg = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?.trunc() as i64
    } else {
        0
    };

    let drop_indices = |total: usize, count: i64| -> Vec<usize> {
        let abs_c = count.unsigned_abs() as usize;
        if abs_c >= total {
            return Vec::new();
        }
        if count >= 0 {
            (abs_c..total).collect()
        } else {
            (0..total - abs_c).collect()
        }
    };

    let r_indices = drop_indices(arr.rows, rows_arg);
    let c_indices = drop_indices(arr.cols, cols_arg);

    if r_indices.is_empty() || c_indices.is_empty() {
        return Err(ErrorCode::Calc);
    }

    let mut out_values = Vec::with_capacity(r_indices.len() * c_indices.len());
    for &r in &r_indices {
        for &c in &c_indices {
            out_values.push(arr.values[r * arr.cols + c].clone());
        }
    }

    ComputedValue::array(r_indices.len(), c_indices.len(), out_values)
}
