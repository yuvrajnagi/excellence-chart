use crate::types::{ComputedValue, ErrorCode, Scalar};
use super::criteria::matches_criteria;
use super::statistical::{stdev_p, stdev_s, var_p, var_s};

pub fn sum(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let mut total = 0.0;
    for arg in args {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                return Err(code);
            }
            if let Scalar::Number { value } = s {
                total += value;
            }
        }
    }
    Ok(ComputedValue::number(total))
}

pub fn average(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let mut total = 0.0;
    let mut count = 0usize;
    for arg in args {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                return Err(code);
            }
            if let Scalar::Number { value } = s {
                total += value;
                count += 1;
            }
        }
    }
    if count == 0 {
        Err(ErrorCode::Div0)
    } else {
        Ok(ComputedValue::number(total / count as f64))
    }
}

pub fn min(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let mut min_val = f64::INFINITY;
    let mut found = false;
    for arg in args {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                return Err(code);
            }
            if let Scalar::Number { value } = s {
                min_val = min_val.min(value);
                found = true;
            }
        }
    }
    Ok(ComputedValue::number(if found { min_val } else { 0.0 }))
}

pub fn max(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let mut max_val = f64::NEG_INFINITY;
    let mut found = false;
    for arg in args {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                return Err(code);
            }
            if let Scalar::Number { value } = s {
                max_val = max_val.max(value);
                found = true;
            }
        }
    }
    Ok(ComputedValue::number(if found { max_val } else { 0.0 }))
}

pub fn count(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let mut total_count = 0usize;
    for arg in args {
        match arg {
            ComputedValue::Array { values, .. } => {
                for s in values {
                    if matches!(s, Scalar::Number { .. }) {
                        total_count += 1;
                    }
                }
            }
            ComputedValue::Scalar(s) => match s {
                Scalar::Number { .. } | Scalar::Boolean { .. } => total_count += 1,
                Scalar::String { value } => {
                    let trimmed = value.trim();
                    if !trimmed.is_empty() && trimmed.parse::<f64>().is_ok() {
                        total_count += 1;
                    }
                }
                _ => {}
            },
        }
    }
    Ok(ComputedValue::number(total_count as f64))
}

pub fn counta(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let mut total_count = 0usize;
    for arg in args {
        for s in arg.flat_scalars() {
            if !s.is_null() {
                total_count += 1;
            }
        }
    }
    Ok(ComputedValue::number(total_count as f64))
}

pub fn countif(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let range = args[0].flat_scalars();
    let crit = args[1].to_scalar();
    if let Scalar::Error { code, .. } = crit {
        return Err(code);
    }

    let mut matches = 0usize;
    for s in range {
        if matches_criteria(&s, &crit) {
            matches += 1;
        }
    }
    Ok(ComputedValue::number(matches as f64))
}

pub fn countifs(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 || !args.len().is_multiple_of(2) {
        return Err(ErrorCode::Value);
    }
    let first_range = args[0].flat_scalars();
    let len = first_range.len();

    let mut criteria_pairs = Vec::new();
    for i in (0..args.len()).step_by(2) {
        let r = args[i].flat_scalars();
        if r.len() != len {
            return Err(ErrorCode::Value);
        }
        let crit = args[i + 1].to_scalar();
        if let Scalar::Error { code, .. } = crit {
            return Err(code);
        }
        criteria_pairs.push((r, crit));
    }

    let mut count = 0usize;
    for idx in 0..len {
        let all_match = criteria_pairs.iter().all(|(r, crit)| matches_criteria(&r[idx], crit));
        if all_match {
            count += 1;
        }
    }
    Ok(ComputedValue::number(count as f64))
}

pub fn sumif(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let range = args[0].flat_scalars();
    let crit = args[1].to_scalar();
    if let Scalar::Error { code, .. } = crit {
        return Err(code);
    }
    let sum_range = if args.len() >= 3 {
        args[2].flat_scalars()
    } else {
        range.clone()
    };

    let mut total = 0.0;
    for (i, s) in range.iter().enumerate() {
        if matches_criteria(s, &crit) {
            if let Some(Scalar::Number { value }) = sum_range.get(i) {
                total += value;
            }
        }
    }
    Ok(ComputedValue::number(total))
}

pub fn sumifs(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 || !(args.len() - 1).is_multiple_of(2) {
        return Err(ErrorCode::Value);
    }
    let sum_range = args[0].flat_scalars();
    let len = sum_range.len();

    let mut criteria_pairs = Vec::new();
    for i in (1..args.len()).step_by(2) {
        let r = args[i].flat_scalars();
        if r.len() != len {
            return Err(ErrorCode::Value);
        }
        let crit = args[i + 1].to_scalar();
        if let Scalar::Error { code, .. } = crit {
            return Err(code);
        }
        criteria_pairs.push((r, crit));
    }

    let mut total = 0.0;
    for idx in 0..len {
        let all_match = criteria_pairs.iter().all(|(r, crit)| matches_criteria(&r[idx], crit));
        if all_match {
            if let Some(Scalar::Number { value }) = sum_range.get(idx) {
                total += value;
            }
        }
    }
    Ok(ComputedValue::number(total))
}

