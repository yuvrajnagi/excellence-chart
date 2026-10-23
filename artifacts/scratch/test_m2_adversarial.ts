import { blankWorkbook, rect, contains, rangeAddresses, cellText, insertRow, deleteRow, insertColumn, deleteColumn, axis, fillPatches } from '../../apps/web/src/operations.js';
import { getCell, createWorkbook, createId, applyTransaction } from '../../packages/model/src/index.js';
import type { Workbook, CellRect } from '../../packages/model/src/index.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  } else {
    passed++;
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('=== STARTING M2 ADVERSARIAL STRESS TEST SUITE ===\n');

// -------------------------------------------------------------
// Test 1: Header Drag Resize Logic & Guards
// -------------------------------------------------------------
console.log('--- Test 1: Header Drag Resize Clamping & Axis Logic ---');
{
  const colMin = 20;
  const colMax = 1000;
  const rowMin = 12;
  const rowMax = 500;

  const clampCol = (startWidth: number, delta: number, zoom: number) => {
    return Math.max(colMin, Math.min(colMax, Math.round(startWidth + delta / zoom)));
  };

  const clampRow = (startHeight: number, delta: number, zoom: number) => {
    return Math.max(rowMin, Math.min(rowMax, Math.round(startHeight + delta / zoom)));
  };

  // Extreme negative drag
  assert(clampCol(100, -99999, 1.0) === 20, 'Col width clamped to min 20 on extreme negative drag');
  assert(clampRow(24, -99999, 1.0) === 12, 'Row height clamped to min 12 on extreme negative drag');

  // Extreme positive drag
  assert(clampCol(100, 99999, 1.0) === 1000, 'Col width clamped to max 1000 on extreme positive drag');
  assert(clampRow(24, 99999, 1.0) === 500, 'Row height clamped to max 500 on extreme positive drag');

  // Zoom scaling behavior
  // At zoom = 2.0, dragging 50 screen pixels should equal 25 sheet pixels
  assert(clampCol(100, 50, 2.0) === 125, 'Zoom 2.0 correctly scales column delta by 0.5');
  // At zoom = 0.5, dragging 50 screen pixels should equal 100 sheet pixels
  assert(clampCol(100, 50, 0.5) === 200, 'Zoom 0.5 correctly scales column delta by 2.0');

  // Test axis calculations with resized columns
  const columnInfo = {
    0: { size: 50 },
    5: { size: 250 },
    10: { hidden: true }
  };
  const ax = axis(100, columnInfo, 100, 1.0);
  assert(ax.size(0) === 50, 'Axis reports custom size 50 for col 0');
  assert(ax.size(1) === 100, 'Axis reports default size 100 for col 1');
  assert(ax.size(5) === 250, 'Axis reports custom size 250 for col 5');
  assert(ax.size(10) === 0, 'Axis reports size 0 for hidden col 10');
  assert(ax.position(0) === 0, 'Position of col 0 is 0');
  assert(ax.position(1) === 50, 'Position of col 1 is 50');
  assert(ax.position(2) === 150, 'Position of col 2 is 150');
}

// -------------------------------------------------------------
// Test 2: Whole Row & Column Selection Logic
// -------------------------------------------------------------
console.log('\n--- Test 2: Whole Row & Column Selection Math ---');
{
  // Whole column selection: row 0..1048575, col 3
  const colSelection: CellRect = rect({ row: 0, col: 3 }, { row: 1048575, col: 3 });
  assert(colSelection.top === 0 && colSelection.bottom === 1048575, 'Col selection spans full row height 0..1048575');
  assert(colSelection.left === 3 && colSelection.right === 3, 'Col selection bounded to col 3');
  assert(contains(colSelection, 500000, 3), 'Col selection contains cell at row 500000, col 3');
  assert(!contains(colSelection, 500000, 4), 'Col selection does NOT contain cell at col 4');

  // Whole row selection: row 7, col 0..16383
  const rowSelection: CellRect = rect({ row: 7, col: 0 }, { row: 7, col: 16383 });
  assert(rowSelection.left === 0 && rowSelection.right === 16383, 'Row selection spans full column width 0..16383');
  assert(rowSelection.top === 7 && rowSelection.bottom === 7, 'Row selection bounded to row 7');
  assert(contains(rowSelection, 7, 8000), 'Row selection contains cell at row 7, col 8000');
  assert(!contains(rowSelection, 8, 8000), 'Row selection does NOT contain cell at row 8');

  // Whole sheet selection: 0..1048575, 0..16383
  const sheetSelection: CellRect = rect({ row: 0, col: 0 }, { row: 1048575, col: 16383 });
  assert(contains(sheetSelection, 1048575, 16383), 'Corner selection contains last cell XFD1048576');

  // Safety guard check: rangeAddresses throws when > 100,000 cells requested
  let threw = false;
  try {
    rangeAddresses('sheet-1', colSelection);
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('limited to 100,000 cells'), 'rangeAddresses blocks interactive operations exceeding 100k cells');
  }
  assert(threw, 'rangeAddresses correctly threw for full column selection');
}

