import { blankWorkbook, insertRow, deleteRow, insertColumn, deleteColumn } from '../../apps/web/src/operations.js';
import { getCell } from '../../packages/model/src/index.js';

const wb = blankWorkbook('Test Workbook');
const sheetId = wb.sheetOrder[0];

const wb1 = {
  ...wb,
  sheets: {
    ...wb.sheets,
    [sheetId]: {
      ...wb.sheets[sheetId],
      properties: {
        ...wb.sheets[sheetId].properties,
        rowInfo: { 5: { size: 50 } },
        columnInfo: { 3: { size: 150 } },
        merges: [{ top: 5, bottom: 6, left: 2, right: 4 }],
        groups: [{ axis: 'row' as const, start: 5, end: 8, collapsed: true }],
        conditionalFormats: [{ id: 'cf1', range: { top: 5, bottom: 8, left: 1, right: 2 }, kind: 'dataBar' as const, min: { kind: 'number' as const, value: 0 }, max: { kind: 'number' as const, value: 100 }, color: '#00FF00', showValue: true, priority: 0, stopIfTrue: false }],
        validations: [{ id: 'v1', range: { top: 5, bottom: 8, left: 1, right: 2 }, kind: 'list' as const, allowBlank: true, severity: 'stop' as const, message: 'msg', source: { kind: 'values' as const, values: ['a', 'b'] } }]
      },
      tiles: {
        '0:0': {
          '0:1': { input: { kind: 'value', value: 100 } },
          '0:2': { input: { kind: 'formula', source: '=B1*2' } }
        }
      }
    }
  }
};

// 1. Insert row at row 3 (before row 5)
const wbRowIns = insertRow(wb1, sheetId, 3, 2);
const sheetRowIns = wbRowIns.sheets[sheetId];
console.log('Row insert: rowInfo', sheetRowIns.properties.rowInfo);
console.log('Row insert: merges', sheetRowIns.properties.merges);
console.log('Row insert: groups', sheetRowIns.properties.groups);
console.log('Row insert: cf', sheetRowIns.properties.conditionalFormats);
console.log('Row insert: val', sheetRowIns.properties.validations);

if (sheetRowIns.properties.rowInfo['7']?.size !== 50) throw new Error('rowInfo index 5 did not shift to 7');
if (sheetRowIns.properties.merges[0].top !== 7 || sheetRowIns.properties.merges[0].bottom !== 8) throw new Error('merges top/bottom did not shift');
if (sheetRowIns.properties.groups[0].start !== 7 || sheetRowIns.properties.groups[0].end !== 10) throw new Error('groups start/end did not shift');

// 2. Insert column at col 1 (shifting col 1 and 2 to 2 and 3)
const wbColIns = insertColumn(wb1, sheetId, 1, 1);
const sheetColIns = wbColIns.sheets[sheetId];
console.log('Col insert: colInfo', sheetColIns.properties.columnInfo);
if (sheetColIns.properties.columnInfo['4']?.size !== 150) throw new Error('colInfo index 3 did not shift to 4');
const c2 = getCell(wbColIns, { sheetId, row: 0, col: 2 });
const c3 = getCell(wbColIns, { sheetId, row: 0, col: 3 });
console.log('C2 (was B1, now C1):', c2?.input);
console.log('C3 (was C1, now D1):', c3?.input);
if (c2?.input?.value !== 100) throw new Error('c2 value mismatch');
if (c3?.input?.kind !== 'formula' || c3?.input?.source !== '=C1*2') throw new Error('c3 formula reference did not shift');

// 3. Delete column at col 1
const wbColDel = deleteColumn(wbColIns, sheetId, 1, 1);
const origC1 = getCell(wbColDel, { sheetId, row: 0, col: 1 });
const origC2 = getCell(wbColDel, { sheetId, row: 0, col: 2 });
console.log('origC1:', origC1?.input);
console.log('origC2:', origC2?.input);
if (origC1?.input?.value !== 100) throw new Error('origC1 mismatch');
if (origC2?.input?.kind !== 'formula' || origC2?.input?.source !== '=B1*2') throw new Error('origC2 formula reference did not revert');

console.log('ALL OPERATION CHECKS PASSED EMPIRICALLY!');
