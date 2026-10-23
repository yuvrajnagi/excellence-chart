use chrono::{Datelike, Duration, NaiveDate, Weekday};
use crate::types::{ComputedValue, ErrorCode};

const BASE_YEAR: i32 = 1899;
const BASE_MONTH: u32 = 12;
const BASE_DAY: u32 = 30;

pub fn serial_to_date(serial: f64) -> Option<NaiveDate> {
    if (serial - 60.0).abs() < 1e-6 {
        // Special Lotus 1-2-3 quirk: Feb 29, 1900 (does not exist in Gregorian NaiveDate)
        // Represented by 1900-02-28 + 1 day conceptually
        return NaiveDate::from_ymd_opt(1900, 2, 28);
    }
    let base = NaiveDate::from_ymd_opt(BASE_YEAR, BASE_MONTH, BASE_DAY)?;
    let days = if serial < 60.0 {
        serial.floor() as i64 + 1
    } else {
        serial.floor() as i64
    };
    base.checked_add_signed(Duration::days(days))
}

pub fn serial_to_ymd(serial: f64) -> (i32, u32, u32) {
    if (serial - 60.0).abs() < 1e-6 {
        return (1900, 2, 29);
    }
    if let Some(d) = serial_to_date(serial) {
        (d.year(), d.month(), d.day())
    } else {
        (1900, 1, 1)
    }
}

pub fn date_to_serial(d: NaiveDate) -> f64 {
    let base = NaiveDate::from_ymd_opt(BASE_YEAR, BASE_MONTH, BASE_DAY).unwrap();
    let diff = (d - base).num_days() as f64;
    if diff < 61.0 {
        diff - 1.0
    } else {
        diff
    }
}

pub fn ymd_to_serial(mut year: i32, mut month: i32, day: i32) -> Result<f64, ErrorCode> {
    if year < 1900 {
        year += 1900;
    }
    // Normalize month
    while month < 1 {
        month += 12;
        year -= 1;
    }
    while month > 12 {
        month -= 12;
        year += 1;
    }

    if year == 1900 && month == 2 && day == 29 {
        return Ok(60.0);
    }

    let start_of_month = NaiveDate::from_ymd_opt(year, month as u32, 1).ok_or(ErrorCode::Value)?;
    let target_date = start_of_month.checked_add_signed(Duration::days((day - 1) as i64)).ok_or(ErrorCode::Value)?;
    Ok(date_to_serial(target_date))
}

pub fn today(args: &[ComputedValue], now_ms: i64) -> Result<ComputedValue, ErrorCode> {
    if !args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let days_since_unix = now_ms / 86_400_000;
    let serial = days_since_unix + 25569;
    Ok(ComputedValue::number(serial as f64))
}

pub fn now(args: &[ComputedValue], now_ms: i64) -> Result<ComputedValue, ErrorCode> {
    if !args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let days_since_unix = now_ms as f64 / 86_400_000.0;
    let serial = days_since_unix + 25569.0;
    Ok(ComputedValue::number(serial))
}

pub fn date(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() != 3 {
        return Err(ErrorCode::Value);
    }
    let y = args[0].to_scalar().as_f64()?.trunc() as i32;
    let m = args[1].to_scalar().as_f64()?.trunc() as i32;
    let d = args[2].to_scalar().as_f64()?.trunc() as i32;
    let s = ymd_to_serial(y, m, d)?;
    Ok(ComputedValue::number(s))
}

pub fn year(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_f64()?;
    let (y, _, _) = serial_to_ymd(s);
    Ok(ComputedValue::number(y as f64))
}

pub fn month(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_f64()?;
    let (_, m, _) = serial_to_ymd(s);
    Ok(ComputedValue::number(m as f64))
}

pub fn day(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_f64()?;
    let (_, _, d) = serial_to_ymd(s);
    Ok(ComputedValue::number(d as f64))
}