// -------------------------------------------------------------
// Test 3: Find & Replace Search Navigation, Match Case, Regex Escaping, Replace All
// -------------------------------------------------------------
console.log('\n--- Test 3: Find & Replace Logic & Edge Cases ---');
{
  const cellMatches = (text: string, query: string, cCase: boolean, exact: boolean) => {
    if (!query) return false;
    const t = cCase ? text : text.toLowerCase();
    const q = cCase ? query : query.toLowerCase();
    return exact ? t === q : t.includes(q);
  };

  // Case sensitivity tests
  assert(cellMatches('Hello World', 'hello', false, false) === true, 'Case-insensitive substring match');
  assert(cellMatches('Hello World', 'hello', true, false) === false, 'Case-sensitive substring mismatch');
  assert(cellMatches('Hello World', 'Hello', true, false) === true, 'Case-sensitive substring match');

  // Exact cell match tests
  assert(cellMatches('Hello World', 'Hello', false, true) === false, 'Exact cell match rejects prefix');
  assert(cellMatches('Hello', 'Hello', true, true) === true, 'Exact cell match accepts full string');
  assert(cellMatches('hello', 'HELLO', false, true) === true, 'Exact cell match case-insensitive');

  // Regex special characters escaping in search & replace
  const specialQueries = [
    'price (USD)',
    '10.5% * [max]',
    'C:\\Users\\test',
    'value $100',
    'formula =A1+B1^2',
    'hello? (world)'
  ];

  for (const sq of specialQueries) {
    const esc = sq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(esc, 'gi');
    const sampleText = `prefix ${sq} suffix and another ${sq}`;
    const replaced = sampleText.replace(regex, 'REPLACED');
    assert(
      replaced === 'prefix REPLACED suffix and another REPLACED',
      `Regex escaping correctly handles special pattern: "${sq}"`
    );
  }

  // Navigation ordering and wrap-around test
  const matches = [
    { row: 1, col: 2, text: 'match1' },
    { row: 3, col: 5, text: 'match2' },
    { row: 10, col: 1, text: 'match3' }
  ];

  const findNext = (active: { row: number; col: number }) => {
    return matches.find(c => c.row > active.row || (c.row === active.row && c.col > active.col)) ?? matches[0]!;
  };

  const findPrev = (active: { row: number; col: number }) => {
    return [...matches].reverse().find(c => c.row < active.row || (c.row === active.row && c.col < active.col)) ?? matches[matches.length - 1]!;
  };

  // Test from before first match
  assert(findNext({ row: 0, col: 0 }) === matches[0], 'Find next from top returns match1');
  // Test from between match1 and match2
  assert(findNext({ row: 1, col: 2 }) === matches[1], 'Find next from match1 returns match2');
  // Test wrap around from match3
  assert(findNext({ row: 10, col: 1 }) === matches[0], 'Find next from match3 wraps around to match1');
  // Test wrap around backward from match1
  assert(findPrev({ row: 1, col: 2 }) === matches[2], 'Find prev from match1 wraps around to match3');
  // Test find prev from match2
  assert(findPrev({ row: 3, col: 5 }) === matches[0], 'Find prev from match2 returns match1');
}

// -------------------------------------------------------------
// Test 4: Sheet Tab Reordering Across Edge Tabs
// -------------------------------------------------------------
console.log('\n--- Test 4: Sheet Tab Reordering Boundary Conditions ---');
{
  const reorder = (order: string[], activeSheetId: string, direction: -1 | 1): string[] | null => {
    const idx = order.indexOf(activeSheetId);
    if (idx === -1) return null;
    const target = idx + direction;
    if (target < 0 || target >= order.length) return null;
    const next = [...order];
    const [removed] = next.splice(idx, 1);
    next.splice(target, 0, removed!);
    return next;
  };

  const order3 = ['sheet-A', 'sheet-B', 'sheet-C'];

  // Left move on first sheet should be blocked
  assert(reorder(order3, 'sheet-A', -1) === null, 'Left move on first sheet returns null (no-op)');

  // Right move on last sheet should be blocked
  assert(reorder(order3, 'sheet-C', 1) === null, 'Right move on last sheet returns null (no-op)');

  // Move middle sheet left
  const movedLeft = reorder(order3, 'sheet-B', -1);
  assert(movedLeft !== null && movedLeft[0] === 'sheet-B' && movedLeft[1] === 'sheet-A' && movedLeft[2] === 'sheet-C', 'Middle sheet B moved left becomes first');

  // Move middle sheet right
  const movedRight = reorder(order3, 'sheet-B', 1);
  assert(movedRight !== null && movedRight[0] === 'sheet-A' && movedRight[1] === 'sheet-C' && movedRight[2] === 'sheet-B', 'Middle sheet B moved right becomes last');

  // Single sheet workbook
  const order1 = ['sheet-A'];
  assert(reorder(order1, 'sheet-A', -1) === null, 'Single sheet workbook cannot move left');
  assert(reorder(order1, 'sheet-A', 1) === null, 'Single sheet workbook cannot move right');
}

