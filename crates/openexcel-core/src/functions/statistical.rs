use crate::types::{ComputedValue, ErrorCode, Scalar};

fn extract_numbers(args: &[ComputedValue]) -> Result<Vec<f64>, ErrorCode> {
    let mut numbers = Vec::new();
    for arg in args {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                return Err(code);
            }
            if let Scalar::Number { value } = s {
                numbers.push(value);
            }
        }
    }
    Ok(numbers)
}

pub fn var_s(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let numbers = extract_numbers(args)?;
    if numbers.len() < 2 {
        return Err(ErrorCode::Div0);
    }
    let n = numbers.len() as f64;
    let mean = numbers.iter().sum::<f64>() / n;
    let var = numbers.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0);
    Ok(ComputedValue::number(var))
}

pub fn var_p(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let numbers = extract_numbers(args)?;
    if numbers.is_empty() {
        return Err(ErrorCode::Div0);
    }
    if numbers.len() == 1 {
        return Ok(ComputedValue::number(0.0));
    }
    let n = numbers.len() as f64;
    let mean = numbers.iter().sum::<f64>() / n;
    let var = numbers.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
    Ok(ComputedValue::number(var))
}

pub fn stdev_s(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let v = var_s(args)?;
    let val = v.to_scalar().as_f64()?;
    Ok(ComputedValue::number(val.sqrt()))
}

pub fn stdev_p(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let v = var_p(args)?;
    let val = v.to_scalar().as_f64()?;
    Ok(ComputedValue::number(val.sqrt()))
}

pub fn median(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let mut numbers = extract_numbers(args)?;
    if numbers.is_empty() {
        return Err(ErrorCode::Num);
    }
    numbers.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let len = numbers.len();
    if len % 2 == 1 {
        Ok(ComputedValue::number(numbers[len / 2]))
    } else {
        let mid1 = numbers[len / 2 - 1];
        let mid2 = numbers[len / 2];
        Ok(ComputedValue::number((mid1 + mid2) / 2.0))
    }
}

pub fn large(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let mut numbers = extract_numbers(&args[0..1])?;
    if numbers.is_empty() {
        return Err(ErrorCode::Num);
    }
    let k_f = args[1].to_scalar().as_f64()?;
    let k = k_f.trunc() as i64;
    if k < 1 || k as usize > numbers.len() {
        return Err(ErrorCode::Num);
    }
    numbers.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    Ok(ComputedValue::number(numbers[(k - 1) as usize]))
}

pub fn small(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let mut numbers = extract_numbers(&args[0..1])?;
    if numbers.is_empty() {
        return Err(ErrorCode::Num);
    }
    let k_f = args[1].to_scalar().as_f64()?;
    let k = k_f.trunc() as i64;
    if k < 1 || k as usize > numbers.len() {
        return Err(ErrorCode::Num);
    }
    numbers.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Ok(ComputedValue::number(numbers[(k - 1) as usize]))
}

pub fn rank_eq(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let target = args[0].to_scalar().as_f64()?;
    let numbers = extract_numbers(&args[1..2])?;
    let order = if args.len() >= 3 {
        args[2].to_scalar().as_f64().unwrap_or(0.0) != 0.0
    } else {
        false
    };

    if !numbers.iter().any(|&x| (x - target).abs() < 1e-12) {
        return Err(ErrorCode::NA);
    }

    let rank = if order {
        // Ascending: count how many numbers are strictly less
        1 + numbers.iter().filter(|&&x| x < target - 1e-12).count()
    } else {
        // Descending: count how many numbers are strictly greater
        1 + numbers.iter().filter(|&&x| x > target + 1e-12).count()
    };

    Ok(ComputedValue::number(rank as f64))
}
