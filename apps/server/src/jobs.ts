import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { HttpError } from './storage.js';
/** CPU-heavy untrusted file operations are terminated on deadline or memory exhaustion. */
export function runJob<T>(name:'import'|'export',data:unknown):Promise<T>{
 const local=new URL(`./${name}-worker.js`,import.meta.url);
 const entry=existsSync(local)?local:new URL(`../dist/${name}-worker.js`,import.meta.url);
 return new Promise((accept,reject)=>{
  const worker=new Worker(entry,{workerData:data,resourceLimits:{maxOldGenerationSizeMb:512}});
  const timer=setTimeout(()=>{void worker.terminate();reject(new HttpError(422,'RESOURCE_LIMIT','File operation exceeded 30 second limit'));},30000);
  worker.once('message',result=>{clearTimeout(timer);accept(result as T);void worker.terminate();});
  worker.once('error',e=>{clearTimeout(timer);reject(e);});
  worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new HttpError(422,'RESOURCE_LIMIT','File worker stopped'));});
 });
}
