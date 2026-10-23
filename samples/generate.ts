import {mkdir,writeFile} from 'node:fs/promises';
import {entries} from '@openexcel/model';
import type {CellKey,Scalar} from '@openexcel/model';
import {createEngine} from '@openexcel/formula';
import {exportWorkbook,DEFAULT_INTEROP_LIMITS} from '@openexcel/interop';
import {challengeWorkbook} from './challenge.js';
const workbook=challengeWorkbook();const engine=createEngine(workbook);engine.recalculate();
const values:Record<string,Partial<Record<CellKey,Scalar>>>={};
for(const id of workbook.sheetOrder){const cells:Partial<Record<CellKey,Scalar>>={};for(const {at} of entries(workbook,{sheetId:id,top:0,left:0,bottom:1048575,right:16383})){const v=engine.value(at);cells[`${at.row}:${at.col}`]=typeof v==='object'&&v?.kind==='array'?v.values[0]??null:v;}values[id]=cells;}
const exported=await exportWorkbook(workbook,{file:{format:'xlsx',csvEscapeFormulas:true},cache:{revision:workbook.revision,values},limits:DEFAULT_INTEROP_LIMITS});
if(!exported.ok)throw Error(exported.error.message);
await mkdir('examples',{recursive:true});await writeFile('examples/Excel_Compatibility_Challenge.json',JSON.stringify(workbook,null,2));await writeFile('examples/Excel_Compatibility_Challenge.xlsx',exported.value.bytes);await writeFile('examples/Excel_Compatibility_Challenge.issues.json',JSON.stringify(exported.value.issues,null,2));
console.log(`Generated challenge workbook: ${workbook.sheetOrder.length} sheets, ${exported.value.bytes.length} bytes; ${exported.value.issues.length} interoperability notices.`);
