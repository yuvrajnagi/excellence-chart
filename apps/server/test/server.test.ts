import { describe,it,expect,afterEach } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkbookStore } from '../src/storage.js';
import { createApp } from '../src/app.js';
import type { Workbook } from '@openexcel/model';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
async function fixture(){const dir=mkdtempSync(join(tmpdir(),'openexcel-server-')),path=join(dir,'db.sqlite');const store=new WorkbookStore(path),server=createApp(store);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;cleanups.push(async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true});});return{base,store,path};}
const send=(base:string,path:string,method:string,data:unknown,version?:number)=>fetch(base+path,{method,headers:{'content-type':'application/json',...(version?{'if-match':String(version)}:{})},body:JSON.stringify(data)});
describe('real HTTP and SQLite persistence',()=>{
 it('creates independent workbooks, saves atomically, retries idempotently and detects conflicts',async()=>{
  const{base,store,path}=await fixture();const created=await send(base,'/api/workbooks','POST',{kind:'blank',name:'Budget'});expect(created.status).toBe(201);const envelope=await created.json() as {workbook:Workbook;storageVersion:number};
  await send(base,'/api/workbooks','POST',{kind:'blank',name:'Second'});const list=await(await fetch(base+'/api/workbooks')).json();expect(list.items).toHaveLength(2);
  const workbook={...envelope.workbook,properties:{...envelope.workbook.properties,name:'Saved budget'}},save={workbook,saveId:randomUUID()};
  const response=await send(base,`/api/workbooks/${workbook.id}`,'PUT',save,1);expect(response.status).toBe(200);expect((await response.json()).storageVersion).toBe(2);
  expect((await send(base,`/api/workbooks/${workbook.id}`,'PUT',save,1)).status).toBe(200);
  expect((await send(base,`/api/workbooks/${workbook.id}`,'PUT',{...save,saveId:randomUUID()},1)).status).toBe(409);
  expect((await send(base,`/api/workbooks/${workbook.id}`,'PUT',{...save,workbook:{...workbook,revision:2}},2)).status).toBe(409);
  const reopened=new WorkbookStore(path);expect(reopened.get(workbook.id).workbook.properties.name).toBe('Saved budget');reopened.close();
  expect(store.get(workbook.id).storageVersion).toBe(2);
 });
 it('rejects invalid payloads and origins without damaging persisted data',async()=>{
  const{base}=await fixture();expect((await send(base,'/api/workbooks','POST',{kind:'blank',name:''})).status).toBe(400);
  const r=await fetch(base+'/api/workbooks',{method:'POST',headers:{'content-type':'application/json'},body:'{invalid'});expect(r.status).toBe(400);
  expect((await fetch(base+'/api/health',{headers:{origin:'https://attacker.invalid'}})).status).toBe(403);
  expect((await fetch(base+'/api/workbooks/missing')).status).toBe(404);
 });
 it('imports multipart CSV, exports XLSX through bounded worker and downloads bytes',async()=>{
  const{base}=await fixture();const form=new FormData();form.append('file',new Blob(['Label,Amount\nRevenue,42\nLiteral,=1+1']),'data.csv');
  const r=await fetch(base+'/api/workbooks/import?name=Data&format=csv&parseCsvFormulas=false',{method:'POST',body:form});expect(r.status).toBe(200);const imported=await r.json();
  const saved=await(await send(base,'/api/workbooks','POST',{kind:'snapshot',name:'Data',workbook:imported.workbook})).json();
  const exported=await send(base,`/api/workbooks/${saved.workbook.id}/export`,'POST',{storageVersion:1,file:{format:'xlsx',csvEscapeFormulas:true},calculation:{nowMs:0,randomSeed:42}});
  expect(exported.status).toBe(200);const receipt=await exported.json();const bytes=new Uint8Array(await(await fetch(base+'/api/export/'+receipt.token)).arrayBuffer());expect(Array.from(bytes.slice(0,2))).toEqual([80,75]);
 });
});

describe('durable transactional recovery',()=>{
 it('allows one of two concurrent clients to commit and retains retry receipts after restart',async()=>{
  const{base,path}=await fixture();
  const created=await(await send(base,'/api/workbooks','POST',{kind:'blank',name:'Concurrent'})).json() as {workbook:Workbook};
  const snapshots=['First','Second'].map(name=>({...created.workbook,properties:{...created.workbook.properties,name}}));
  const saveIds=[randomUUID(),randomUUID()];
  const responses=await Promise.all(snapshots.map((workbook,i)=>send(base,`/api/workbooks/${workbook.id}`,'PUT',{workbook,saveId:saveIds[i]},1)));
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const winner=responses.findIndex(r=>r.status===200),saved=await responses[winner]!.json();
  const connection=new WorkbookStore(path);
  expect(connection.get(created.workbook.id).workbook.properties.name).toBe(snapshots[winner]!.properties.name);
  expect(connection.save(connection.get(created.workbook.id).workbook,1,saveIds[winner]!)).toEqual(saved);
  connection.close();
  const restarted=new WorkbookStore(path);expect(restarted.get(created.workbook.id).storageVersion).toBe(2);restarted.close();
 });
 it('rejects malformed origin, corrupt files and stale exports as client errors',async()=>{
  const{base}=await fixture();
  expect((await fetch(base+'/api/health',{headers:{origin:'null'}})).status).toBe(403);
  const corrupt=await fetch(base+'/api/workbooks/import?name=Bad&format=xlsx',{method:'POST',body:'not a workbook'});expect(corrupt.status).toBe(400);
  const created=await(await send(base,'/api/workbooks','POST',{kind:'blank',name:'Good'})).json();
  const exported=await send(base,`/api/workbooks/${created.workbook.id}/export`,'POST',{storageVersion:2,file:{format:'xlsx',csvEscapeFormulas:true},calculation:{nowMs:0,randomSeed:1}});expect(exported.status).toBe(409);
  expect((await(await fetch(base+'/api/health')).json()).maxBodyBytes).toBe(128*1024*1024);
 });
});
