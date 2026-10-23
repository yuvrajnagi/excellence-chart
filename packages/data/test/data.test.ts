import {it,expect,describe} from 'vitest';
import fc from 'fast-check';
import {createId,createWorkbook,applyTransaction,getCell} from '@openexcel/model';
import {aggregate,goalSeek,pivotRows,sortRange,removeDuplicates,inferSeries} from '../src/index.js';
import type {Patch,Scalar} from '@openexcel/model';
function fixture(values:Scalar[]){const sheetId=createId('sheet');const blank=createWorkbook({id:createId('workbook'),sheetId,name:'Data',timestamp:new Date().toISOString()});const result=applyTransaction(blank,{id:createId('transaction'),baseRevision:0,label:'Seed',timestamp:new Date().toISOString(),patches:values.map((value,row)=>({kind:'cell',at:{sheetId,row,col:0},cell:{input:{kind:'value',value}}}))});if(!result.ok)throw Error(result.error.message);const workbook=result.value.workbook;return {workbook,range:{sheetId,top:0,left:0,bottom:values.length-1,right:0},reader:{value:({row}: {row:number})=>values[row]??null}};}
describe('data operations',()=>{
 it('sorts numbers stably and clears duplicate tails',()=>{const f=fixture([3,1,3,2]);const patches=sortRange(f.workbook,f.range,[{offset:0,direction:'asc'}],f.reader);expect(patches.map(p=>p.kind==='cell'&&p.cell?.input.kind==='value'?p.cell.input.value:null)).toEqual([1,2,3,3]);const dedup=removeDuplicates(f.workbook,f.range,[0],f.reader);expect(dedup.at(-1)).toMatchObject({cell:null});});
 it('preserves numeric multisets when sorting',()=>fc.assert(fc.property(fc.array(fc.integer(),{minLength:1,maxLength:30}),values=>{const f=fixture(values);const p=sortRange(f.workbook,f.range,[{offset:0,direction:'asc'}],f.reader);expect(p.map(x=>x.kind==='cell'&&x.cell?.input.kind==='value'?x.cell.input.value:null)).toEqual([...values].sort((a,b)=>a-b));}),{numRuns:40}));
 it('pivots multiple dimensions and filters',()=>expect(pivotRows([['North','A',10],['South','A',30],['North','B',20],['North','A',5]],[0],[1],2)).toEqual([['Row 1','A','B'],['North',15,20],['South',30,0]]));
 it('solves goals and reports flat functions',()=>{expect(goalSeek(x=>x*x,25,3)).toMatchObject({converged:true});expect(goalSeek(x=>x*x,25,3).value).toBeCloseTo(5);expect(goalSeek(()=>2,3).converged).toBe(false);});
 it('handles aggregate blanks and inferred series',()=>{expect(aggregate([null,2,4],'average')).toBe(3);expect(inferSeries([{input:{kind:'value',value:2}},{input:{kind:'value',value:4}}],3).map(c=>c.input)).toEqual([6,8,10].map(value=>({kind:'value',value})));});
});

import {refreshPivot} from '../src/index.js';
it('pivot refresh rejects source overlap and materializes aggregate output',()=>{
 const f=fixture(['Sales',10,20]);
 const pivot={id:createId('object'),name:'Pivot1',source:f.range,destination:{sheetId:f.range.sheetId,row:0,col:3},rows:[],columns:[],values:[{offset:0,aggregate:'sum' as const,label:'Sales'}],filters:[],rowTotals:false,columnTotals:false};
 const patches=refreshPivot(f.workbook,pivot,f.reader);
 expect(patches.some(p=>p.kind==='cell'&&p.cell?.input.kind==='value'&&p.cell.input.value===30)).toBe(true);
 expect(()=>refreshPivot(f.workbook,{...pivot,destination:{sheetId:f.range.sheetId,row:0,col:0}},f.reader)).toThrow('overlaps its source');
});
