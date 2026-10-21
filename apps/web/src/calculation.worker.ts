import { createEngine } from '@openexcel/formula';
import type { Workbook, CellAddress } from '@openexcel/model';
let engine:ReturnType<typeof createEngine>|undefined;
self.onmessage=(event:MessageEvent<{id:number;workbook?:Workbook;addresses:CellAddress[]}>)=>{
 const {id,workbook,addresses}=event.data;
 try{if(workbook){if(engine)engine.updateWorkbook(workbook);else engine=createEngine(workbook);engine.recalculate();}
 self.postMessage({id,values:Object.fromEntries(addresses.map(at=>[`${at.sheetId}/${at.row}:${at.col}`,engine?.value(at)??null]))});
 }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
