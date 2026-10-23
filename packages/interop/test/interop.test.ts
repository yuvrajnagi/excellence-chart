import { describe,it,expect } from 'vitest';
import { createId, createWorkbook, getCell } from '@openexcel/model';
import { importWorkbook,exportWorkbook,DEFAULT_INTEROP_LIMITS,parseDelimited } from '../src/index.js';
import { zipSync,strToU8,unzipSync,strFromU8 } from 'fflate';
import ExcelJS from 'exceljs';
function options(format:'csv'|'xlsx'='csv'){return{format,workbookId:createId('workbook'),firstSheetId:createId('sheet'),name:'Roundtrip',timestamp:'2026-01-01T00:00:00.000Z',parseCsvFormulas:false,limits:DEFAULT_INTEROP_LIMITS};}
describe('file interoperability',()=>{
 it('handles quoted multiline fields, escaped quotes, CRLF and malformed CSV',()=>{expect(parseDelimited('"a,b","one\ntwo"\r\n"a""b",42',',')).toEqual([['a,b','one\ntwo'],['a"b','42']]);expect(()=>parseDelimited('"unclosed',',')).toThrow();});
 it('preserves literal formula-like CSV text and escapes it on export',async()=>{const o=options(),r=await importWorkbook(strToU8('=1+1,42'),o);expect(r.ok).toBe(true);if(!r.ok)return;expect(getCell(r.value.workbook,{sheetId:o.firstSheetId,row:0,col:0})?.input).toEqual({kind:'value',value:'=1+1'});const out=await exportWorkbook(r.value.workbook,{file:{format:'csv',sheetId:o.firstSheetId,csvEscapeFormulas:true},cache:{revision:0,values:{}},limits:DEFAULT_INTEROP_LIMITS});expect(out.ok).toBe(true);if(out.ok)expect(new TextDecoder().decode(out.value.bytes)).toBe('"\'=1+1","42"');});
 it('round trips cell values and names through XLSX',async()=>{const o=options(),r=await importWorkbook(strToU8('Label,42\nNext,18'),o);if(!r.ok)throw Error(r.error.message);const out=await exportWorkbook(r.value.workbook,{file:{format:'xlsx',csvEscapeFormulas:true},cache:{revision:0,values:{}},limits:DEFAULT_INTEROP_LIMITS});if(!out.ok)throw Error(out.error.message);const back=await importWorkbook(out.value.bytes,options('xlsx'));expect(back.ok).toBe(true);if(back.ok)expect(getCell(back.value.workbook,{sheetId:back.value.workbook.sheetOrder[0]!,row:0,col:1})?.input).toEqual({kind:'value',value:42});});
 it('rejects corrupt archives, traversal, expansion bombs and external XML',async()=>{
  for(const bytes of [strToU8('not zip'),zipSync({'../evil':strToU8('x')}),zipSync({'huge.xml':new Uint8Array(200000)}),zipSync({'evil.xml':strToU8('<!DOCTYPE x>')})]){const r=await importWorkbook(bytes,options('xlsx'));expect(r.ok).toBe(false);}
 });
});

 it('exports native cell formatting independently of the private extension',async()=>{
  const o=options(),imported=await importWorkbook(strToU8('42'),o);if(!imported.ok)throw Error(imported.error.message);
  const book=imported.value.workbook,styleId=createId('style'),sheet=book.sheets[o.firstSheetId]!;
  const formatted={...book,styles:{[styleId]:{font:{bold:true,color:'#123456',size:14},fill:'#ABCDEF',numberFormat:'0.00%',borders:{bottom:{style:'double' as const,color:'#008800'}},wrap:true}},sheets:{...book.sheets,[o.firstSheetId]:{...sheet,tiles:{'0:0':{'0:0':{input:{kind:'value' as const,value:42},styleId}}}}}};
  const output=await exportWorkbook(formatted,{file:{format:'xlsx',csvEscapeFormulas:true},cache:{revision:0,values:{}},limits:DEFAULT_INTEROP_LIMITS});if(!output.ok)throw Error(output.error.message);
  const native=new ExcelJS.Workbook();await native.xlsx.load(Buffer.from(output.value.bytes) as never);const cell=native.worksheets[0]!.getCell('A1');expect(cell.font.bold).toBe(true);expect(cell.border.bottom?.style).toBe('double');expect(cell.numFmt).toBe('0.00%');
  const edited=unzipSync(output.value.bytes);
  edited['xl/worksheets/sheet1.xml']=strToU8(strFromU8(edited['xl/worksheets/sheet1.xml']!).replace('<v>42</v>','<v>99</v>'));
  edited['xl/styles.xml']=strToU8(strFromU8(edited['xl/styles.xml']!).replace('<b/>',''));
  const changed=await importWorkbook(zipSync(edited),options('xlsx'));if(!changed.ok)throw Error(changed.error.message);
  expect(changed.value.issues.some(i=>i.message.includes('Stale or unverifiable'))).toBe(true);
  const editedCell=getCell(changed.value.workbook,{sheetId:changed.value.workbook.sheetOrder[0]!,row:0,col:0});
  expect(editedCell?.input).toEqual({kind:'value',value:99});expect(changed.value.workbook.styles[editedCell!.styleId!]!.font?.bold).not.toBe(true);
  const archive=unzipSync(output.value.bytes);delete archive['openexcel/workbook.json'];const back=await importWorkbook(zipSync(archive),options('xlsx'));if(!back.ok)throw Error(back.error.message);const restored=getCell(back.value.workbook,{sheetId:back.value.workbook.sheetOrder[0]!,row:0,col:0});expect(back.value.workbook.styles[restored!.styleId!]!.borders?.bottom).toEqual({style:'double',color:'#008800'});
 });

 it('exports all 9 chart types to DrawingML natively', async () => {
  const o = options(), imported = await importWorkbook(strToU8('10,20\n30,40\n50,60'), o);
  if (!imported.ok) throw Error(imported.error.message);
  const book = imported.value.workbook, sheetId = o.firstSheetId, sheet = book.sheets[sheetId]!;
  const kinds = ['column', 'bar', 'line', 'area', 'scatter', 'pie', 'donut', 'histogram', 'combo'] as const;
  const charts = kinds.map((kind, idx) => ({
    id: createId('object'),
    kind,
    title: `${kind} Chart`,
    series: [
      { id: createId('object'), name: 'Series 1', values: { sheetId, top: 0, left: 0, bottom: 2, right: 0 }, categories: { sheetId, top: 0, left: 1, bottom: 2, right: 1 }, axis: 'primary' as const, color: '#19876b' },
      ...(kind === 'combo' ? [{ id: createId('object'), name: 'Series 2', values: { sheetId, top: 0, left: 1, bottom: 2, right: 1 }, axis: 'primary' as const, color: '#539ee3' }] : []),
    ],
    anchor: { row: idx * 10, col: 3, offsetX: 0, offsetY: 0, width: 400, height: 250 },
    axes: { x: { title: 'X', logarithmic: false, numberFormat: 'General', gridlines: true }, y: { title: 'Y', logarithmic: false, numberFormat: 'General', gridlines: true } },
    legend: 'bottom' as const, showHidden: false, blankAs: 'zero' as const, stacked: false, background: '#FFFFFF',
  }));
  const withCharts = { ...book, sheets: { ...book.sheets, [sheetId]: { ...sheet, properties: { ...sheet.properties, charts } } } };
  const exported = await exportWorkbook(withCharts, { file: { format: 'xlsx', csvEscapeFormulas: true }, cache: { revision: 0, values: {} }, limits: DEFAULT_INTEROP_LIMITS });
  expect(exported.ok).toBe(true);
  if (!exported.ok) return;
  expect(exported.value.issues.filter(i => i.feature === 'chart')).toEqual([]);
  const files = unzipSync(exported.value.bytes);
  for (let i = 1; i <= 9; i++) {
    expect(files[`xl/charts/chart${i}.xml`]).toBeDefined();
  }
  const chartXmls = kinds.map((_, i) => strFromU8(files[`xl/charts/chart${i + 1}.xml`]!));
  expect(chartXmls[0]).toContain('<c:barChart>');
  expect(chartXmls[0]).toContain('<c:barDir val="col"/>');
  expect(chartXmls[1]).toContain('<c:barChart>');
  expect(chartXmls[1]).toContain('<c:barDir val="bar"/>');
  expect(chartXmls[2]).toContain('<c:lineChart>');
  expect(chartXmls[3]).toContain('<c:areaChart>');
  expect(chartXmls[4]).toContain('<c:scatterChart>');
  expect(chartXmls[5]).toContain('<c:pieChart>');
  expect(chartXmls[6]).toContain('<c:doughnutChart>');
  expect(chartXmls[6]).toContain('<c:holeSize val="50"/>');
  expect(chartXmls[7]).toContain('<c:barChart>');
  expect(chartXmls[7]).toContain('<c:barDir val="col"/>');
  expect(chartXmls[7]).toContain('<c:strLit>');
  expect(chartXmls[8]).toContain('<c:barChart>');
  expect(chartXmls[8]).toContain('<c:lineChart>');

  const back = await importWorkbook(exported.value.bytes, options('xlsx'));
  expect(back.ok).toBe(true);
  if (back.ok) {
    expect(back.value.workbook.sheets[sheetId]?.properties.charts.length).toBe(9);
  }
 });