pub fn averageif(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let range = args[0].flat_scalars();
    let crit = args[1].to_scalar();
    if let Scalar::Error { code, .. } = crit {
        return Err(code);
    }
    let avg_range = if args.len() >= 3 {
        args[2].flat_scalars()
    } else {
        range.clone()
    };

    let mut total = 0.0;
    let mut count = 0usize;
    for (i, s) in range.iter().enumerate() {
        if matches_criteria(s, &crit) {
            if let Some(Scalar::Number { value }) = avg_range.get(i) {
                total += value;
                count += 1;
            }
        }
    }
    if count == 0 {
        Err(ErrorCode::Div0)
    } else {
        Ok(ComputedValue::number(total / count as f64))
    }
}

pub fn round(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let val = args.first().ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    let digits = args.get(1).map_or(Ok(0.0), |a| a.to_scalar().as_f64())?;
    let factor = 10.0f64.powf(digits);
    let rounded = (val * factor).round() / factor;
    Ok(ComputedValue::number(rounded))
}

pub fn roundup(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let val = args.first().ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    let digits = args.get(1).map_or(Ok(0.0), |a| a.to_scalar().as_f64())?;
    let factor = 10.0f64.powf(digits);
    let sign = if val < 0.0 { -1.0 } else { 1.0 };
    let rounded = sign * (val.abs() * factor).ceil() / factor;
    Ok(ComputedValue::number(rounded))
}

pub fn rounddown(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let val = args.first().ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    let digits = args.get(1).map_or(Ok(0.0), |a| a.to_scalar().as_f64())?;
    let factor = 10.0f64.powf(digits);
    let sign = if val < 0.0 { -1.0 } else { 1.0 };
    let rounded = sign * (val.abs() * factor).floor() / factor;
    Ok(ComputedValue::number(rounded))
}

pub fn int(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let val = args.first().ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    Ok(ComputedValue::number(val.floor()))
}

pub fn mod_fn(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let n = args.first().ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    let d = args.get(1).ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    if d == 0.0 {
        return Err(ErrorCode::Div0);
    }
    let res = ((n % d) + d) % d;
    Ok(ComputedValue::number(res))
}

pub fn abs(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let val = args.first().ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    Ok(ComputedValue::number(val.abs()))
}

pub fn power(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let base = args.first().ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    let exp = args.get(1).ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    if base < 0.0 && exp.fract() != 0.0 {
        return Err(ErrorCode::Num);
    }
    let res = base.powf(exp);
    if !res.is_finite() {
        return Err(ErrorCode::Num);
    }
    Ok(ComputedValue::number(res))
}

pub fn sqrt(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let val = args.first().ok_or(ErrorCode::Value)?.to_scalar().as_f64()?;
    if val < 0.0 {
        return Err(ErrorCode::Num);
    }
    Ok(ComputedValue::number(val.sqrt()))
}

pub fn rand<F>(args: &[ComputedValue], mut random_fn: F) -> Result<ComputedValue, ErrorCode>
where
    F: FnMut() -> f64,
{
    if !args.is_empty() {
        return Err(ErrorCode::Value);
    }
    Ok(ComputedValue::number(random_fn()))
}

pub fn randbetween<F>(args: &[ComputedValue], mut random_fn: F) -> Result<ComputedValue, ErrorCode>
where
    F: FnMut() -> f64,
{
    if args.len() != 2 {
        return Err(ErrorCode::Value);
    }
    let bottom = args[0].to_scalar().as_f64()?;
    let top = args[1].to_scalar().as_f64()?;
    let b = bottom.ceil();
    let t = top.floor();
    if b > t {
        return Err(ErrorCode::Num);
    }
    let r = random_fn();
    let res = (r * (t - b + 1.0)).floor() + b;
    Ok(ComputedValue::number(res))
}

pub fn subtotal(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let code_f = args[0].to_scalar().as_f64()?;
    if code_f.fract() != 0.0 {
        return Err(ErrorCode::Value);
    }
    let code = code_f as i64;
    let func_code = if (1..=11).contains(&code) {
        code
    } else if (101..=111).contains(&code) {
        code - 100
    } else {
        return Err(ErrorCode::Value);
    };

    let rest = &args[1..];
    match func_code {
        1 => average(rest),
        2 => count(rest),
        3 => counta(rest),
        4 => max(rest),
        5 => min(rest),
        6 => {
            // PRODUCT
            let mut prod = 1.0;
            let mut count = 0;
            for arg in rest {
                for s in arg.flat_scalars() {
                    if let Scalar::Number { value } = s {
                        prod *= value;
                        count += 1;
                    }
                }
            }
            Ok(ComputedValue::number(if count > 0 { prod } else { 0.0 }))
        }
        7 => stdev_s(rest),
        8 => stdev_p(rest),
        9 => sum(rest),
        10 => var_s(rest),
        11 => var_p(rest),
        _ => Err(ErrorCode::Value),
    }
}
