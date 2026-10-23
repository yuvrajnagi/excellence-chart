import { blankWorkbook, deleteRow } from '../../apps/web/src/operations.js';
import { getCell } from '../../packages/model/src/index.js';
import type { Workbook } from '../../packages/model/src/index.js';

const wb = blankWorkbook();
const sheetId = wb.sheetOrder[0]!;

// Row 0: A1 = 10
// Row 1: A2 = 20 (this will be deleted)
// Row 2: A3 = 30
// Row 3: A4 = =A1+A2
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
          '2:0': { input: { kind: 'value', value: 30 } },
          '3:0': { input: { kind: 'formula', source: '=A1+A2' } }
        }
      }
    }
  }
};

// Delete row 1 (the second row, containing A2)
const after = deleteRow(setupWb, sheetId, 1, 1);

// Now the formula cell shifted from row 3 (A4) to row 2 (A3)
const formulaCell = getCell(after, { sheetId, row: 2, col: 0 });
console.log('Original formula in A4: =A1+A2');
console.log('Resulting formula in A3 after deleting Row 2 (A2):', formulaCell?.input);
