# Formula compatibility

OpenExcel implements a custom tokenizer, parser, AST interpreter, sparse dependency graph, range bucket index, cached results, and dirty formula scheduler. No formula is executed as JavaScript. This is a supported subset, not a claim of complete Excel equivalence.

Every function below has an ordinary-value fixture, a boundary/error fixture, and invalid-arity coverage in `tests/compatibility`. These fixtures contain explicit expected values; they are not a comparison against a running Microsoft Excel instance. The matrix describes implementation behavior and known differences.

Run `npx tsc -b packages/formula && npx vitest run tests/compatibility packages/formula/test` from the repository root.

| Function | Status | Supported behavior / known differences |
| --- | --- | --- |
| SUM | Implemented subset; tested | Numeric range values; text/boolean literal coercion differs from Excel. |
| AVERAGE | Implemented subset; tested | Numeric values; literal text/boolean coercion differs. |
| MIN | Implemented subset; tested | Numeric values only; empty numeric set gives 0. |
| MAX | Implemented subset; tested | Numeric values only; empty numeric set gives 0. |
| COUNT | Implemented subset; tested | Numeric range values; direct boolean/numeric text arguments counted. |
| COUNTA | Implemented subset; tested | Counts non-null values, including errors and empty strings. |
| COUNTIF | Implemented subset; tested | Single criteria with comparisons and * / ? wildcards; tilde escaping incomplete. |
| COUNTIFS | Implemented subset; tested | Multiple criteria; equal flattened range lengths required. |
| SUMIF | Implemented subset; tested | Single criteria; full Excel range-shape resizing semantics incomplete. |
| SUMIFS | Implemented subset; tested | Multiple criteria; equal flattened range lengths required. |
| AVERAGEIF | Implemented subset; tested | No matching numeric values gives #DIV/0!. |
| IF | Implemented subset; tested | Lazy scalar branches and elementwise array selection with broadcasting. |
| IFS | Implemented subset; tested | Lazy scalar condition/result pairs; array conditions incomplete. |
| AND | Implemented subset; tested | Uses value truthiness; Excel text-in-range coercion differs. |
| OR | Implemented subset; tested | Uses value truthiness; Excel text-in-range coercion differs. |
| NOT | Implemented subset; tested | Scalar numeric/boolean coercion. |
| IFERROR | Implemented subset; tested | Lazy fallback; scalar and elementwise array errors. |
| IFNA | Implemented subset; tested | Replaces #N/A only, including array elements. |
| SWITCH | Implemented subset; tested | Lazy scalar branches; case-sensitive comparison differs from Excel. |
| LET | Implemented subset; tested | Lexical values and closures; bindings evaluated eagerly. |
| LAMBDA | Implemented subset; tested | Inline application, LET-bound and named closures; 64-call nesting limit; no higher-order helper functions. |
| INDEX | Implemented subset; tested | Positive scalar row/column selection; zero index whole-row/column mode incomplete. |
| MATCH | Implemented subset; tested | Exact and nearest numeric/text values; sorted-input/binary semantics differ. |
| XMATCH | Implemented subset; tested | Exact, wildcard, nearest and reverse search; binary search modes use linear implementation. |
| XLOOKUP | Implemented subset; tested | Exact/nearest/wildcard/reverse search and multi-column returns; fallback evaluated eagerly. |
| VLOOKUP | Implemented subset; tested | Exact and approximate search; wildcard matching incomplete. |
| HLOOKUP | Implemented subset; tested | Exact and approximate search; wildcard matching incomplete. |
| FILTER | Implemented subset; tested | Filters rows by one include value per row; column filtering incomplete. |
| SORT | Implemented subset; tested | Row/column sorting, selected index and direction. |
| SORTBY | Implemented subset; tested | Multiple row key vectors and directions; column vectors incomplete. |
| UNIQUE | Implemented subset; tested | Rows/columns, case-insensitive text, exactly-once option. |
| SEQUENCE | Implemented subset; tested | Positive integer dimensions; maximum 1,000,000 elements. |
| TRANSPOSE | Implemented subset; tested | Rectangular array transpose. |
| TAKE | Implemented subset; tested | Positive/negative row and column slicing; empty result #CALC!. |
| DROP | Implemented subset; tested | Positive/negative row and column slicing; empty result #CALC!. |
| CHOOSE | Implemented subset; tested | Lazy scalar index; array index mode incomplete. |
| OFFSET | Implemented subset; tested | Reference or range origin; positive result dimensions, maximum 1,000,000 elements. |
| INDIRECT | Implemented subset; tested | A1 cells/ranges, including sheets; R1C1 mode explicitly #REF!, external workbooks unsupported. |
| TEXT | Implemented subset; tested | Basic decimals, grouping, $, %, yyyy/mm/dd; full Excel custom format grammar incomplete. |
| VALUE | Implemented subset; tested | Numeric strings, dollar signs, grouping commas and percent; locale/date parsing incomplete. |
| LEFT | Implemented subset; tested | Text slicing; UTF-16 code units. |
| RIGHT | Implemented subset; tested | Text slicing; UTF-16 code units. |
| MID | Implemented subset; tested | Text slicing; UTF-16 code units. |
| LEN | Implemented subset; tested | UTF-16 code-unit count; Excel version-dependent Unicode differences. |
| TRIM | Implemented subset; tested | Collapses ASCII spaces; trims additional JavaScript whitespace. |
| SUBSTITUTE | Implemented subset; tested | Case-sensitive replacement, optional occurrence. |
| REPLACE | Implemented subset; tested | Position and count replacement. |
| CONCAT | Implemented subset; tested | Flattened values and arrays. |
| TEXTJOIN | Implemented subset; tested | Delimiter and optional empty-value omission. |
| FIND | Implemented subset; tested | Case-sensitive position search. |
| SEARCH | Implemented subset; tested | Case-insensitive * / ? wildcards; tilde escaping incomplete. |
| UPPER | Implemented subset; tested | JavaScript Unicode case conversion. |
| LOWER | Implemented subset; tested | JavaScript Unicode case conversion. |
| PROPER | Implemented subset; tested | Unicode word-boundary capitalization; locale nuances differ. |
| ROUND | Implemented subset; tested | Half-away-from-zero; floating point decimal boundary behavior may differ. |
| ROUNDUP | Implemented subset; tested | Away-from-zero rounding; IEEE-754 arithmetic. |
| ROUNDDOWN | Implemented subset; tested | Toward-zero rounding; IEEE-754 arithmetic. |
| INT | Implemented subset; tested | Floor toward negative infinity. |
| MOD | Implemented subset; tested | Divisor-sign remainder; zero divisor #DIV/0!. |
| ABS | Implemented subset; tested | Numeric absolute value. |
| POWER | Implemented subset; tested | Exponentiation; non-real/nonfinite result #NUM!. |
| SQRT | Implemented subset; tested | Negative argument #NUM!. |
| RAND | Implemented subset; tested | Volatile; injectable deterministic random epoch. |
| RANDBETWEEN | Implemented subset; tested | Inclusive integer bounds; fractional-bound corner cases differ. |
| TODAY | Implemented subset; tested | UTC date serial; differs from local-time Excel workbooks. |
| NOW | Implemented subset; tested | UTC timestamp serial; injectable evaluation epoch. |
| DATE | Implemented subset; tested | 1900 date system, month/day overflow; historical/date-bound validation incomplete. |
| YEAR | Implemented subset; tested | 1900 serial system; special case serial 60. |
| MONTH | Implemented subset; tested | 1900 serial system; special case serial 60. |
| DAY | Implemented subset; tested | 1900 serial system; fictitious 1900-02-29 serial 60 supported. |
| EDATE | Implemented subset; tested | Month shift clamped to final day; UTC. |
| EOMONTH | Implemented subset; tested | Month-end serial; UTC. |
| NETWORKDAYS | Implemented subset; tested | Saturday/Sunday weekends and holiday list; 1,000,000-day limit. |
| WORKDAY | Implemented subset; tested | Saturday/Sunday weekends and holiday list; 1,000,000 requested workday limit. |
| PMT | Implemented subset; tested | Constant rate/period annuity; optional future value and timing. |
| PV | Implemented subset; tested | Constant rate/period annuity; optional future value and timing. |
| FV | Implemented subset; tested | Constant rate/period annuity; optional present value and timing. |
| NPV | Implemented subset; tested | Periodic discounted cash flows; excludes nonnumeric values. |
| IRR | Implemented subset; tested | Newton iteration with guess; 100 iterations; convergence differs from Excel. |
| STDEV.S | Implemented subset; tested | Sample statistic; at least two numeric values. |
| STDEV.P | Implemented subset; tested | Population statistic; at least one numeric value. |
| VAR.S | Implemented subset; tested | Sample statistic; at least two numeric values. |
| VAR.P | Implemented subset; tested | Population statistic; at least one numeric value. |
| MEDIAN | Implemented subset; tested | Numeric values only; empty set #NUM!. |
| LARGE | Implemented subset; tested | Positive rank selection. |
| SMALL | Implemented subset; tested | Positive rank selection. |
| RANK.EQ | Implemented subset; tested | Ascending/descending rank; equal values share rank. |
| SUBTOTAL | Implemented subset; tested | Codes 1–11 and 101–111 including product; hidden/filtered rows and nested subtotal exclusion incomplete. |

