use crate::types::{ComputedValue, ErrorCode, Scalar};
use super::criteria::compare_scalars;

pub fn and(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let mut saw_error: Option<ErrorCode> = None;
    let mut all_true = true;

    for arg in args {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                if saw_error.is_none() {
                    saw_error = Some(code);
                }
            } else {
                match s.as_bool() {
                    Ok(b) => {
                        if !b {
                            all_true = false;
                        }
                    }
                    Err(code) => {
                        if saw_error.is_none() {
                            saw_error = Some(code);
                        }
                    }
                }
            }
        }
    }

    if let Some(err) = saw_error {
        Err(err)
    } else {
        Ok(ComputedValue::boolean(all_true))
    }
}

pub fn or(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let mut saw_error: Option<ErrorCode> = None;
    let mut any_true = false;

    for arg in args {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                if saw_error.is_none() {
                    saw_error = Some(code);
                }
            } else {
                match s.as_bool() {
                    Ok(b) => {
                        if b {
                            any_true = true;
                        }
                    }
                    Err(code) => {
                        if saw_error.is_none() {
                            saw_error = Some(code);
                        }
                    }
                }
            }
        }
    }

    if any_true {
        Ok(ComputedValue::boolean(true))
    } else if let Some(err) = saw_error {
        Err(err)
    } else {
        Ok(ComputedValue::boolean(false))
    }
}

pub fn not(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() != 1 {
        return Err(ErrorCode::Value);
    }
    let b = args[0].to_scalar().as_bool()?;
    Ok(ComputedValue::boolean(!b))
}

pub fn if_fn(
    test_val: &ComputedValue,
    then_fn: impl Fn() -> Result<ComputedValue, ErrorCode>,
    else_fn: impl Fn() -> Result<ComputedValue, ErrorCode>,
) -> Result<ComputedValue, ErrorCode> {
    match test_val {
        ComputedValue::Array { rows, cols, values, .. } => {
            let mut yes_val: Option<ComputedValue> = None;
            let mut no_val: Option<ComputedValue> = None;
            let mut out_scalars = Vec::with_capacity(values.len());

            for (i, cond) in values.iter().enumerate() {
                if let Scalar::Error { code, .. } = cond {
                    out_scalars.push(Scalar::error(*code));
                    continue;
                }
                let is_true = match cond.as_bool() {
                    Ok(b) => b,
                    Err(code) => {
                        out_scalars.push(Scalar::error(code));
                        continue;
                    }
                };

                let branch_res = if is_true {
                    if yes_val.is_none() {
                        yes_val = Some(then_fn()?);
                    }
                    yes_val.as_ref().unwrap()
                } else {
                    if no_val.is_none() {
                        no_val = Some(else_fn()?);
                    }
                    no_val.as_ref().unwrap()
                };

                match branch_res {
                    ComputedValue::Array { rows: br, cols: bc, values: bv, .. } => {
                        if (*br != 1 && *br != *rows) || (*bc != 1 && *bc != *cols) {
                            return Err(ErrorCode::Value);
                        }
                        let r = i / cols;
                        let c = i % cols;
                        let val = bv.get((r % br) * bc + (c % bc)).cloned().unwrap_or(Scalar::Null);
                        out_scalars.push(val);
                    }
                    ComputedValue::Scalar(s) => {
                        out_scalars.push(s.clone());
                    }
                    _ => {
                        out_scalars.push(Scalar::error(ErrorCode::Calc));
                    }
                }
            }

            ComputedValue::array(*rows, *cols, out_scalars)
        }
        ComputedValue::Scalar(s) => {
            if let Scalar::Error { code, .. } = s {
                return Err(*code);
            }
            let is_true = s.as_bool()?;
            if is_true {
                then_fn()
            } else {
                else_fn()
            }
        }
        _ => Err(ErrorCode::Calc),
    }
}

