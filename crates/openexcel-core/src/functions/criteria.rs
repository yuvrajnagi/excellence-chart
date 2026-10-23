use crate::types::Scalar;
use regex::Regex;

pub fn compare_scalars(a: &Scalar, b: &Scalar) -> std::cmp::Ordering {
    match (a, b) {
        (Scalar::Number { value: v1 }, Scalar::Number { value: v2 }) => {
            v1.partial_cmp(v2).unwrap_or(std::cmp::Ordering::Equal)
        }
        (Scalar::String { value: s1 }, Scalar::String { value: s2 }) => {
            s1.to_lowercase().cmp(&s2.to_lowercase())
        }
        (Scalar::Boolean { value: b1 }, Scalar::Boolean { value: b2 }) => {
            b1.cmp(b2)
        }
        (Scalar::Null, Scalar::Null) => std::cmp::Ordering::Equal,
        _ => {
            // Try numeric comparison
            if let (Ok(n1), Ok(n2)) = (a.as_f64(), b.as_f64()) {
                n1.partial_cmp(&n2).unwrap_or(std::cmp::Ordering::Equal)
            } else {
                a.to_string_lossy().to_lowercase().cmp(&b.to_string_lossy().to_lowercase())
            }
        }
    }
}

pub fn matches_criteria(val: &Scalar, crit: &Scalar) -> bool {
    if let Scalar::String { value: s } = crit {
        let (op, target) = if let Some(rest) = s.strip_prefix("<=") {
            ("<=", rest)
        } else if let Some(rest) = s.strip_prefix(">=") {
            (">=", rest)
        } else if let Some(rest) = s.strip_prefix("<>") {
            ("<>", rest)
        } else if let Some(rest) = s.strip_prefix('<') {
            ("<", rest)
        } else if let Some(rest) = s.strip_prefix('>') {
            (">", rest)
        } else if let Some(rest) = s.strip_prefix('=') {
            ("=", rest)
        } else {
            ("", s.as_str())
        };

        if !op.is_empty() {
            // Operator comparison
            let target_num = target.trim().parse::<f64>();
            let val_num = val.as_f64();

            let ord = if let (Ok(vn), Ok(tn)) = (val_num, target_num) {
                vn.partial_cmp(&tn).unwrap_or(std::cmp::Ordering::Equal)
            } else {
                val.to_string_lossy().to_lowercase().cmp(&target.trim().to_lowercase())
            };

            return match op {
                "=" => ord == std::cmp::Ordering::Equal,
                "<>" => ord != std::cmp::Ordering::Equal,
                "<" => ord == std::cmp::Ordering::Less,
                ">" => ord == std::cmp::Ordering::Greater,
                "<=" => ord != std::cmp::Ordering::Greater,
                ">=" => ord != std::cmp::Ordering::Less,
                _ => false,
            };
        }

        // Wildcard match
        let mut regex_pattern = String::from("(?i)^");
        for c in target.chars() {
            match c {
                '*' => regex_pattern.push_str(".*"),
                '?' => regex_pattern.push('.'),
                _ => {
                    regex_pattern.push_str(&regex::escape(&c.to_string()));
                }
            }
        }
        regex_pattern.push('$');

        if let Ok(re) = Regex::new(&regex_pattern) {
            let val_str = val.to_string_lossy();
            return re.is_match(&val_str);
        }
    }

    // Direct comparison
    compare_scalars(val, crit) == std::cmp::Ordering::Equal
}
