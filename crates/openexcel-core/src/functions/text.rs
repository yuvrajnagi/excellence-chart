use crate::types::{ComputedValue, ErrorCode, Scalar};
use regex::Regex;

pub fn len(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    Ok(ComputedValue::number(s.chars().count() as f64))
}

pub fn left(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    let count_f = if args.len() >= 2 {
        args[1].to_scalar().as_f64()?
    } else {
        1.0
    };
    if count_f < 0.0 {
        return Err(ErrorCode::Value);
    }
    let count = count_f.trunc() as usize;
    let res: String = s.chars().take(count).collect();
    Ok(ComputedValue::string(res))
}

pub fn right(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    let count_f = if args.len() >= 2 {
        args[1].to_scalar().as_f64()?
    } else {
        1.0
    };
    if count_f < 0.0 {
        return Err(ErrorCode::Value);
    }
    let count = count_f.trunc() as usize;
    let total_len = s.chars().count();
    let skip = total_len.saturating_sub(count);
    let res: String = s.chars().skip(skip).collect();
    Ok(ComputedValue::string(res))
}

pub fn mid(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    let start_f = args[1].to_scalar().as_f64()?;
    let len_f = args[2].to_scalar().as_f64()?;

    if start_f < 1.0 || len_f < 0.0 {
        return Err(ErrorCode::Value);
    }

    let start = (start_f.trunc() as usize).saturating_sub(1);
    let len = len_f.trunc() as usize;
    let res: String = s.chars().skip(start).take(len).collect();
    Ok(ComputedValue::string(res))
}

pub fn trim(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    let trimmed = s.trim();
    let mut result = String::with_capacity(trimmed.len());
    let mut in_space = false;
    for c in trimmed.chars() {
        if c == ' ' {
            if !in_space {
                result.push(' ');
                in_space = true;
            }
        } else {
            result.push(c);
            in_space = false;
        }
    }
    Ok(ComputedValue::string(result))
}

pub fn upper(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    Ok(ComputedValue::string(s.to_uppercase()))
}

pub fn lower(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    Ok(ComputedValue::string(s.to_lowercase()))
}

pub fn proper(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    let mut result = String::with_capacity(s.len());
    let mut new_word = true;
    for c in s.chars() {
        if c.is_alphabetic() {
            if new_word {
                for uc in c.to_uppercase() {
                    result.push(uc);
                }
                new_word = false;
            } else {
                for lc in c.to_lowercase() {
                    result.push(lc);
                }
            }
        } else {
            result.push(c);
            new_word = true;
        }
    }
    Ok(ComputedValue::string(result))
}

pub fn concat(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    let mut result = String::new();
    for arg in args {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                return Err(code);
            }
            result.push_str(&s.as_string()?);
        }
    }
    Ok(ComputedValue::string(result))
}

pub fn textjoin(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let delim = args[0].to_scalar().as_string()?;
    let ignore_empty = args[1].to_scalar().as_bool()?;

    let mut parts = Vec::new();
    for arg in &args[2..] {
        for s in arg.flat_scalars() {
            if let Scalar::Error { code, .. } = s {
                return Err(code);
            }
            let text = s.as_string()?;
            if ignore_empty && (s.is_null() || text.is_empty()) {
                continue;
            }
            parts.push(text);
        }
    }
    Ok(ComputedValue::string(parts.join(&delim)))
}

pub fn substitute(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 3 {
        return Err(ErrorCode::Value);
    }
    let text = args[0].to_scalar().as_string()?;
    let old_text = args[1].to_scalar().as_string()?;
    let new_text = args[2].to_scalar().as_string()?;

    if old_text.is_empty() {
        return Ok(ComputedValue::string(text));
    }

    if args.len() >= 4 {
        let instance_f = args[3].to_scalar().as_f64()?;
        if instance_f < 1.0 {
            return Err(ErrorCode::Value);
        }
        let target_instance = instance_f.trunc() as usize;

        let mut result = String::with_capacity(text.len());
        let mut count = 0;
        let mut last_idx = 0;

        for (idx, _) in text.match_indices(&old_text) {
            count += 1;
            if count == target_instance {
                result.push_str(&text[last_idx..idx]);
                result.push_str(&new_text);
                last_idx = idx + old_text.len();
                break;
            }
        }
        result.push_str(&text[last_idx..]);
        Ok(ComputedValue::string(result))
    } else {
        Ok(ComputedValue::string(text.replace(&old_text, &new_text)))
    }
}

pub fn replace(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 4 {
        return Err(ErrorCode::Value);
    }
    let text = args[0].to_scalar().as_string()?;
    let start_f = args[1].to_scalar().as_f64()?;
    let num_chars_f = args[2].to_scalar().as_f64()?;
    let new_text = args[3].to_scalar().as_string()?;

    if start_f < 1.0 || num_chars_f < 0.0 {
        return Err(ErrorCode::Value);
    }

    let start = (start_f.trunc() as usize).saturating_sub(1);
    let num_chars = num_chars_f.trunc() as usize;

    let chars: Vec<char> = text.chars().collect();
    let prefix: String = chars.iter().take(start).collect();
    let suffix: String = chars.iter().skip(start + num_chars).collect();

    Ok(ComputedValue::string(format!("{}{}{}", prefix, new_text, suffix)))
}

