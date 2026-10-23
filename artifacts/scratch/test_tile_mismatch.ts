import { blankWorkbook, insertRow, insertColumn, deleteRow, deleteColumn } from '../../apps/web/src/operations.js';
import { getCell } from '../../packages/model/src/index.js';

const wb = blankWorkbook();
const sheetId = wb.sheetOrder[0]!;

// Set a cell at AF1 (row 0, col 32)
// Since TILE_COLUMNS is 32, col 32 is in tile 0:1
const setupWb = {
  ...wb,
  sheets: {
    ...wb.sheets,
    [sheetId]: {
      ...wb.sheets[sheetId]!,
      tiles: {
        '0:1': {
          '0:32': { input: { kind: 'value' as const, value: 'test-col-32' } }
        }
      }
    }
  }
};

console.log('--- 1. Testing insertRow with col 32 ---');
const afterInsRow = insertRow(setupWb, sheetId, 0, 1);
const cellAfterInsRow = getCell(afterInsRow, { sheetId, row: 1, col: 32 });
console.log('After insertRow, getCell(AF2):', cellAfterInsRow);
if (!cellAfterInsRow) console.log('❌ BUG in insertRow: cell lost!');

console.log('--- 2. Testing deleteRow with col 32 ---');
const afterDelRow = deleteRow(afterInsRow, sheetId, 0, 1);
const cellAfterDelRow = getCell(afterDelRow, { sheetId, row: 0, col: 32 });
console.log('After deleteRow, getCell(AF1):', cellAfterDelRow);
if (!cellAfterDelRow) console.log('❌ BUG in deleteRow: cell lost!');

console.log('--- 3. Testing insertColumn with col 32 ---');
const afterInsCol = insertColumn(setupWb, sheetId, 0, 1);
const cellAfterInsCol = getCell(afterInsCol, { sheetId, row: 0, col: 33 });
console.log('After insertColumn, getCell(AG1):', cellAfterInsCol);
if (!cellAfterInsCol) console.log('❌ BUG in insertColumn: cell lost!');

console.log('--- 4. Testing deleteColumn with col 64 ---');
const setupWb64 = {
  ...wb,
  sheets: {
    ...wb.sheets,
    [sheetId]: {
      ...wb.sheets[sheetId]!,
      tiles: {
        '0:2': {
          '0:64': { input: { kind: 'value' as const, value: 'test-col-64' } }
        }
      }
    }
  }
};
const afterDelCol = deleteColumn(setupWb64, sheetId, 0, 1);
const cellAfterDelCol = getCell(afterDelCol, { sheetId, row: 0, col: 63 });
console.log('After deleteColumn, getCell(BL1 col 63):', cellAfterDelCol);
if (!cellAfterDelCol) console.log('❌ BUG in deleteColumn: cell lost!');

