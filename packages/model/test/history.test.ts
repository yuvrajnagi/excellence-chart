import {it,expect} from 'vitest';
import {applyTransaction,createId,createWorkbook,createHistory,getCell,parseAddress,formatAddress} from '../src/index.js';
import fc from 'fast-check';
it('coordinates round trip across the complete grid',()=>{const sheetId=createId('sheet');fc.assert(fc.property(fc.integer({min:0,max:1048575}),fc.integer({min:0,max:16383}),(row,col)=>{const at={sheetId,row,col};expect(parseAddress(formatAddress(at),sheetId)).toEqual({ok:true,value:at});}));});
it('undo and redo restore values and formatting together',()=>{
 const sheetId=createId('sheet');const workbook=createWorkbook({id:createId('workbook'),sheetId,name:'History',timestamp:new Date().toISOString()});
 const history=createHistory({maxEntries:100,maxBytes:1000000});const styleId=createId('style');const at={sheetId,row:0,col:0};
 const result=applyTransaction(workbook,{id:createId('transaction'),baseRevision:0,label:'Formatted formula',timestamp:new Date().toISOString(),patches:[{kind:'style',styleId,style:{font:{bold:true}}},{kind:'cell',at,cell:{input:{kind:'formula',source:'=2+3'},styleId}}]});
 if(!result.ok)throw Error(result.error.message);expect(history.record(result.value.commit).ok).toBe(true);
 const header=(revision:number)=>({id:createId('transaction'),baseRevision:revision,label:'History',timestamp:new Date().toISOString(),history:'record' as const,validation:'enforce' as const});
 const undo=history.undo(result.value.workbook,header(1));if(!undo.ok)throw Error(undo.error.message);expect(getCell(undo.value.workbook,at)).toBeUndefined();
 const redo=history.redo(undo.value.workbook,header(undo.value.workbook.revision));if(!redo.ok)throw Error(redo.error.message);expect(getCell(redo.value.workbook,at)).toEqual(getCell(result.value.workbook,at));expect(redo.value.workbook.styles[styleId]).toEqual({font:{bold:true}});
});
