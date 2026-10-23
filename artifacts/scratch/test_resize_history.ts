import { createHistory, applyTransaction, createId } from '../../packages/model/src/index.js';
import { blankWorkbook } from '../../apps/web/src/operations.js';

const wb = blankWorkbook();
const hist = createHistory({ maxEntries: 100, maxBytes: 30_000_000 });

// User edits a cell
const editResult = applyTransaction(wb, {
  id: createId('transaction'),
  baseRevision: wb.revision,
  label: 'User typed text in A1',
  timestamp: new Date().toISOString(),
  patches: [{
    kind: 'cell',
    at: { sheetId: wb.sheetOrder[0]!, row: 0, col: 0 },
    cell: { input: { kind: 'value', value: 'Important Data' } }
  }]
});
if (editResult.ok) hist.record(editResult.value.commit);

console.log('History after user edit: canUndo =', hist.canUndo());

// User drags column width (fires mousemove 105 times during drag)
let currentWb = editResult.ok ? editResult.value.workbook : wb;
for (let px = 1; px <= 105; px++) {
  const resizeResult = applyTransaction(currentWb, {
    id: createId('transaction'),
    baseRevision: currentWb.revision,
    label: 'Resize col',
    timestamp: new Date().toISOString(),
    patches: [{
      kind: 'sheetProperties',
      sheetId: wb.sheetOrder[0]!,
      properties: {
        ...currentWb.sheets[wb.sheetOrder[0]!]!.properties,
        columnInfo: { 0: { size: 100 + px } }
      }
    }]
  });
  if (resizeResult.ok) {
    hist.record(resizeResult.value.commit);
    currentWb = resizeResult.value.workbook;
  }
}

// Check if original edit was evicted from undo stack
const snapshot = hist.snapshot();
const hasOriginalEdit = snapshot.undo.some(c => c.transaction.label === 'User typed text in A1');
console.log('Was original user edit preserved in undo stack?:', hasOriginalEdit);
if (!hasOriginalEdit) {
  console.log('BUG CONFIRMED: Dragging resize handle flooded history stack and evicted prior user edits!');
}
