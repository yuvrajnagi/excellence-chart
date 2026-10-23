# OpenExcel Formula Compatibility Guide

This document details the formula engine language, calculation semantics, and the complete catalog of **88 standard Excel functions** implemented in the Rust core engine ([`crates/openexcel-core`](file:///workspaces/excellence-chart/crates/openexcel-core)).

---

## 1. Syntax & Precedence Specification

OpenExcel's Pratt precedence parser implements standard spreadsheet operator precedence:

| Precedence | Operators | Associativity | Description | Example |
|---|---|---|---|---|
| **9** | `()`, `{}`, Function Calls | N/A | Primary expressions, group parentheses, array literals | `{1, 2; 3, 4}` |
| **8** | `:`, Unary `+`, Unary `-`, `%` | Right (Unary), Left (Postfix) | Range colon, unary sign, postfix percent | `-50%`, `A1:B10` |
| **7** | `^` | **Right** | Exponentiation | `2^3^2 = 512` |
| **5** | `*`, `/` | Left | Multiplication and division | `10 * 5 / 2` |
| **4** | `+`, `-` | Left | Addition and subtraction | `10 + 20 - 5` |
| **3** | `&` | Left | String concatenation | `"Total: " & 42` |
| **2** | `=`, `<>`, `<`, `<=`, `>`, `>=` | Left | Comparison operators | `A1 >= 100` |

---

## 2. Complete 88-Function Compatibility Matrix

### 2.1 Math & Trigonometry (22 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **ABS** | `ABS(number)` | Fully compatible |
| **AVERAGE** | `AVERAGE(val1, [val2], ...)` | Skips empty cells and non-numeric values; returns `#DIV/0!` if empty |
| **AVERAGEIF** | `AVERAGEIF(range, criteria, [avg_range])` | Supports wildcard criteria (`*`, `?`) and inequality expressions |
| **COUNT** | `COUNT(val1, [val2], ...)` | Counts cells containing numeric values |
| **COUNTA** | `COUNTA(val1, [val2], ...)` | Counts non-empty cells |
| **COUNTIF** | `COUNTIF(range, criteria)` | Supports string matching, wildcards, numeric comparisons |
| **COUNTIFS** | `COUNTIFS(range1, crit1, [range2, crit2], ...)` | Multi-range conjunction filtering |
| **INT** | `INT(number)` | Rounds down to the nearest integer |
| **MAX** | `MAX(val1, [val2], ...)` | Returns maximum numeric value |
| **MIN** | `MIN(val1, [val2], ...)` | Returns minimum numeric value |
| **MOD** | `MOD(number, divisor)` | Returns remainder with divisor sign parity; `#DIV/0!` on divisor = 0 |
| **POWER** | `POWER(number, power)` | Equivalent to `^` operator |
| **RAND** | `RAND()` | Returns pseudo-random float in `[0, 1)` |
| **RANDBETWEEN** | `RANDBETWEEN(bottom, top)` | Returns integer in range `[bottom, top]` |
| **ROUND** | `ROUND(number, num_digits)` | Standard half-away-from-zero rounding |
| **ROUNDDOWN** | `ROUNDDOWN(number, num_digits)` | Rounds towards zero |
| **ROUNDUP** | `ROUNDUP(number, num_digits)` | Rounds away from zero |
| **SQRT** | `SQRT(number)` | Returns square root; returns `#NUM!` if number < 0 |
| **SUBTOTAL** | `SUBTOTAL(function_num, ref1, ...)` | Implements all 11 subtotal functions (1=AVERAGE through 11=VAR) |
| **SUM** | `SUM(val1, [val2], ...)` | Sums numbers, skipping text and blanks |
| **SUMIF** | `SUMIF(range, criteria, [sum_range])` | Conditional summation with wildcard and comparison criteria |
| **SUMIFS** | `SUMIFS(sum_range, range1, crit1, ...)` | Multi-condition summation |

### 2.2 Logical Functions (9 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **AND** | `AND(logical1, [logical2], ...)` | True if all arguments truthy |
| **CHOOSE** | `CHOOSE(index_num, value1, [value2], ...)` | Returns nth value; short-circuits unselected branches |
| **IF** | `IF(logical_test, value_if_true, [value_if_false])` | Short-circuits; supports element-wise evaluation over arrays |
| **IFERROR** | `IFERROR(value, value_if_error)` | Catches Excel error codes and substitutes alternative |
| **IFNA** | `IFNA(value, value_if_na)` | Catches `#N/A` errors specifically |
| **IFS** | `IFS(test1, val1, [test2, val2], ...)` | Multi-condition branching |
| **NOT** | `NOT(logical)` | Inverts truth value |
| **OR** | `OR(logical1, [logical2], ...)` | True if any argument truthy |
| **SWITCH** | `SWITCH(expression, val1, result1, ..., [default])` | Expression match branching |

### 2.3 Lookup & Reference Functions (8 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **HLOOKUP** | `HLOOKUP(lookup_value, table_array, row_index, [range_lookup])` | Horizontal table lookup |
| **INDEX** | `INDEX(array, row_num, [column_num])` | Returns value or array slice at 1-based coordinates |
| **INDIRECT** | `INDIRECT(ref_text)` | Resolves dynamic string address or range |
| **MATCH** | `MATCH(lookup_value, lookup_array, [match_type])` | Returns 1-based index (supports 0=exact, 1=less than, -1=greater than) |
| **OFFSET** | `OFFSET(reference, rows, cols, [height], [width])` | Returns dynamic shifted range slice |
| **VLOOKUP** | `VLOOKUP(lookup_value, table_array, col_index, [range_lookup])` | Vertical table lookup with exact and approximate match |
| **XLOOKUP** | `XLOOKUP(lookup_val, lookup_arr, return_arr, [if_not_found], [match_mode], [search_mode])` | Modern lookup supporting reverse searching and custom default |
| **XMATCH** | `XMATCH(lookup_val, lookup_arr, [match_mode], [search_mode])` | Modern index lookup |

### 2.4 Dynamic Array Functions (8 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **DROP** | `DROP(array, rows, [columns])` | Excludes specified rows/columns from start or end |
| **FILTER** | `FILTER(array, include, [if_empty])` | Filters rows matching boolean vector condition |
| **SEQUENCE** | `SEQUENCE(rows, [columns], [start], [step])` | Generates 2D array matrix of sequential numbers |
| **SORT** | `SORT(array, [sort_index], [sort_order], [by_col])` | Sorts array by row or column |
| **SORTBY** | `SORTBY(array, by_array1, [order1], ...)` | Sorts array based on values in companion array |
| **TAKE** | `TAKE(array, rows, [columns])` | Extracts specified rows/columns from start or end |
| **TRANSPOSE** | `TRANSPOSE(array)` | Inverts rows and columns of an array |
| **UNIQUE** | `UNIQUE(array, [by_col], [exactly_once])` | Deduplicates array rows or columns |

### 2.5 Text Functions (16 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **CONCAT** | `CONCAT(text1, [text2], ...)` | Concatenates text strings or array cells |
| **FIND** | `FIND(find_text, within_text, [start_num])` | Case-sensitive substring search (1-based index) |
| **LEFT** | `LEFT(text, [num_chars])` | Returns left characters |
| **LEN** | `LEN(text)` | Returns character count |
| **LOWER** | `LOWER(text)` | Converts text to lowercase |
| **MID** | `MID(text, start_num, num_chars)` | Extracts substring at 1-based position |
| **PROPER** | `PROPER(text)` | Capitalizes first letter of each word |
| **REPLACE** | `REPLACE(old_text, start_num, num_chars, new_text)` | Replaces characters by position |
| **RIGHT** | `RIGHT(text, [num_chars])` | Returns right characters |
| **SEARCH** | `SEARCH(find_text, within_text, [start_num])` | Case-insensitive substring search (supports `*`, `?`) |
| **SUBSTITUTE** | `SUBSTITUTE(text, old_text, new_text, [instance_num])` | Replaces occurrences of substring |
| **TEXT** | `TEXT(value, format_text)` | Number and date formatting with grouping commas (`#,##0.00`, `0.0%`, `YYYY-MM-DD`) |
| **TEXTJOIN** | `TEXTJOIN(delimiter, ignore_empty, text1, ...)` | Joins text strings with delimiter |
| **TRIM** | `TRIM(text)` | Strips leading, trailing, and duplicate inner spaces |
| **UPPER** | `UPPER(text)` | Converts text to uppercase |
| **VALUE** | `VALUE(text)` | Converts numeric text to float |

### 2.6 Date & Time Functions (10 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **DATE** | `DATE(year, month, day)` | Converts Y/M/D to serial; handles day 60 (1900-02-29) leap year quirk |
| **DAY** | `DAY(serial_number)` | Returns day of the month (1–31) |
| **EDATE** | `EDATE(start_date, months)` | Shifts date by N months |
| **EOMONTH** | `EOMONTH(start_date, months)` | Returns serial of the last day of the month |
| **MONTH** | `MONTH(serial_number)` | Returns month (1–12) |
| **NETWORKDAYS**| `NETWORKDAYS(start_date, end_date, [holidays])` | Workdays excluding Saturdays/Sundays and holidays |
| **NOW** | `NOW()` | Returns current serial with fractional day time |
| **TODAY** | `TODAY()` | Returns integer serial for current date at 00:00:00 |
| **WORKDAY** | `WORKDAY(start_date, days, [holidays])` | Calculates future/past working day |
| **YEAR** | `YEAR(serial_number)` | Returns four-digit year |

### 2.7 Financial Functions (5 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **FV** | `FV(rate, nper, pmt, [pv], [type])` | Future value of an investment |
| **IRR** | `IRR(values, [guess])` | Internal rate of return using 100-step Newton-Raphson solver |
| **NPV** | `NPV(rate, value1, [value2], ...)` | Net present value; returns `#DIV/0!` on rate = -1.0 |
| **PMT** | `PMT(rate, nper, pv, [fv], [type])` | Periodic payment for an annuity |
| **PV** | `PV(rate, nper, pmt, [fv], [type])` | Present value of an investment |

### 2.8 Statistical Functions (8 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **LARGE** | `LARGE(array, k)` | Returns kth largest value |
| **MEDIAN** | `MEDIAN(val1, [val2], ...)` | Returns median value |
| **RANK.EQ** | `RANK.EQ(number, ref, [order])` | Returns rank within dataset |
| **SMALL** | `SMALL(array, k)` | Returns kth smallest value |
| **STDEV.P** | `STDEV.P(val1, [val2], ...)` | Population standard deviation (N divisor) |
| **STDEV.S** | `STDEV.S(val1, [val2], ...)` | Sample standard deviation (N-1 divisor) |
| **VAR.P** | `VAR.P(val1, [val2], ...)` | Population variance |
| **VAR.S** | `VAR.S(val1, [val2], ...)` | Sample variance |

### 2.9 Scoped Bindings & Closures (2 Functions)
| Function | Signature | Excel Compatibility Status |
|---|---|---|
| **LAMBDA** | `LAMBDA([param1, ...], body)` | First-class closure; supports recursion up to depth 256 |
| **LET** | `LET(name1, val1, [name2, val2], ..., body)` | Scoped lexical environment for sub-expressions |

---

## 3. Excel Quirks & Specific Handlings

1. **The 1900 Leap Year Anomaly**:
   Historically, Lotus 1-2-3 erroneously treated 1900 as a leap year, which Microsoft Excel retained for backward compatibility. In OpenExcel:
   - Serial number `60.0` maps explicitly to `1900-02-29`.
   - `DATE(1900, 2, 29)` returns serial `60.0`.
   - `YEAR(60) = 1900`, `MONTH(60) = 2`, `DAY(60) = 29`.

2. **Dynamic Array Spills & Collisions**:
   - Spilled arrays write their values to neighboring blank cells.
   - If any cell in the target spill rectangle is non-empty, the anchor cell displays `#SPILL!`.
   - When the blocking cell is cleared or deleted, the spill automatically unblocks and displays.

3. **Circular Reference Cycle Breaking**:
   - Circular chains (`A1 = B1 + 1`, `B1 = A1 + 1`) are detected via DFS traversal and immediately assigned `#CIRC!`.
   - Does not hang the calculation engine or exhaust stack memory.