pub fn edate(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_f64()?;
    let months = args[1].to_scalar().as_f64()?.trunc() as i32;

    let (y, m, d) = serial_to_ymd(s);
    let total_months = (y * 12 + (m as i32 - 1)) + months;
    let mut new_y = total_months / 12;
    let mut new_m = total_months % 12 + 1;
    if new_m < 1 {
        new_m += 12;
        new_y -= 1;
    }

    // Determine days in new_m
    let days_in_new_month = if new_m == 12 {
        31
    } else {
        let next_month_start = NaiveDate::from_ymd_opt(new_y, (new_m + 1) as u32, 1).ok_or(ErrorCode::Value)?;
        let end_of_cur_month = next_month_start - Duration::days(1);
        end_of_cur_month.day()
    };

    let new_d = d.min(days_in_new_month);
    let target_date = NaiveDate::from_ymd_opt(new_y, new_m as u32, new_d).ok_or(ErrorCode::Value)?;
    Ok(ComputedValue::number(date_to_serial(target_date)))
}

pub fn eomonth(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_f64()?;
    let months = args[1].to_scalar().as_f64()?.trunc() as i32;

    let (y, m, _) = serial_to_ymd(s);
    let total_months = (y * 12 + (m as i32 - 1)) + months + 1;
    let mut next_y = total_months / 12;
    let mut next_m = total_months % 12 + 1;
    if next_m < 1 {
        next_m += 12;
        next_y -= 1;
    }

    let next_month_start = NaiveDate::from_ymd_opt(next_y, next_m as u32, 1).ok_or(ErrorCode::Value)?;
    let end_of_target_month = next_month_start - Duration::days(1);
    Ok(ComputedValue::number(date_to_serial(end_of_target_month)))
}

pub fn networkdays(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let start_s = args[0].to_scalar().as_f64()?.trunc() as i64;
    let end_s = args[1].to_scalar().as_f64()?.trunc() as i64;

    let mut holidays = std::collections::HashSet::new();
    if args.len() >= 3 {
        for s in args[2].flat_scalars() {
            if let Ok(h) = s.as_f64() {
                holidays.insert(h.trunc() as i64);
            }
        }
    }

    if (end_s - start_s).abs() > 1_000_000 {
        return Err(ErrorCode::Num);
    }

    let is_working = |serial: i64| -> bool {
        if let Some(d) = serial_to_date(serial as f64) {
            let weekday = d.weekday();
            weekday != Weekday::Sat && weekday != Weekday::Sun && !holidays.contains(&serial)
        } else {
            false
        }
    };

    let step = if end_s >= start_s { 1 } else { -1 };
    let mut cur = start_s;
    let mut count = 0i64;

    while (step > 0 && cur <= end_s) || (step < 0 && cur >= end_s) {
        if is_working(cur) {
            count += step;
        }
        cur += step;
    }

    Ok(ComputedValue::number(count as f64))
}

pub fn workday(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let start_s = args[0].to_scalar().as_f64()?.trunc() as i64;
    let days = args[1].to_scalar().as_f64()?.trunc() as i64;

    if days.abs() > 1_000_000 {
        return Err(ErrorCode::Num);
    }

    let mut holidays = std::collections::HashSet::new();
    if args.len() >= 3 {
        for s in args[2].flat_scalars() {
            if let Ok(h) = s.as_f64() {
                holidays.insert(h.trunc() as i64);
            }
        }
    }

    let is_working = |serial: i64| -> bool {
        if let Some(d) = serial_to_date(serial as f64) {
            let weekday = d.weekday();
            weekday != Weekday::Sat && weekday != Weekday::Sun && !holidays.contains(&serial)
        } else {
            false
        }
    };

    let step = if days >= 0 { 1 } else { -1 };
    let mut remaining = days.abs();
    let mut cur = start_s;

    while remaining > 0 {
        cur += step;
        if is_working(cur) {
            remaining -= 1;
        }
    }

    Ok(ComputedValue::number(cur as f64))
}
