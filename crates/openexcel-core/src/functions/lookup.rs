use crate::types::{ComputedValue, ErrorCode, Scalar};
use super::criteria::{compare_scalars, matches_criteria};

pub fn index(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let arr = args[0].to_array_value();
    let r_f = args[1].to_scalar().as_f64()?;
    let c_f = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?
    } else {
        1.0
    };

    let r = r_f.trunc() as i64;
    let c = c_f.trunc() as i64;

    if r < 1 || c < 1 || (r as usize) > arr.rows || (c as usize) > arr.cols {
        return Err(ErrorCode::Ref);
    }

    let val = arr.get((r - 1) as usize, (c - 1) as usize).cloned().unwrap_or(Scalar::Null);
    Ok(ComputedValue::Scalar(val))
}

pub fn match_fn(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let target = args[0].to_scalar();
    if let Scalar::Error { code, .. } = target {
        return Err(code);
    }
    let vals = args[1].flat_scalars();
    for s in &vals {
        if let Scalar::Error { code, .. } = s {
            return Err(*code);
        }
    }

    let match_type = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?.trunc() as i64
    } else {
        1
    };

    if ![-1, 0, 1].contains(&match_type) {
        return Err(ErrorCode::Value);
    }

    if match_type == 0 {
        // Exact match
        for (i, v) in vals.iter().enumerate() {
            if compare_scalars(v, &target) == std::cmp::Ordering::Equal {
                return Ok(ComputedValue::number((i + 1) as f64));
            }
        }
        return Err(ErrorCode::NA);
    }

    if match_type == 1 {
        // Largest value <= target
        let mut best_idx: Option<usize> = None;
        for (i, v) in vals.iter().enumerate() {
            if compare_scalars(v, &target) != std::cmp::Ordering::Greater {
                if let Some(prev) = best_idx {
                    if compare_scalars(v, &vals[prev]) == std::cmp::Ordering::Greater {
                        best_idx = Some(i);
                    }
                } else {
                    best_idx = Some(i);
                }
            }
        }
        if let Some(i) = best_idx {
            Ok(ComputedValue::number((i + 1) as f64))
        } else {
            Err(ErrorCode::NA)
        }
    } else {
        // match_type == -1: Smallest value >= target
        let mut best_idx: Option<usize> = None;
        for (i, v) in vals.iter().enumerate() {
            if compare_scalars(v, &target) != std::cmp::Ordering::Less {
                if let Some(prev) = best_idx {
                    if compare_scalars(v, &vals[prev]) == std::cmp::Ordering::Less {
                        best_idx = Some(i);
                    }
                } else {
                    best_idx = Some(i);
                }
            }
        }
        if let Some(i) = best_idx {
            Ok(ComputedValue::number((i + 1) as f64))
        } else {
            Err(ErrorCode::NA)
        }
    }
}

pub fn xmatch(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let target = args[0].to_scalar();
    if let Scalar::Error { code, .. } = target {
        return Err(code);
    }
    let vals = args[1].flat_scalars();
    for s in &vals {
        if let Scalar::Error { code, .. } = s {
            return Err(*code);
        }
    }

    let match_mode = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?.trunc() as i64
    } else {
        0
    };
    let search_mode = if args.len() >= 4 {
        args[3].to_scalar().as_f64()?.trunc() as i64
    } else {
        1
    };

    if ![-1, 0, 1, 2].contains(&match_mode) || ![1, -1, 2, -2].contains(&search_mode) {
        return Err(ErrorCode::Value);
    }

    let mut indices: Vec<usize> = (0..vals.len()).collect();
    if search_mode < 0 {
        indices.reverse();
    }

    let mut found_idx: Option<usize> = None;
    for &i in &indices {
        let v = &vals[i];
        let matched = if match_mode == 2 {
            matches_criteria(v, &target)
        } else {
            compare_scalars(v, &target) == std::cmp::Ordering::Equal
        };
        if matched {
            found_idx = Some(i);
            break;
        }
    }

    if found_idx.is_none() && match_mode != 0 && match_mode != 2 {
        let smaller = match_mode == -1;
        let mut candidates: Vec<usize> = indices
            .into_iter()
            .filter(|&i| {
                if smaller {
                    compare_scalars(&vals[i], &target) == std::cmp::Ordering::Less
                } else {
                    compare_scalars(&vals[i], &target) == std::cmp::Ordering::Greater
                }
            })
            .collect();

        candidates.sort_by(|&a, &b| {
            let ord = compare_scalars(&vals[a], &vals[b]);
            if smaller { ord.reverse() } else { ord }
        });
        found_idx = candidates.first().copied();
    }

    if let Some(idx) = found_idx {
        Ok(ComputedValue::number((idx + 1) as f64))
    } else {
        Err(ErrorCode::NA)
    }
}

