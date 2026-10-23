import { blankWorkbook, insertRow, deleteRow, insertColumn, deleteColumn, rewriteFormulaReferences } from '../../apps/web/src/operations.js';
import { getCell, TILE_ROWS, TILE_COLUMNS } from '../../packages/model/src/index.js';

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (!condition) {
    console.error(`FAIL [${total}]: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passed++;
  console.log(`PASS [${total}]: ${msg}`);
}

console.log('--- TEST SUITE 1: Multi-Digit Column Shifting in Formulas ---');
{
  const formula1 = '=A1+Z1+AA1+$AB$2+BC10+AAA1';
  // Insert 2 columns at index 26 ('AA')
  const inserted = rewriteFormulaReferences(formula1, 'col', 'insert', 26, 2, ['Sheet1']);
  console.log('Inserted:', inserted);
  assert(inserted.includes('A1'), 'A1 unchanged');
  assert(inserted.includes('Z1'), 'Z1 unchanged');
  assert(inserted.includes('AC1'), 'AA1 shifted to AC1');
  assert(inserted.includes('$AD$2'), '$AB$2 shifted to $AD$2');
  assert(inserted.includes('BE10'), 'BC10 shifted to BE10');
  assert(inserted.includes('AAC1'), 'AAA1 shifted to AAC1');

  // Delete 2 columns at index 26 ('AA' and 'AB')
  const deleted = rewriteFormulaReferences(formula1, 'col', 'delete', 26, 2, ['Sheet1']);
  console.log('Deleted:', deleted);
  assert(deleted.includes('A1'), 'A1 unchanged');
  assert(deleted.includes('Z1'), 'Z1 unchanged');
  assert(deleted.includes('#REF!'), 'AA1 and $AB$2 turned to #REF!');
  assert(deleted.includes('BA10'), 'BC10 shifted down to BA10');
  assert(deleted.includes('ZY1'), 'AAA1 (702) shifted down by 2 to ZY1 (700)');
}

console.log('\n--- TEST SUITE 2: Multi-Digit Row Shifting in Formulas ---');
{
  const formula2 = '=A1+A9+A10+$B$11+C12+D13+E99+F100+G999+H1000';
  // Insert 3 rows at row 9 (1-based row 10)
  const inserted = rewriteFormulaReferences(formula2, 'row', 'insert', 9, 3, ['Sheet1']);
  console.log('Inserted rows:', inserted);
  assert(inserted.includes('A1'), 'A1 unchanged');
  assert(inserted.includes('A9'), 'A9 unchanged');
  assert(inserted.includes('A13'), 'A10 shifted to A13');
  assert(inserted.includes('$B$14'), '$B$11 shifted to $B$14');
  assert(inserted.includes('C15'), 'C12 shifted to C15');
  assert(inserted.includes('D16'), 'D13 shifted to D16');
  assert(inserted.includes('E102'), 'E99 shifted to E102');
  assert(inserted.includes('F103'), 'F100 shifted to F103');
  assert(inserted.includes('G1002'), 'G999 shifted to G1002');
  assert(inserted.includes('H1003'), 'H1000 shifted to H1003');

  // Delete 3 rows at row 9 (rows 10, 11, 12)
  const deleted = rewriteFormulaReferences(formula2, 'row', 'delete', 9, 3, ['Sheet1']);
  console.log('Deleted rows:', deleted);
  assert(deleted.includes('A1'), 'A1 unchanged');
  assert(deleted.includes('A9'), 'A9 unchanged');
  assert(deleted.includes('#REF!'), 'Deleted rows turned into #REF!');
  assert(deleted.includes('D10'), 'D13 shifted down to D10');
  assert(deleted.includes('E96'), 'E99 shifted down to E96');
  assert(deleted.includes('F97'), 'F100 shifted down to F97');
  assert(deleted.includes('G996'), 'G999 shifted down to G996');
  assert(deleted.includes('H997'), 'H1000 shifted down to H997');
}

console.log('\n--- TEST SUITE 3: Boundary Clamping & Max Coordinate Handling ---');
{
  // Boundary column: XFD (16383, 1-based 16384)
  const formulaColBoundary = '=XFD1';
  const shiftedColBoundary = rewriteFormulaReferences(formulaColBoundary, 'col', 'insert', 0, 1, ['Sheet1']);
  console.log('Col boundary shifted:', shiftedColBoundary);
  assert(shiftedColBoundary === '=#REF!', 'Col shifted past XFD becomes #REF!');

  // Boundary row: 1048576 (1048575, 1-based 1048576)
  const formulaRowBoundary = '=A1048576';
  const shiftedRowBoundary = rewriteFormulaReferences(formulaRowBoundary, 'row', 'insert', 0, 1, ['Sheet1']);
  console.log('Row boundary shifted:', shiftedRowBoundary);
  assert(shiftedRowBoundary === '=#REF!', 'Row shifted past 1048576 becomes #REF!');

  // Cell at actual boundary grid limit
  const baseWb = blankWorkbook('BoundaryTest');
  const sheetId = baseWb.sheetOrder[0]!;
  const setupWb = {
    ...baseWb,
    sheets: {
      ...baseWb.sheets,
      [sheetId]: {
        ...baseWb.sheets[sheetId]!,
        tiles: {
          '8191:511': {
            '1048575:16383': { input: { kind: 'value' as const, value: 'extreme-corner' } }
          }
        }
      }
    }
  };
  // Shifting row at 0 pushes cell out of grid
  const resPushRow = insertRow(setupWb, sheetId, 0, 1);
  const droppedCellRow = getCell(resPushRow, { sheetId, row: 1048576, col: 16383 });
  assert(droppedCellRow === undefined, 'Cell pushed beyond row 1048575 dropped safely');

  // Shifting column at 0 pushes cell out of grid
  const resPushCol = insertColumn(setupWb, sheetId, 0, 1);
  const droppedCellCol = getCell(resPushCol, { sheetId, row: 1048575, col: 16384 });
  assert(droppedCellCol === undefined, 'Cell pushed beyond col 16383 dropped safely');
}

console.log('\n--- TEST SUITE 4: Cross-Sheet Reference Prefix Checks ---');
{
  const baseSheetNames = ['Sheet1', 'sheet-id-1'];

  // Other sheet unquoted
  const otherUnquoted = '=Sheet2!A10';
  const resOther1 = rewriteFormulaReferences(otherUnquoted, 'row', 'delete', 0, 5, baseSheetNames);
  assert(resOther1 === '=Sheet2!A10', 'Sheet2!A10 unaffected by Sheet1 delete');

  // Other sheet quoted
  const otherQuoted = "='External Sheet'!B20";
  const resOther2 = rewriteFormulaReferences(otherQuoted, 'col', 'insert', 0, 2, baseSheetNames);
  assert(resOther2 === "='External Sheet'!B20", "'External Sheet'!B20 unaffected by Sheet1 insert");

  // Current sheet unquoted
  const currentUnquoted = '=Sheet1!A10';
  const resCurr1 = rewriteFormulaReferences(currentUnquoted, 'row', 'delete', 0, 1, baseSheetNames);
  assert(resCurr1 === '=Sheet1!A9', 'Sheet1!A10 shifted to Sheet1!A9');

  // Current sheet quoted
  const currentQuoted = "='Sheet1'!A10";
  const resCurr2 = rewriteFormulaReferences(currentQuoted, 'row', 'delete', 0, 1, baseSheetNames);
  assert(resCurr2 === "='Sheet1'!A9", "'Sheet1'!A10 shifted to 'Sheet1'!A9");

  // Current sheet deleted target cell
  const currentDeleted = '=Sheet1!A2';
  const resCurr3 = rewriteFormulaReferences(currentDeleted, 'row', 'delete', 1, 1, baseSheetNames);
  console.log('Current sheet deleted target cell:', resCurr3);
  assert(resCurr3 === '=#REF!', 'Sheet1!A2 turned into #REF!');

  // Current sheet quoted deleted target cell
  const currentQuotedDeleted = "='Sheet1'!A2";
  const resCurr4 = rewriteFormulaReferences(currentQuotedDeleted, 'row', 'delete', 1, 1, baseSheetNames);
  console.log('Current sheet quoted deleted target cell:', resCurr4);
  assert(resCurr4 === '=#REF!', "'Sheet1'!A2 turned into #REF!");

  // Mixed formula with current and cross-sheet references
  const mixedFormula = '=Sheet1!A10 + Sheet2!A10 + Sheet1!A2';
  const resMixed = rewriteFormulaReferences(mixedFormula, 'row', 'delete', 1, 1, baseSheetNames);
  console.log('Mixed formula rewritten:', resMixed);
  assert(resMixed.includes('Sheet1!A9'), 'Sheet1!A10 shifted to Sheet1!A9 in mixed');
  assert(resMixed.includes('Sheet2!A10'), 'Sheet2!A10 preserved untouched in mixed');
  assert(resMixed.includes('#REF!'), 'Sheet1!A2 turned into #REF! in mixed');
}

console.log('\n--- TEST SUITE 5: Tile Key Geometry Across Tile Boundaries ---');
{
  const baseWb = blankWorkbook('TileGeometry');
  const sheetId = baseWb.sheetOrder[0]!;

  // Coordinates spanning multiple tiles:
  // Tile column size = 32 (TILE_COLUMNS)
  // Tile row size = 128 (TILE_ROWS)
  const testCoords = [
    { row: 0, col: 0, val: 'c0_0' },
    { row: 0, col: 31, val: 'c0_31' },
    { row: 0, col: 32, val: 'c0_32' },
    { row: 0, col: 63, val: 'c0_63' },
    { row: 0, col: 64, val: 'c0_64' },
    { row: 0, col: 127, val: 'c0_127' },
    { row: 0, col: 128, val: 'c0_128' },
    { row: 127, col: 50, val: 'c127_50' },
    { row: 128, col: 50, val: 'c128_50' },
    { row: 255, col: 50, val: 'c255_50' },
    { row: 256, col: 50, val: 'c256_50' },
  ];

  let currentWb = baseWb;
  for (const { row, col, val } of testCoords) {
    const tk = `${Math.floor(row / TILE_ROWS)}:${Math.floor(col / TILE_COLUMNS)}`;
    const ck = `${row}:${col}`;
    currentWb = {
      ...currentWb,
      sheets: {
        ...currentWb.sheets,
        [sheetId]: {
          ...currentWb.sheets[sheetId]!,
          tiles: {
            ...currentWb.sheets[sheetId]!.tiles,
            [tk]: {
              ...(currentWb.sheets[sheetId]!.tiles[tk] ?? {}),
              [ck]: { input: { kind: 'value', value: val } }
            }
          }
        }
      }
    };
  }

  // 1. Shift rows down by 2 at row 0
  const afterInsertRow = insertRow(currentWb, sheetId, 0, 2);
  for (const { row, col, val } of testCoords) {
    const cell = getCell(afterInsertRow, { sheetId, row: row + 2, col });
    assert(cell?.input?.value === val, `Row shifted cell (${row+2}, ${col}) found with value ${val}`);
  }

  // 2. Shift columns right by 3 at col 0
  const afterInsertCol = insertColumn(currentWb, sheetId, 0, 3);
  for (const { row, col, val } of testCoords) {
    const cell = getCell(afterInsertCol, { sheetId, row, col: col + 3 });
    assert(cell?.input?.value === val, `Col shifted cell (${row}, ${col+3}) found with value ${val}`);
  }

  // 3. Delete row at row 0 with count 2
  const afterDeleteRow = deleteRow(afterInsertRow, sheetId, 0, 2);
  for (const { row, col, val } of testCoords) {
    const cell = getCell(afterDeleteRow, { sheetId, row, col });
    assert(cell?.input?.value === val, `Row restored cell (${row}, ${col}) found with value ${val}`);
  }

  // 4. Delete col at col 0 with count 3
  const afterDeleteCol = deleteColumn(afterInsertCol, sheetId, 0, 3);
  for (const { row, col, val } of testCoords) {
    const cell = getCell(afterDeleteCol, { sheetId, row, col });
    assert(cell?.input?.value === val, `Col restored cell (${row}, ${col}) found with value ${val}`);
  }
}

console.log('\n--- TEST SUITE 6: Regex Replacement Special Characters ---');
{
  const target = 'Formula references: Alpha and Alpha';
  const query = 'Alpha';
  const specialReplacements = ['$1', '$$', '$&', "$'", '$`', 'Price: $100'];

  for (const rep of specialReplacements) {
    // App.tsx replace logic:
    // matchCase: curr.replace(findText, () => replaceText)
    // caseInsensitive: curr.replace(new RegExp(esc, 'gi'), () => replaceText)
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const result = target.replace(new RegExp(esc, 'g'), () => rep);
    assert(result.includes(rep), `Literal string ${rep} correctly preserved without expansion`);
  }
}

console.log(`\nALL ${passed}/${total} ADVERSARIAL STRESS TESTS PASSED!`);
