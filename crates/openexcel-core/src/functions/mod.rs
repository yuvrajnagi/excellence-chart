pub mod bindings;
pub mod criteria;
pub mod date_time;
pub mod dynamic_array;
pub mod financial;
pub mod logical;
pub mod math;
pub mod lookup;
pub mod statistical;
pub mod text;

use std::collections::HashMap;
use crate::types::{ComputedValue, ErrorCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FunctionDefinition {
    pub name: &'static str,
    pub min_args: usize,
    pub max_args: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct FunctionRegistry {
    functions: HashMap<&'static str, FunctionDefinition>,
}

impl Default for FunctionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl FunctionRegistry {
    pub fn new() -> Self {
        let mut reg = Self {
            functions: HashMap::new(),
        };

        let defs = [
            // Math
            ("SUM", 1, None),
            ("AVERAGE", 1, None),
            ("MIN", 1, None),
            ("MAX", 1, None),
            ("COUNT", 1, None),
            ("COUNTA", 1, None),
            ("COUNTIF", 2, Some(2)),
            ("COUNTIFS", 2, None),
            ("SUMIF", 2, Some(3)),
            ("SUMIFS", 3, None),
            ("AVERAGEIF", 2, Some(3)),
            ("ROUND", 2, Some(2)),
            ("ROUNDUP", 2, Some(2)),
            ("ROUNDDOWN", 2, Some(2)),
            ("INT", 1, Some(1)),
            ("MOD", 2, Some(2)),
            ("ABS", 1, Some(1)),
            ("POWER", 2, Some(2)),
            ("SQRT", 1, Some(1)),
            ("RAND", 0, Some(0)),
            ("RANDBETWEEN", 2, Some(2)),
            ("SUBTOTAL", 2, None),
            // Logical
            ("IF", 2, Some(3)),
            ("IFS", 2, None),
            ("AND", 1, None),
            ("OR", 1, None),
            ("NOT", 1, Some(1)),
            ("IFERROR", 2, Some(2)),
            ("IFNA", 2, Some(2)),
            ("SWITCH", 3, None),
            ("CHOOSE", 2, None),
            // Bindings
            ("LET", 3, None),
            ("LAMBDA", 1, None),
            // Lookup
            ("INDEX", 2, Some(3)),
            ("MATCH", 2, Some(3)),
            ("XMATCH", 2, Some(4)),
            ("XLOOKUP", 3, Some(6)),
            ("VLOOKUP", 3, Some(4)),
            ("HLOOKUP", 3, Some(4)),
            ("OFFSET", 3, Some(5)),
            ("INDIRECT", 1, Some(2)),
            // Dynamic Array
            ("FILTER", 2, Some(3)),
            ("SORT", 1, Some(4)),
            ("SORTBY", 2, None),
            ("UNIQUE", 1, Some(3)),
            ("SEQUENCE", 1, Some(4)),
            ("TRANSPOSE", 1, Some(1)),
            ("TAKE", 2, Some(3)),
            ("DROP", 2, Some(3)),
            // Text
            ("TEXT", 2, Some(2)),
            ("VALUE", 1, Some(1)),
            ("LEFT", 1, Some(2)),
            ("RIGHT", 1, Some(2)),
            ("MID", 3, Some(3)),
            ("LEN", 1, Some(1)),
            ("TRIM", 1, Some(1)),
            ("SUBSTITUTE", 3, Some(4)),
            ("REPLACE", 4, Some(4)),
            ("CONCAT", 1, None),
            ("TEXTJOIN", 3, None),
            ("FIND", 2, Some(3)),
            ("SEARCH", 2, Some(3)),
            ("UPPER", 1, Some(1)),
            ("LOWER", 1, Some(1)),
            ("PROPER", 1, Some(1)),
            // Date & Time
            ("TODAY", 0, Some(0)),
            ("NOW", 0, Some(0)),
            ("DATE", 3, Some(3)),
            ("YEAR", 1, Some(1)),
            ("MONTH", 1, Some(1)),
            ("DAY", 1, Some(1)),
            ("EDATE", 2, Some(2)),
            ("EOMONTH", 2, Some(2)),
            ("NETWORKDAYS", 2, Some(3)),
            ("WORKDAY", 2, Some(3)),
            // Financial
            ("PMT", 3, Some(5)),
            ("PV", 3, Some(5)),
            ("FV", 3, Some(5)),
            ("NPV", 2, None),
            ("IRR", 1, Some(2)),
            // Statistical
            ("STDEV.S", 1, None),
            ("STDEV.P", 1, None),
            ("VAR.S", 1, None),
            ("VAR.P", 1, None),
            ("MEDIAN", 1, None),
            ("LARGE", 2, Some(2)),
            ("SMALL", 2, Some(2)),
            ("RANK.EQ", 2, Some(3)),
        ];

        for (name, min_args, max_args) in defs {
            reg.functions.insert(name, FunctionDefinition { name, min_args, max_args });
        }

        reg
    }

    pub fn get(&self, name: &str) -> Option<&FunctionDefinition> {
        let upper = name.to_uppercase();
        self.functions.get(upper.as_str())
    }

    pub fn validate_arity(&self, name: &str, arg_count: usize) -> Result<(), ErrorCode> {
        if let Some(def) = self.get(name) {
            if arg_count < def.min_args {
                return Err(ErrorCode::Value);
            }
            if let Some(max_a) = def.max_args {
                if arg_count > max_a {
                    return Err(ErrorCode::Value);
                }
            }
            Ok(())
        } else {
            Err(ErrorCode::Name)
        }
    }

    pub fn function_names(&self) -> Vec<&'static str> {
        let mut names: Vec<_> = self.functions.keys().copied().collect();
        names.sort();
        names
    }
}

pub fn invoke_standard_function(
    name: &str,
    args: &[ComputedValue],
    now_ms: i64,
    random_fn: &mut dyn FnMut() -> f64,
) -> Result<ComputedValue, ErrorCode> {
    let upper = name.to_uppercase();

    // Check for first error in arguments (except functions that specifically absorb errors like COUNT, COUNTA, XLOOKUP)
    if upper != "COUNT" && upper != "COUNTA" && upper != "XLOOKUP" {
        for arg in args {
            if let Some(code) = arg.error_code() {
                return Err(code);
            }
        }
    }

    match upper.as_str() {
        // Math
        "SUM" => math::sum(args),
        "AVERAGE" => math::average(args),
        "MIN" => math::min(args),
        "MAX" => math::max(args),
        "COUNT" => math::count(args),
        "COUNTA" => math::counta(args),
        "COUNTIF" => math::countif(args),
        "COUNTIFS" => math::countifs(args),
        "SUMIF" => math::sumif(args),
        "SUMIFS" => math::sumifs(args),
        "AVERAGEIF" => math::averageif(args),
        "ROUND" => math::round(args),
        "ROUNDUP" => math::roundup(args),
        "ROUNDDOWN" => math::rounddown(args),
        "INT" => math::int(args),
        "MOD" => math::mod_fn(args),
        "ABS" => math::abs(args),
        "POWER" => math::power(args),
        "SQRT" => math::sqrt(args),
        "RAND" => math::rand(args, random_fn),
        "RANDBETWEEN" => math::randbetween(args, random_fn),
        "SUBTOTAL" => math::subtotal(args),

        // Logical
        "AND" => logical::and(args),
        "OR" => logical::or(args),
        "NOT" => logical::not(args),

        // Lookup
        "INDEX" => lookup::index(args),
        "MATCH" => lookup::match_fn(args),
        "XMATCH" => lookup::xmatch(args),
        "XLOOKUP" => lookup::xlookup(args),
        "VLOOKUP" => lookup::vlookup(args),
        "HLOOKUP" => lookup::hlookup(args),

        // Dynamic Array
        "FILTER" => dynamic_array::filter(args),
        "SORT" => dynamic_array::sort(args),
        "SORTBY" => dynamic_array::sortby(args),
        "UNIQUE" => dynamic_array::unique(args),
        "SEQUENCE" => dynamic_array::sequence(args),
        "TRANSPOSE" => dynamic_array::transpose(args),
        "TAKE" => dynamic_array::take(args),
        "DROP" => dynamic_array::drop(args),

        // Text
        "TEXT" => text::text(args),
        "VALUE" => text::value(args),
        "LEFT" => text::left(args),
        "RIGHT" => text::right(args),
        "MID" => text::mid(args),
        "LEN" => text::len(args),
        "TRIM" => text::trim(args),
        "SUBSTITUTE" => text::substitute(args),
        "REPLACE" => text::replace(args),
        "CONCAT" => text::concat(args),
        "TEXTJOIN" => text::textjoin(args),
        "FIND" => text::find(args),
        "SEARCH" => text::search(args),
        "UPPER" => text::upper(args),
        "LOWER" => text::lower(args),
        "PROPER" => text::proper(args),

        // Date & Time
        "TODAY" => date_time::today(args, now_ms),
        "NOW" => date_time::now(args, now_ms),
        "DATE" => date_time::date(args),
        "YEAR" => date_time::year(args),
        "MONTH" => date_time::month(args),
        "DAY" => date_time::day(args),
        "EDATE" => date_time::edate(args),
        "EOMONTH" => date_time::eomonth(args),
        "NETWORKDAYS" => date_time::networkdays(args),
        "WORKDAY" => date_time::workday(args),

        // Financial
        "PMT" => financial::pmt(args),
        "PV" => financial::pv(args),
        "FV" => financial::fv(args),
        "NPV" => financial::npv(args),
        "IRR" => financial::irr(args),

        // Statistical
        "STDEV.S" => statistical::stdev_s(args),
        "STDEV.P" => statistical::stdev_p(args),
        "VAR.S" => statistical::var_s(args),
        "VAR.P" => statistical::var_p(args),
        "MEDIAN" => statistical::median(args),
        "LARGE" => statistical::large(args),
        "SMALL" => statistical::small(args),
        "RANK.EQ" => statistical::rank_eq(args),

        _ => Err(ErrorCode::Name),
    }
}