pub fn find(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let find_text = args[0].to_scalar().as_string()?;
    let within_text = args[1].to_scalar().as_string()?;
    let start_f = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?
    } else {
        1.0
    };

    if start_f < 1.0 {
        return Err(ErrorCode::Value);
    }
    let start_char_idx = (start_f.trunc() as usize).saturating_sub(1);

    let within_chars: Vec<char> = within_text.chars().collect();
    if start_char_idx > within_chars.len() {
        return Err(ErrorCode::Value);
    }
    let sub: String = within_chars[start_char_idx..].iter().collect();

    if let Some(pos) = sub.find(&find_text) {
        let char_pos = sub[..pos].chars().count();
        Ok(ComputedValue::number((start_char_idx + char_pos + 1) as f64))
    } else {
        Err(ErrorCode::Value)
    }
}

pub fn search(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let find_pattern = args[0].to_scalar().as_string()?;
    let within_text = args[1].to_scalar().as_string()?;
    let start_f = if args.len() >= 3 {
        args[2].to_scalar().as_f64()?
    } else {
        1.0
    };

    if start_f < 1.0 {
        return Err(ErrorCode::Value);
    }
    let start_char_idx = (start_f.trunc() as usize).saturating_sub(1);

    let within_chars: Vec<char> = within_text.chars().collect();
    if start_char_idx > within_chars.len() {
        return Err(ErrorCode::Value);
    }
    let sub: String = within_chars[start_char_idx..].iter().collect();

    let mut regex_pattern = String::from("(?i)");
    for c in find_pattern.chars() {
        match c {
            '*' => regex_pattern.push_str(".*"),
            '?' => regex_pattern.push('.'),
            _ => regex_pattern.push_str(&regex::escape(&c.to_string())),
        }
    }

    if let Ok(re) = Regex::new(&regex_pattern) {
        if let Some(m) = re.find(&sub) {
            let char_pos = sub[..m.start()].chars().count();
            return Ok(ComputedValue::number((start_char_idx + char_pos + 1) as f64));
        }
    }

    Err(ErrorCode::Value)
}

pub fn value(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.is_empty() {
        return Err(ErrorCode::Value);
    }
    let s = args[0].to_scalar().as_string()?;
    let clean = s.replace(['$', ','], "").trim().to_string();
    if clean.ends_with('%') {
        let without_pct = clean[..clean.len() - 1].trim();
        let num = without_pct.parse::<f64>().map_err(|_| ErrorCode::Value)?;
        Ok(ComputedValue::number(num / 100.0))
    } else {
        let num = clean.parse::<f64>().map_err(|_| ErrorCode::Value)?;
        Ok(ComputedValue::number(num))
    }
}

pub fn text(args: &[ComputedValue]) -> Result<ComputedValue, ErrorCode> {
    if args.len() < 2 {
        return Err(ErrorCode::Value);
    }
    let val_scalar = args[0].to_scalar();
    let fmt_str = args[1].to_scalar().as_string()?;

    let lower_fmt = fmt_str.to_lowercase();
    if lower_fmt.contains("yy") || lower_fmt.contains("dd") {
        // Date formatting
        let serial = val_scalar.as_f64()?;
        let (y, m, d) = super::date_time::serial_to_ymd(serial);
        let mut out = fmt_str.clone();
        out = Regex::new("(?i)yyyy").unwrap().replace_all(&out, &format!("{:04}", y)).to_string();
        out = Regex::new("(?i)yy").unwrap().replace_all(&out, &format!("{:02}", y % 100)).to_string();
        out = Regex::new("(?i)mm").unwrap().replace_all(&out, &format!("{:02}", m)).to_string();
        out = Regex::new("(?i)dd").unwrap().replace_all(&out, &format!("{:02}", d)).to_string();
        return Ok(ComputedValue::string(out));
    }

    let val = val_scalar.as_f64()?;
    let is_pct = fmt_str.contains('%');
    let display_val = if is_pct { val * 100.0 } else { val };

    let decimal_places = if let Some(idx) = fmt_str.find('.') {
        let after = &fmt_str[idx + 1..];
        after.chars().take_while(|c| *c == '0' || *c == '#').count()
    } else {
        0
    };

    let formatted_num = format!("{:.*}", decimal_places, display_val);
    let num_str = if fmt_str.contains(',') {
        let (int_part, frac_part) = match formatted_num.split_once('.') {
            Some((i, f)) => (i, Some(f)),
            None => (formatted_num.as_str(), None),
        };
        let (is_neg, digits) = if let Some(stripped) = int_part.strip_prefix('-') {
            (true, stripped)
        } else {
            (false, int_part)
        };
        let len = digits.len();
        let mut grouped = String::with_capacity(len + len / 3 + 1);
        if is_neg {
            grouped.push('-');
        }
        for (i, ch) in digits.chars().enumerate() {
            if i > 0 && (len - i) % 3 == 0 {
                grouped.push(',');
            }
            grouped.push(ch);
        }
        if let Some(f) = frac_part {
            grouped.push('.');
            grouped.push_str(f);
        }
        grouped
    } else {
        formatted_num
    };

    let mut result = String::new();
    if fmt_str.contains('$') {
        result.push('$');
    }
    result.push_str(&num_str);
    if is_pct {
        result.push('%');
    }

    Ok(ComputedValue::string(result))
}
