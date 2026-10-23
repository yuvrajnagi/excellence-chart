import { parentPort, workerData } from 'node:worker_threads';
import { createEngine, scalar } from '@openexcel/formula';
import { entries } from '@openexcel/model';
import type { CellKey, Scalar, Workbook, FileOptions } from '@openexcel/model';
import { exportWorkbook, DEFAULT_INTEROP_LIMITS } from '@openexcel/interop';
const {workbook,file,calculation}=workerData as {workbook:Workbook;file:FileOptions;calculation:{nowMs:number;randomSeed:number}};
let seed=calculation.randomSeed;
const engine=createEngine(workbook,{nowMs:calculation.nowMs,random:()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;}});
const values:Record<string,Partial<Record<CellKey,Scalar>>>={};
for(const id of workbook.sheetOrder){const sheet:Partial<Record<CellKey,Scalar>>={};values[id]=sheet;for(const {at,cell} of entries(workbook,{sheetId:id,top:0,left:0,bottom:1048575,right:16383}))if(cell.input.kind==='formula')sheet[`${at.row}:${at.col}`]=scalar(engine.value(at));}
parentPort!.postMessage(await exportWorkbook(workbook,{file,cache:{revision:workbook.revision,values},limits:DEFAULT_INTEROP_LIMITS}));