## Engine behavior and limits

- A1 relative, absolute and mixed references; quoted sheet names; workbook and worksheet scoped names; reference adjustment for copy/fill. Structural reference transformations are owned by the workbook model.
- Sparse formula index and reverse dependencies retain cached unaffected results across immutable workbook updates. Recalculation traverses dirty formulas in dependency order; volatile formulas and their dependents are invalidated on explicit recalculation. Updates must provide a new immutable workbook value.
- Range dependencies use 256-row buckets and exact rectangle checks. A formerly blank referenced cell invalidates consumers when edited. Explicit `dependencies()` expands range addresses and can therefore allocate substantially for large ranges.
- Direct-reference chains use an iterative scheduling stack; dynamic/named references use interpreter recursion limited to 256 cell frames. Circular references return the OpenExcel extension `#CIRC!`; iterative circular calculation is unsupported.
- Dynamic arrays spill into empty cells and recover from blockers; downstream consumers are revisited if a spill is discovered after they read a blank. Maximum array/range materialization is 1,000,000 cells. Spill-reference `A1#`, implicit intersection `@`, structured table references, union/intersection references, external workbook references and full-column/row shorthand are incomplete.
- Each formula is limited to 32,768 source characters, parser nesting to 256 and evaluation to 2,000,000 AST steps. Resource failures use `#CALC!` or `#PARSE!`. These errors are deliberately distinct from full Excel behavior.
- Arithmetic array broadcasting and array IF/error fallback are supported. Many other functions use scalar coercion; this is not Excel's complete dynamic-array lifting system.
- Date calculations use UTC and the 1900 date system. The fictitious leap-day serial is special-cased for YEAR/MONTH/DAY; 1904-system workbooks and all historical quirks are not supported.
- Numeric calculations use IEEE-754 doubles. Text collation, error precedence, blank coercion, optional omitted arguments and locale-dependent formatting still differ in edge cases.
- Formula source preserves unsupported expressions during workbook storage/import/export; evaluating unsupported function names returns `#NAME?`.

The `createEngine` API accepts deterministic clock/random options. The legacy `Engine.create` facade uses the default function registry and fixed resource limits; its options argument is currently ignored. `evaluateFormula` accepts a deterministic epoch directly.
