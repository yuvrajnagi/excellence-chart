import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { runJob } from './jobs.js';
import { createId, createWorkbook, DEFAULT_LIMITS } from '@openexcel/model';
import type { Result } from '@openexcel/model';
import { parseCreateWorkbookRequest, parseSaveWorkbookRequest, parseExportRequest, parseImportHttpOptions, parseListWorkbooksQuery } from '@openexcel/model/api';
import { DEFAULT_INTEROP_LIMITS, type ExportResult, type ImportResult } from '@openexcel/interop';
import { WorkbookStore, HttpError } from './storage.js';
const MAX_BODY=128*1024*1024;
function unwrap<T>(result:Result<T>):T { if(!result.ok)throw new HttpError(400,'INVALID_INPUT',result.error.message);return result.value; }
async function body(req:IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw new HttpError(413,'PAYLOAD_TOO_LARGE','Request exceeds 128 MiB');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
async function jsonBody(req:IncomingMessage){if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'UNSUPPORTED_MEDIA','Expected application/json');try{return JSON.parse((await body(req)).toString('utf8')) as unknown;}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'INVALID_INPUT','Malformed JSON');}}
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
export function createApp(store:WorkbookStore,staticDir=resolve('apps/web/dist')){
 const downloads=new Map<string,ExportResult & {expires:number}>();let busy=false;
 const server=createServer(async(req,res)=>{
  const requestId=randomUUID();
  try {
   const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`), path=url.pathname;
   // Local application: requests must originate from the same host. No wildcard CORS.
   if(req.headers.origin){let originHost:string;try{originHost=new URL(req.headers.origin).host;}catch{throw new HttpError(403,'ORIGIN_REJECTED','Invalid request origin');}if(originHost!==req.headers.host)throw new HttpError(403,'ORIGIN_REJECTED','Cross-origin request rejected');}
   if(Number(req.headers['content-length']??0)>MAX_BODY)throw new HttpError(413,'PAYLOAD_TOO_LARGE','Request exceeds 128 MiB');
   if(path==='/api/health')return json(res,200,{status:'ok',apiVersion:1,workbookSchemaVersion:1,limits:DEFAULT_LIMITS,maxBodyBytes:MAX_BODY});
   if(path==='/api/workbooks'&&req.method==='GET'){
    const q=unwrap(parseListWorkbooksQuery({limit:Number(url.searchParams.get('limit')??50),order:url.searchParams.get('order')??'recent',...(url.searchParams.has('cursor')?{cursor:url.searchParams.get('cursor')}:{})}));
    const offset=Number(q.cursor??0);if(!Number.isSafeInteger(offset)||offset<0)throw new HttpError(400,'INVALID_INPUT','Invalid cursor');return json(res,200,store.list(q.limit,offset,q.order));
   }
   if(path==='/api/workbooks'&&req.method==='POST'){
    const data=unwrap(parseCreateWorkbookRequest(await jsonBody(req)));if(data.name.length>255)throw new HttpError(400,'INVALID_INPUT','Name too long');
     const exists=data.kind==='snapshot'&&data.workbook.id?Boolean(store.db?store.db.prepare('SELECT 1 FROM workbooks WHERE id=?').get(data.workbook.id):(()=>{try{store.get(data.workbook.id);return true;}catch{return false;}})()):false;
     const workbook=data.kind==='blank'?createWorkbook({id:createId('workbook'),sheetId:createId('sheet'),name:data.name,timestamp:new Date().toISOString()}):{...data.workbook,id:(data.workbook.id&&!exists)?data.workbook.id:createId('workbook'),properties:{...data.workbook.properties,name:data.name}};
    return json(res,201,store.create(workbook));
   }
   if(path==='/api/workbooks/import'&&req.method==='POST'){
    const options=unwrap(parseImportHttpOptions({format:url.searchParams.get('format'),name:url.searchParams.get('name'),parseCsvFormulas:url.searchParams.get('parseCsvFormulas')==='true',...(url.searchParams.has('delimiter')?{delimiter:url.searchParams.get('delimiter')}:{})}));
    const raw=await body(req);let bytes=new Uint8Array(raw);
    if(req.headers['content-type']?.startsWith('multipart/form-data')){const request=new Request('http://localhost',{method:'POST',headers:{'content-type':req.headers['content-type']},body:raw});let form;try{form=await request.formData();}catch{throw new HttpError(400,'INVALID_INPUT','Malformed multipart upload');}const file=form.get('file');if(!file||typeof file==='string')throw new HttpError(400,'INVALID_INPUT','Missing file');bytes=new Uint8Array(await file.arrayBuffer());}
    if(busy)throw new HttpError(429,'RESOURCE_LIMIT','Another file operation is running');busy=true;
    try {const result=unwrap(await runJob<Result<ImportResult>>('import',{bytes,options:{format:options.format,name:options.name,parseCsvFormulas:options.parseCsvFormulas,...(options.delimiter?{delimiter:options.delimiter}:{}),workbookId:createId('workbook'),firstSheetId:createId('sheet'),timestamp:new Date().toISOString(),limits:DEFAULT_INTEROP_LIMITS}}));store.create(result.workbook);return json(res,200,result);}finally{busy=false;}
   }
   const match=/^\/api\/workbooks\/([^/]+)(\/export)?$/.exec(path);
   if(match){const id=decodeURIComponent(match[1]!);
    if(req.method==='GET'&&!match[2])return json(res,200,store.get(id,true));
    if(req.method==='DELETE'&&!match[2]){store.delete(id);return json(res,200,{ok:true});}
    if(req.method==='PUT'&&!match[2]){const data=unwrap(parseSaveWorkbookRequest(await jsonBody(req)));if(data.workbook.id!==id)throw new HttpError(400,'INVALID_INPUT','Workbook ID mismatch');const version=Number(req.headers['if-match']?.replaceAll('"',''));if(!Number.isSafeInteger(version)||version<1)throw new HttpError(428,'VERSION_CONFLICT','If-Match storage version required');return json(res,200,store.save(data.workbook,version,data.saveId));}
    if(req.method==='POST'&&match[2]){
     const data=unwrap(parseExportRequest(await jsonBody(req))),saved=store.get(id);if(saved.storageVersion!==data.storageVersion)throw new HttpError(409,'VERSION_CONFLICT','Save workbook before exporting',saved.storageVersion);
     if(busy)throw new HttpError(429,'RESOURCE_LIMIT','Another file operation is running');busy=true;
     try {
      const result=unwrap(await runJob<Result<ExportResult>>('export',{...data,workbook:saved.workbook}));
      for(const[token,entry]of downloads)if(entry.expires<Date.now())downloads.delete(token);
      if(downloads.size>=5)downloads.delete(downloads.keys().next().value!);
      const token=randomUUID(),expires=Date.now()+300000;downloads.set(token,{...result,expires});return json(res,200,{token,filename:result.filename,mediaType:result.mediaType,bytes:result.bytes.length,expiresAt:new Date(expires).toISOString(),issues:result.issues});
     }finally{busy=false;}
    }
   }
   if(path.startsWith('/api/export/')&&req.method==='GET'){const token=path.slice('/api/export/'.length),item=downloads.get(token);if(!item||item.expires<Date.now())throw new HttpError(404,'NOT_FOUND','Export expired');res.writeHead(200,{'content-type':item.mediaType,'content-disposition':`attachment; filename="${item.filename}"`,'x-content-type-options':'nosniff'});return res.end(item.bytes);}
   if(path.startsWith('/api/'))throw new HttpError(404,'NOT_FOUND','Endpoint not found');
   if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(405,'INVALID_INPUT','Method not allowed');
   const root=resolve(staticDir);let file=resolve(root,'.'+decodeURIComponent(path));if(file!==root&&!file.startsWith(root+sep))throw new HttpError(403,'INVALID_INPUT','Unsafe path');
   try{if(!(await stat(file)).isFile())file=resolve(root,'index.html');}catch{file=resolve(root,'index.html');}
   let content;try{content=await readFile(file);}catch{throw new HttpError(404,'NOT_FOUND','Frontend not built; run npm run build');}
   const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
   res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:content);
  }catch(error){const e=error instanceof HttpError?error:new HttpError(500,'IO_ERROR','Operation failed; saved workbook remains available');if(!(error instanceof HttpError))console.error('Request failed',requestId,error);json(res,e.status,{error:{code:e.code,message:e.message,requestId,...(e.currentVersion?{currentVersion:e.currentVersion}:{})}});}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;return server;
}
