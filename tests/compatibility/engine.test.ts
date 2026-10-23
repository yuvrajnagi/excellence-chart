import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyTransaction, createId, createWorkbook } from '@openexcel/model';
import type { Workbook, Patch } from '@openexcel/model';
import { createEngine, adjustFormulaReferences } from '@openexcel/formula';
const sheetId = createId('sheet');
const at = (row: number, col = 0) => ({ sheetId, row, col });
const blank = () => createWorkbook({id:createId('workbook'), sheetId, name:'Engine tests', timestamp:'2024-01-01T00:00:00Z'});
function edit(book: Workbook, cells: [number, number, string | number | null][]) {
  const patches: Patch[] = cells.map(([row,col,value]) => ({kind:'cell', at:at(row,col), cell:{input:typeof value === 'string' && value.startsWith('=') ? {kind:'formula',source:value} : {kind:'value',value}}}));
  const result = applyTransaction(book,{id:createId('transaction'),baseRevision:book.revision,label:'Edit',timestamp:'2024-01-01T00:00:00Z',patches});
  if (!result.ok) throw Error(result.error.message);
  return result.value.workbook;
}
describe('calculation graph and spill regression', () => {
  it('tracks references and invalidates only dependent cached formulas', () => {
    let calls = 0;
    let book = edit(blank(), [[0,0,2],[0,1,'=A1*2'],[0,2,'=B1+1'],[0,3,'=RAND()']]);
    const engine = createEngine(book, {random:()=>++calls/10});
    engine.recalculate();
    expect(engine.value(at(0,2))).toBe(5);
    expect(engine.dependencies(at(0,1))).toContainEqual(at(0));
    expect(engine.value(at(0,3))).toBe(.1);
    book = edit(book,[[0,0,10]]); engine.updateWorkbook(book);
    expect(engine.value(at(0,2))).toBe(21);
    expect(engine.value(at(0,3))).toBe(.1);
    expect(calls).toBe(1);
    engine.recalculate(); expect(calls).toBe(2);
  });
  it('invalidates range references when previously blank cells change', () => {
    let book = edit(blank(),[[0,1,'=SUM(A1:A1000)']]);
    const engine = createEngine(book); engine.recalculate();
    expect(engine.value(at(0,1))).toBe(0);
    book = edit(book,[[750,0,42]]); engine.updateWorkbook(book);
    expect(engine.value(at(0,1))).toBe(42);
  });
  it('removes obsolete dependency edges after changing a formula', () => {
    let book = edit(blank(),[[0,0,1],[0,1,2],[0,2,'=A1']]);
    const engine = createEngine(book); engine.recalculate();
    book = edit(book,[[0,2,'=B1']]); engine.updateWorkbook(book); engine.recalculate();
    expect(engine.dependencies(at(0,2))).toEqual([at(0,1)]);
  });
  it('schedules long direct-reference chains without stack overflow', () => {
    const cells: [number,number,string|number][] = [[0,0,1]];
    for(let row=1;row<5000;row++) cells.push([row,0,`=A${row}+1`]);
    const engine = createEngine(edit(blank(),cells)); engine.recalculate();
    expect(engine.value(at(4999))).toBe(5000);
  });
  it('propagates cycles and can recover after a cycle is broken', () => {
    let book=edit(blank(),[[0,0,'=B1'],[0,1,'=A1'],[0,2,'=A1+1']]);
    const engine=createEngine(book); engine.recalculate();
    expect(engine.value(at(0,2))).toEqual({kind:'error',code:'#CIRC!'});
    book=edit(book,[[0,1,10]]);engine.updateWorkbook(book);engine.recalculate();
    expect(engine.value(at(0,2))).toBe(11);
  });
  it('materializes spill children and recalculates spill-dependent formulas', () => {
    let book=edit(blank(),[[0,0,'=SEQUENCE(3,2)'],[0,3,'=B3*2']]);
    const engine=createEngine(book);engine.recalculate();
    expect(engine.value(at(2,1))).toBe(6);
    expect(engine.value(at(0,3))).toBe(12);
    book=edit(book,[[0,0,'=SEQUENCE(3,2,10)']]);engine.updateWorkbook(book);engine.recalculate();
    expect(engine.value(at(0,3))).toBe(30);
  });
  it('reports blocked spills and recovers when the blocker is removed', () => {
    let book=edit(blank(),[[0,0,'=SEQUENCE(2)'],[1,0,99]]);
    const engine=createEngine(book);engine.recalculate();
    expect(engine.value(at(0))).toEqual({kind:'error',code:'#SPILL!'});
    book=edit(book,[[1,0,null]]);engine.updateWorkbook(book);engine.recalculate();
    expect(engine.value(at(1))).toBe(2);
  });
  it.each([
    ['=Missing!A1','#REF!'],['="text"+1','#VALUE!'],['=-#N/A','#N/A'],
    ['=IF(#N/A,1,2)','#N/A'],['=SUM(A1:XFD1048576)','#CALC!'],
    ['=A1048577','#REF!'],['=XFE1','#REF!'],['=SEQUENCE(1000001)','#CALC!'],
  ])('returns typed errors for %s', (formula,code)=>{
    expect(createEngine(blank()).evaluateFormula(formula,at(0))).toEqual({kind:'error',code});
  });
  it('does not read or depend on unevaluated conditional branches', () => {
    const engine=createEngine(edit(blank(),[[0,0,'=IF(TRUE,7,A1)']]));engine.recalculate();
    expect(engine.value(at(0))).toBe(7);expect(engine.dependencies(at(0))).toEqual([]);
    expect(engine.evaluateFormula('=IFERROR("text"+1,42)',at(0))).toBe(42);
  });
  it('parses nested LET and inline LAMBDA without string splitting', () => {
    const engine=createEngine(blank());
    expect(engine.evaluateFormula('=LET(x,SUM(1,2),y,MAX(4,5),x+y)',at(0))).toBe(8);
    expect(engine.evaluateFormula('=LAMBDA(x,y,x*y)(SUM(1,2),4)',at(0))).toBe(12);
  });
  it('broadcasts arithmetic array operands in both directions', () => {
    const engine=createEngine(blank());
    expect(engine.evaluateFormula('=2*{1;2;3}',at(0))).toEqual({kind:'array',rows:3,cols:1,values:[2,4,6]});
    expect(engine.evaluateFormula('={1;2}+{10,20}',at(0))).toEqual({kind:'array',rows:2,cols:2,values:[11,21,12,22]});
  });
  it('uses reproducible random epochs',()=>{
    const engine=createEngine(blank());
    expect(engine.evaluateFormula('=RAND()+RAND()',at(0),{randomSeed:17})).toBe(engine.evaluateFormula('=RAND()+RAND()',at(0),{randomSeed:17}));
  });
  it('preserves absolute references and quoted strings under arbitrary safe copy offsets',()=>{
    fc.assert(fc.property(fc.integer({min:0,max:1000}), (offset)=>{
      expect(adjustFormulaReferences('=$A$1+A1+"A1"',offset,0)).toBe(`=$A$1+A${offset+1}+"A1"`);
    }));
  });
  it('retains LET bindings through reference and choice functions', () => {
    const engine = createEngine(edit(blank(),[[0,0,10],[1,0,20],[2,0,30]]));
    expect(engine.evaluateFormula('=LET(x,2,CHOOSE(x,5,x+4))',at(0,4))).toBe(6);
    expect(engine.evaluateFormula('=LET(x,"A2",INDIRECT(x))',at(0,4))).toBe(20);
    expect(engine.evaluateFormula('=LET(x,1,SUM(OFFSET(A1:A2,x,0)))',at(0,4))).toBe(50);
  });
  it('evaluates array IF and error replacement element by element', () => {
    const engine = createEngine(blank());
    expect(engine.evaluateFormula('=IF({TRUE;FALSE},{1;2},{3;4})',at(0))).toEqual({kind:'array',rows:2,cols:1,values:[1,4]});
    expect(engine.evaluateFormula('=IFERROR({1;#N/A;3},9)',at(0))).toEqual({kind:'array',rows:3,cols:1,values:[1,9,3]});
    expect(engine.evaluateFormula('=IFNA({#N/A;#DIV/0!},9)',at(0))).toEqual({kind:'array',rows:2,cols:1,values:[9,{kind:'error',code:'#DIV/0!'}]});
  });
  it('revisits cached consumers when a spill is discovered later in sheet order', () => {
    const engine = createEngine(edit(blank(),[[0,0,'=B3*2'],[1,1,'=SEQUENCE(2)']]));
    engine.recalculate(); expect(engine.value(at(0))).toBe(4);
  });
  it('updates the sparse formula index for additions, replacements and deletions', () => {
    let book=edit(blank(),[[0,0,5]]);const engine=createEngine(book);engine.recalculate();
    book=edit(book,[[0,1,'=A1*2']]);engine.updateWorkbook(book);engine.recalculate();
    expect(engine.value(at(0,1))).toBe(10);
    book=edit(book,[[0,1,7],[0,2,'=B1+1']]);engine.updateWorkbook(book);engine.recalculate();
    expect(engine.value(at(0,2))).toBe(8);
    book=edit(book,[[0,1,null]]);engine.updateWorkbook(book);engine.recalculate();
    expect(engine.value(at(0,2))).toBe(1);
  });

});