pub fn iferror(
    first_res: Result<ComputedValue, ErrorCode>,
    fallback_fn: impl Fn() -> Result<ComputedValue, ErrorCode>,
) -> Result<ComputedValue, ErrorCode> {
    match first_res {
        Ok(ComputedValue::Array { rows, cols, values, .. }) => {
            let mut fallback_val: Option<ComputedValue> = None;
            let mut new_values = Vec::with_capacity(values.len());
            for (i, val) in values.into_iter().enumerate() {
                if val.is_error() {
                    if fallback_val.is_none() {
                        fallback_val = Some(fallback_fn()?);
                    }
                    let fb = fallback_val.as_ref().unwrap();
                    match fb {
                        ComputedValue::Array { values: fb_vals, .. } => {
                            new_values.push(fb_vals.get(i).cloned().unwrap_or(Scalar::error(ErrorCode::NA)));
                        }
                        ComputedValue::Scalar(s) => new_values.push(s.clone()),
                        _ => new_values.push(Scalar::error(ErrorCode::Calc)),
                    }
                } else {
                    new_values.push(val);
                }
            }
            ComputedValue::array(rows, cols, new_values)
        }
        Ok(ComputedValue::Scalar(s)) => {
            if s.is_error() {
                fallback_fn()
            } else {
                Ok(ComputedValue::Scalar(s))
            }
        }
        Ok(ComputedValue::Lambda { .. }) => fallback_fn(),
        Err(_) => fallback_fn(),
    }
}

pub fn ifna(
    first_res: Result<ComputedValue, ErrorCode>,
    fallback_fn: impl Fn() -> Result<ComputedValue, ErrorCode>,
) -> Result<ComputedValue, ErrorCode> {
    match first_res {
        Ok(ComputedValue::Array { rows, cols, values, .. }) => {
            let mut fallback_val: Option<ComputedValue> = None;
            let mut new_values = Vec::with_capacity(values.len());
            for (i, val) in values.into_iter().enumerate() {
                if let Scalar::Error { code: ErrorCode::NA, .. } = val {
                    if fallback_val.is_none() {
                        fallback_val = Some(fallback_fn()?);
                    }
                    let fb = fallback_val.as_ref().unwrap();
                    match fb {
                        ComputedValue::Array { values: fb_vals, .. } => {
                            new_values.push(fb_vals.get(i).cloned().unwrap_or(Scalar::error(ErrorCode::NA)));
                        }
                        ComputedValue::Scalar(s) => new_values.push(s.clone()),
                        _ => new_values.push(Scalar::error(ErrorCode::Calc)),
                    }
                } else {
                    new_values.push(val);
                }
            }
            ComputedValue::array(rows, cols, new_values)
        }
        Ok(ComputedValue::Scalar(Scalar::Error { code: ErrorCode::NA, .. })) => fallback_fn(),
        Ok(val) => Ok(val),
        Err(ErrorCode::NA) => fallback_fn(),
        Err(e) => Err(e),
    }
}

pub fn ifs<F>(pair_count: usize, mut get_pair: F) -> Result<ComputedValue, ErrorCode>
where
    F: FnMut(usize) -> (Result<ComputedValue, ErrorCode>, Result<ComputedValue, ErrorCode>),
{
    if pair_count == 0 {
        return Err(ErrorCode::Value);
    }
    for i in 0..pair_count {
        let (cond_res, val_res) = get_pair(i);
        let cond = cond_res?.to_scalar();
        if let Scalar::Error { code, .. } = cond {
            return Err(code);
        }
        if cond.as_bool()? {
            return val_res;
        }
    }
    Err(ErrorCode::NA)
}

pub fn switch<F>(target: &ComputedValue, match_count: usize, has_default: bool, mut get_match: F) -> Result<ComputedValue, ErrorCode>
where
    F: FnMut(usize) -> (Result<ComputedValue, ErrorCode>, Result<ComputedValue, ErrorCode>),
{
    let target_scalar = target.to_scalar();
    if let Scalar::Error { code, .. } = target_scalar {
        return Err(code);
    }

    for i in 0..match_count {
        let (case_key_res, case_val_res) = get_match(i);
        let case_key = case_key_res?.to_scalar();
        if compare_scalars(&target_scalar, &case_key) == std::cmp::Ordering::Equal {
            return case_val_res;
        }
    }

    if has_default {
        let (_, default_val_res) = get_match(match_count);
        default_val_res
    } else {
        Err(ErrorCode::NA)
    }
}

pub fn choose<F>(index_val: &ComputedValue, count: usize, mut get_arg: F) -> Result<ComputedValue, ErrorCode>
where
    F: FnMut(usize) -> Result<ComputedValue, ErrorCode>,
{
    let idx_f = index_val.to_scalar().as_f64()?;
    let idx = idx_f.trunc() as i64;
    if idx < 1 || idx as usize > count {
        return Err(ErrorCode::Value);
    }
    get_arg((idx - 1) as usize)
}
