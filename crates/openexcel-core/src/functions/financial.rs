use crate::types::{ComputedValue, ErrorCode, Scalar};

pub fn pmt(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let rate = args[0].to_scalar().as_f64()?;
    let nper = args[1].to_scalar().as_f64()?;
    let pv = args[2].to_scalar().as_f64()?;
    let fv = if args.len() >= 4 {
        args[3].to_scalar().as_f64()?
    } else {
        0.0
    };
    let type_val = if args.len() >= 5 {
        args[4].to_scalar().as_f64()?
    } else {
        0.0
    };

    if rate == 0.0 {
        if nper == 0.0 {
            return Err(ErrorCode::Div0);
        }
        let res = -(pv + fv) / nper;
        Ok(ComputedValue::number(res))
    } else {
        let factor = (1.0 + rate).powf(nper);
        let annuity = (factor - 1.0) / rate * (1.0 + rate * type_val);
        if annuity == 0.0 {
            return Err(ErrorCode::Div0);
        }
        let res = -(pv * factor + fv) / annuity;
        Ok(ComputedValue::number(res))
    }
}

pub fn pv(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let rate = args[0].to_scalar().as_f64()?;
    let nper = args[1].to_scalar().as_f64()?;
    let pmt_val = args[2].to_scalar().as_f64()?;
    let fv = if args.len() >= 4 {
        args[3].to_scalar().as_f64()?
    } else {
        0.0
    };
    let type_val = if args.len() >= 5 {
        args[4].to_scalar().as_f64()?
    } else {
        0.0
    };

    if rate == 0.0 {
        let res = -(fv + pmt_val * nper);
        Ok(ComputedValue::number(res))
    } else {
        let factor = (1.0 + rate).powf(nper);
        let annuity = (factor - 1.0) / rate * (1.0 + rate * type_val);
        let res = -(pmt_val * annuity + fv) / factor;
        Ok(ComputedValue::number(res))
    }
}

pub fn fv(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let rate = args[0].to_scalar().as_f64()?;
    let nper = args[1].to_scalar().as_f64()?;
    let pmt_val = args[2].to_scalar().as_f64()?;
    let pv_val = if args.len() >= 4 {
        args[3].to_scalar().as_f64()?
    } else {
        0.0
    };
    let type_val = if args.len() >= 5 {
        args[4].to_scalar().as_f64()?
    } else {
        0.0
    };

    if rate == 0.0 {
        let res = -(pv_val + pmt_val * nper);
        Ok(ComputedValue::number(res))
    } else {
        let factor = (1.0 + rate).powf(nper);
        let annuity = (factor - 1.0) / rate * (1.0 + rate * type_val);
        let res = -(pv_val * factor + pmt_val * annuity);
        Ok(ComputedValue::number(res))
    }
}

pub fn npv(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let rate = args[0].to_scalar().as_f64()?;
    if (1.0 + rate).abs() < 1e-12 {
        return Err(ErrorCode::Div0);
    }
    let mut total = 0.0;
    let mut period = 1;

    for arg in &args[1..] {
        for s in arg.flat_scalars() {
            if let Scalar::Number { value } = s {
                total += value / (1.0 + rate).powi(period);
                period += 1;
            }
        }
    }

    if !total.is_finite() {
        return Err(ErrorCode::Div0);
    }

    Ok(ComputedValue::number(total))
}

pub fn irr(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let mut flows = Vec::new();
    for s in args[0].flat_scalars() {
        if let Scalar::Number { value } = s {
            flows.push(value);
        }
    }

    if !flows.iter().any(|&x| x < 0.0) || !flows.iter().any(|&x| x > 0.0) {
        return Err(ErrorCode::Num);
    }

    let mut rate = if args.len() >= 2 {
        args[1].to_scalar().as_f64().unwrap_or(0.1)
    } else {
        0.1
    };

    for _ in 0..100 {
        let mut f = 0.0;
        let mut d = 0.0;
        for (j, &v) in flows.iter().enumerate() {
            let j_f = j as f64;
            f += v / (1.0 + rate).powf(j_f);
            d += -j_f * v / (1.0 + rate).powf(j_f + 1.0);
        }

        if d.abs() < 1e-15 {
            return Err(ErrorCode::Num);
        }

        let next = rate - f / d;
        if !next.is_finite() || next <= -1.0 {
            return Err(ErrorCode::Num);
        }

        if (next - rate).abs() < 1e-10 {
            return Ok(ComputedValue::number(next));
        }

        rate = next;
    }

    Err(ErrorCode::Num)
}
