import {describe,it,expect} from 'vitest';
import {unzipSync,strFromU8} from 'fflate';
import {entries,getCell} from '@openexcel/model';
import type {CellKey,Scalar} from '@openexcel/model';
import {createEngine} from '@openexcel/formula';
import {challengeWorkbook} from '../../../samples/challenge.js';
import {exportWorkbook,importWorkbook,DEFAULT_INTEROP_LIMITS} from '../src/index.js';

describe('compatibility challenge regression',()=>{
 it('writes standard chart parts, conditional formats and preserves formulas and advanced objects',async()=>{
  const book=challengeWorkbook(),engine=createEngine(book);engine.recalculate();
  const values:Record<string,Partial<Record<CellKey,Scalar>>>={};
  for(const id of book.sheetOrder){const cells:Partial<Record<CellKey,Scalar>>={};for(const {at} of entries(book,{sheetId:id,top:0,left:0,bottom:1048575,right:16383})){const value=engine.value(at);cells[`${at.row}:${at.col}`]=value&&typeof value==='object'&&value.kind==='array'?value.values[0]??null:value;}values[id]=cells;}
  const exported=await exportWorkbook(book,{file:{format:'xlsx',csvEscapeFormulas:true},cache:{revision:book.revision,values},limits:DEFAULT_INTEROP_LIMITS});
  if(!exported.ok)throw Error(exported.error.message);
  const archive=unzipSync(exported.value.bytes),chart=strFromU8(archive['xl/charts/chart1.xml']!);
  expect(chart).toContain('<c:barChart>');expect(chart).toContain('Revenue and net profit');expect(chart).toContain('B2:B6');expect(chart).toContain('<c:v>120000</c:v>');
  expect(strFromU8(archive['xl/worksheets/sheet1.xml']!)).toContain('conditionalFormatting');
  expect(strFromU8(archive['xl/worksheets/_rels/sheet1.xml.rels']!)).toContain('openexcelDrawing1.xml');
  expect(strFromU8(archive['[Content_Types].xml']!)).toContain('/xl/charts/chart1.xml');
  const back=await importWorkbook(exported.value.bytes,{format:'xlsx',workbookId:book.id,firstSheetId:book.sheetOrder[0]!,name:book.properties.name,timestamp:book.properties.createdAt,parseCsvFormulas:false,limits:DEFAULT_INTEROP_LIMITS});
  if(!back.ok)throw Error(back.error.message);
  expect(back.value.workbook.sheetOrder).toEqual(book.sheetOrder);
  for(const id of book.sheetOrder){expect(back.value.workbook.sheets[id]!.properties.charts).toEqual(book.sheets[id]!.properties.charts);expect(back.value.workbook.sheets[id]!.properties.pivots).toEqual(book.sheets[id]!.properties.pivots);expect(back.value.workbook.sheets[id]!.properties.tables).toEqual(book.sheets[id]!.properties.tables);for(const {at,cell} of entries(book,{sheetId:id,top:0,left:0,bottom:1048575,right:16383}))expect(getCell(back.value.workbook,at)).toEqual(cell);}
  const calculated=createEngine(back.value.workbook);calculated.recalculate();expect(calculated.value({sheetId:book.sheetOrder[0]!,row:1,col:1})).toBe(120000);expect(calculated.value({sheetId:book.sheetOrder[2]!,row:6,col:1})).toBe(75);
 });
});