// -------------------------------------------------------------
// Test 5: Fill Handle Series Generation & Formula References
// -------------------------------------------------------------
console.log('\n--- Test 5: Fill Handle Behavior ---');
{
  const wb = blankWorkbook();
  const sheetId = wb.sheetOrder[0]!;

  // Fill numeric series: A1=10, A2=20 -> drag to A4
  const setupWb: Workbook = {
    ...wb,
    sheets: {
      ...wb.sheets,
      [sheetId]: {
        ...wb.sheets[sheetId]!,
        tiles: {
          '0:0': {
            '0:0': { input: { kind: 'value', value: 10 } },
            '1:0': { input: { kind: 'value', value: 20 } },
            '0:1': { input: { kind: 'formula', source: '=A1*2' } }
          }
        }
      }
    }
  };

  // Test numeric linear extrapolation
  const patches = fillPatches(setupWb, sheetId, { top: 0, bottom: 1, left: 0, right: 0 }, { top: 0, bottom: 3, left: 0, right: 0 });
  const row2Patch = patches.find(p => p.at.row === 2 && p.at.col === 0);
  const row3Patch = patches.find(p => p.at.row === 3 && p.at.col === 0);
  assert(row2Patch?.cell?.input.value === 30, 'Fill handle extrapolated A3 = 30');
  assert(row3Patch?.cell?.input.value === 40, 'Fill handle extrapolated A4 = 40');

  // Test formula fill down: B1 is '=A1*2', drag to B3
  const formulaPatches = fillPatches(setupWb, sheetId, { top: 0, bottom: 0, left: 1, right: 1 }, { top: 0, bottom: 2, left: 1, right: 1 });
  const b2Patch = formulaPatches.find(p => p.at.row === 1 && p.at.col === 1);
  const b3Patch = formulaPatches.find(p => p.at.row === 2 && p.at.col === 1);
  assert(b2Patch?.cell?.input.source === '=A2*2', 'Fill handle adjusted B2 formula to =A2*2');
  assert(b3Patch?.cell?.input.source === '=A3*2', 'Fill handle adjusted B3 formula to =A3*2');
}

// -------------------------------------------------------------
// Test 6: Row/Column Insert/Delete at Boundaries (Row 0, Col 0, Multi-tile)
// -------------------------------------------------------------
console.log('\n--- Test 6: Boundary Row & Column Insert/Delete Across Tiles ---');
{
  const wb = blankWorkbook();
  const sheetId = wb.sheetOrder[0]!;

  // Place cells in tile 0:0 and tile 1:1 (row 130, col 70)
  const multiTileWb: Workbook = {
    ...wb,
    sheets: {
      ...wb.sheets,
      [sheetId]: {
        ...wb.sheets[sheetId]!,
        tiles: {
          '0:0': {
            '0:0': { input: { kind: 'value', value: 'top-left' } },
            '10:5': { input: { kind: 'formula', source: '=A1+1' } }
          },
          '1:2': {
            '130:70': { input: { kind: 'value', value: 'deep-cell' } }
          }
        }
      }
    }
  };

  // Insert 5 rows at row 0 (top of sheet)
  const afterIns = insertRow(multiTileWb, sheetId, 0, 5);
  const oldTop = getCell(afterIns, { sheetId, row: 0, col: 0 });
  const newTop = getCell(afterIns, { sheetId, row: 5, col: 0 });
  const shiftedFormula = getCell(afterIns, { sheetId, row: 15, col: 5 });
  const shiftedDeep = getCell(afterIns, { sheetId, row: 135, col: 70 });

  console.log('shiftedDeep:', shiftedDeep);
  console.log('afterIns tiles:', JSON.stringify(afterIns.sheets[sheetId]!.tiles));
  assert(oldTop === undefined, 'Row 0 is now empty after inserting at row 0');
  assert(newTop?.input.value === 'top-left', 'Original cell shifted from row 0 to row 5');
  assert(shiftedFormula?.input.kind === 'formula', 'Formula preserved');
  assert(shiftedFormula?.input.source === '=A6+1', 'Formula reference adjusted from =A1+1 to =A6+1');
  assert(shiftedDeep?.input.value === 'deep-cell', 'Deep cell across tile boundary shifted row 130 -> 135');

  // Now delete 5 rows at row 0 to revert
  const afterDel = deleteRow(afterIns, sheetId, 0, 5);
  const revertedTop = getCell(afterDel, { sheetId, row: 0, col: 0 });
  const revertedFormula = getCell(afterDel, { sheetId, row: 10, col: 5 });
  const revertedDeep = getCell(afterDel, { sheetId, row: 130, col: 70 });

  assert(revertedTop?.input.value === 'top-left', 'Cell restored to row 0 after deleting 5 rows');
  assert(revertedFormula?.input.source === '=A1+1', 'Formula restored to =A1+1');
  assert(revertedDeep?.input.value === 'deep-cell', 'Deep cell restored to row 130');
}

console.log(`\n=================================================`);
console.log(`SUMMARY: ${passed} passed, ${failed} failed.`);
console.log(`=================================================`);
