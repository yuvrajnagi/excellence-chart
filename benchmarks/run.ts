import {mkdir,writeFile} from 'node:fs/promises';
import {cpus,totalmem,platform,release} from 'node:os';
import {performance} from 'node:perf_hooks';
import {createId,createWorkbook,parseWorkbook,entries} from '@openexcel/model';
import type {Workbook,Cell,CellKey,TileKey,WorkbookId,SheetId,Scalar} from '@openexcel/model';
import {createEngine} from '@openexcel/formula';
import {exportWorkbook,importWorkbook,DEFAULT_INTEROP_LIMITS} from '@openexcel/interop';
import {challengeWorkbook} from '../samples/challenge.js';

const samples:Record<string,unknown>[]=[];
function measure<T>(name:string,fn:()=>T):T {const start=performance.now();const before=process.memoryUsage();const result=fn();const after=process.memoryUsage();samples.push({name,ms:performance.now()-start,heapDeltaBytes:after.heapUsed-before.heapUsed,rssBytes:after.rss});return result;}
async function measureAsync<T>(name:string,fn:()=>Promise<T>):Promise<T> {const start=performance.now();const before=process.memoryUsage();const result=await fn();const after=process.memoryUsage();samples.push({name,ms:performance.now()-start,heapDeltaBytes:after.heapUsed-before.heapUsed,rssBytes:after.rss});return result;}
function fixture(count:number,formulas=false):Workbook {
 const sheetId=createId('sheet');const base=createWorkbook({id:createId('workbook'),sheetId,name:'Benchmark',timestamp:new Date().toISOString()});
 const tiles:Partial<Record<TileKey,Partial<Record<CellKey,Cell>>>>={};
 const put=(row:number,col:number,cell:Cell)=>{const tk:TileKey=`${Math.floor(row/128)}:${Math.floor(col/32)}`;(tiles[tk]??={})[`${row}:${col}`]=cell;};
 for(let i=0;i<count;i++){
  if(formulas){put(i,0,{input:{kind:'value',value:i}});put(i,1,{input:{kind:'formula',source:`=A${i+1}*2+1`}});}
  else put(Math.floor(i/10),i%10,{input:{kind:'value',value:i}});
 }
 return {...base,sheets:{[sheetId]:{...base.sheets[sheetId]!,tiles}}};
}
function storage(){
 const book=measure('1M cells: construct sparse tiles',()=>fixture(1_000_000));
 const json=measure('1M cells: serialize',()=>JSON.stringify(book));
 samples.push({name:'1M cells: JSON bytes',bytes:Buffer.byteLength(json)});
 const parsed=measure('1M cells: parse JSON and validate schema',()=>parseWorkbook(JSON.parse(json)));
 if(!parsed.ok)throw Error(parsed.error.message);
 const id=parsed.value.sheetOrder[0]!;const engine=measure('1M cells: initialize calculation engine',()=>createEngine(parsed.value));
 if(engine.value({sheetId:id,row:99999,col:9})!==999999)throw Error('Storage fixture did not round trip');engine.dispose();
}
function calculation(){
 const book=measure('100K formulas: construct 200K authored cells',()=>fixture(100_000,true));
 const engine=createEngine(book);const id=book.sheetOrder[0]!;
 measure('100K formulas: cold recalculate',()=>engine.recalculate());
 if(engine.value({sheetId:id,row:99999,col:1})!==199999)throw Error('Calculation incorrect');
 const old=book.sheets[id]!;const tk:TileKey=`${Math.floor(50000/128)}:0`;
 const changed:Workbook={...book,revision:book.revision+1,sheets:{[id]:{...old,tiles:{...old.tiles,[tk]:{...old.tiles[tk],'50000:0':{input:{kind:'value',value:123}}}}}}};
 measure('100K formulas: update one input and recalculate',()=>{engine.updateWorkbook(changed);engine.recalculate();});
 if(engine.value({sheetId:id,row:50000,col:1})!==247)throw Error('Incremental result incorrect');
 measure('100K formulas: read 100K cached results',()=>{for(let row=0;row<100000;row++)engine.value({sheetId:id,row,col:1});});engine.dispose();
}
function buildCache(w:Workbook):Record<string,Partial<Record<CellKey,Scalar>>>{
 const engine=createEngine(w);engine.recalculate();
 const values:Record<string,Partial<Record<CellKey,Scalar>>>={};
 for(const id of w.sheetOrder){
  const cells:Partial<Record<CellKey,Scalar>>={};
  for(const {at} of entries(w,{sheetId:id,top:0,left:0,bottom:1048575,right:16383})){
   const v=engine.value(at);
   cells[`${at.row}:${at.col}`]=typeof v==='object'&&v?.kind==='array'?v.values[0]??null:v;
  }
  values[id]=cells;
 }
 engine.dispose();
 return values;
}
async function interop(){
 const challenge=challengeWorkbook();
 const challengeCache=buildCache(challenge);
 const exported=await measureAsync('XLSX export: challenge workbook (6 sheets)',()=>exportWorkbook(challenge,{file:{format:'xlsx',csvEscapeFormulas:true},cache:{revision:challenge.revision,values:challengeCache},limits:DEFAULT_INTEROP_LIMITS}));
 if(!exported.ok)throw Error(exported.error.message);
 samples.push({name:'XLSX challenge workbook: bytes',bytes:exported.value.bytes.byteLength});
 const imported=await measureAsync('XLSX parse: challenge workbook',()=>importWorkbook(exported.value.bytes,{format:'xlsx',workbookId:createId('workbook') as WorkbookId,firstSheetId:createId('sheet') as SheetId,name:'Benchmark_Import',timestamp:new Date().toISOString(),parseCsvFormulas:false,limits:DEFAULT_INTEROP_LIMITS}));
 if(!imported.ok)throw Error(imported.error.message);
 const data10k=fixture(10_000,true);
 const data10kCache=buildCache(data10k);
 const exported10k=await measureAsync('XLSX export: 10K cells (formulas + values)',()=>exportWorkbook(data10k,{file:{format:'xlsx',csvEscapeFormulas:true},cache:{revision:data10k.revision,values:data10kCache},limits:DEFAULT_INTEROP_LIMITS}));
 if(!exported10k.ok)throw Error(exported10k.error.message);
 samples.push({name:'XLSX 10K cells: bytes',bytes:exported10k.value.bytes.byteLength});
 const imported10k=await measureAsync('XLSX parse: 10K cells',()=>importWorkbook(exported10k.value.bytes,{format:'xlsx',workbookId:createId('workbook') as WorkbookId,firstSheetId:createId('sheet') as SheetId,name:'Benchmark_10K_Import',timestamp:new Date().toISOString(),parseCsvFormulas:false,limits:DEFAULT_INTEROP_LIMITS}));
 if(!imported10k.ok)throw Error(imported10k.error.message);
}
calculation();storage();await interop();
const result={timestamp:new Date().toISOString(),environment:{node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},notes:['Single process, one measured run per operation; no statistical confidence claimed.','Heap delta includes allocations before garbage collection. RSS is process peak-to-date, not workbook-only memory.','UI scrolling measured separately by Playwright; these Node timings do not establish browser responsiveness.'],samples};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