pub fn xlookup(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let target = args[0].to_scalar();
    if let Scalar::Error { code, .. } = target {
        return Err(code);
    }
    let lookup_arr = args[1].to_array_value();
    let result_arr = args[2].to_array_value();

    let if_not_found = args.get(3).cloned();
    let match_mode = if args.len() >= 5 {
        args[4].to_scalar().as_f64()?.trunc() as i64
    } else {
        0
    };
    let search_mode = if args.len() >= 6 {
        args[5].to_scalar().as_f64()?.trunc() as i64
    } else {
        1
    };

    let vals = &lookup_arr.values;
    for s in vals {
        if let Scalar::Error { code, .. } = s {
            return Err(*code);
        }
    }

    let mut indices: Vec<usize> = (0..vals.len()).collect();
    if search_mode < 0 {
        indices.reverse();
    }

    let mut found_idx: Option<usize> = None;
    for &i in &indices {
        let v = &vals[i];
        let matched = if match_mode == 2 {
            matches_criteria(v, &target)
        } else {
            compare_scalars(v, &target) == std::cmp::Ordering::Equal
        };
        if matched {
            found_idx = Some(i);
            break;
        }
    }

    if found_idx.is_none() && match_mode != 0 && match_mode != 2 {
        let smaller = match_mode == -1;
        let mut candidates: Vec<usize> = indices
            .into_iter()
            .filter(|&i| {
                if smaller {
                    compare_scalars(&vals[i], &target) == std::cmp::Ordering::Less
                } else {
                    compare_scalars(&vals[i], &target) == std::cmp::Ordering::Greater
                }
            })
            .collect();

        candidates.sort_by(|&a, &b| {
            let ord = compare_scalars(&vals[a], &vals[b]);
            if smaller { ord.reverse() } else { ord }
        });
        found_idx = candidates.first().copied();
    }

    let index = match found_idx {
        Some(idx) => idx,
        None => return if_not_found.ok_or(ErrorCode::NA),
    };

    if lookup_arr.cols == 1 && result_arr.rows == lookup_arr.rows {
        // Vertical lookup
        let start = index * result_arr.cols;
        let end = (index + 1) * result_arr.cols;
        let row_vals = result_arr.values[start..end].to_vec();
        if result_arr.cols == 1 {
            Ok(ComputedValue::Scalar(row_vals[0].clone()))
        } else {
            ComputedValue::array(1, result_arr.cols, row_vals)
        }
    } else if lookup_arr.rows == 1 && result_arr.cols == lookup_arr.cols {
        // Horizontal lookup
        let col_vals: Vec<Scalar> = (0..result_arr.rows)
            .map(|r| result_arr.values[r * result_arr.cols + index].clone())
            .collect();
        if result_arr.rows == 1 {
            Ok(ComputedValue::Scalar(col_vals[0].clone()))
        } else {
            ComputedValue::array(result_arr.rows, 1, col_vals)
        }
    } else {
        Err(ErrorCode::Value)
    }
}

pub fn vlookup(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let target = args[0].to_scalar();
    let table = args[1].to_array_value();
    let col_idx_f = args[2].to_scalar().as_f64()?;
    let range_lookup = if args.len() >= 4 {
        args[3].to_scalar().as_bool().unwrap_or(true)
    } else {
        true
    };

    let col_idx = col_idx_f.trunc() as i64 - 1;
    if col_idx < 0 || (col_idx as usize) >= table.cols {
        return Err(ErrorCode::Ref);
    }

    let mut found: Option<usize> = None;
    for r in 0..table.rows {
        let v = &table.values[r * table.cols];
        let c = compare_scalars(v, &target);
        if c == std::cmp::Ordering::Equal {
            found = Some(r);
            break;
        }
        if range_lookup && c == std::cmp::Ordering::Less {
            found = Some(r);
        }
    }

    if let Some(r) = found {
        let val = table.values[r * table.cols + col_idx as usize].clone();
        Ok(ComputedValue::Scalar(val))
    } else {
        Err(ErrorCode::NA)
    }
}

pub fn hlookup(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let target = args[0].to_scalar();
    let table = args[1].to_array_value();
    let row_idx_f = args[2].to_scalar().as_f64()?;
    let range_lookup = if args.len() >= 4 {
        args[3].to_scalar().as_bool().unwrap_or(true)
    } else {
        true
    };

    let row_idx = row_idx_f.trunc() as i64 - 1;
    if row_idx < 0 || (row_idx as usize) >= table.rows {
        return Err(ErrorCode::Ref);
    }

    let mut found: Option<usize> = None;
    for c in 0..table.cols {
        let v = &table.values[c];
        let cmp = compare_scalars(v, &target);
        if cmp == std::cmp::Ordering::Equal {
            found = Some(c);
            break;
        }
        if range_lookup && cmp == std::cmp::Ordering::Less {
            found = Some(c);
        }
    }

    if let Some(c) = found {
        let val = table.values[row_idx as usize * table.cols + c].clone();
        Ok(ComputedValue::Scalar(val))
    } else {
        Err(ErrorCode::NA)
    }
}
