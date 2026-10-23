import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WorkbookStore } from './storage.js';
import { createApp } from './app.js';
const dataDir=resolve(process.env.DATA_DIR??process.env.OPENEXCEL_DATA_DIR??'.data');mkdirSync(dataDir,{recursive:true});
const store=new WorkbookStore(join(dataDir,'openexcel.sqlite'));
const server=createApp(store,resolve(process.env.STATIC_DIR??'apps/web/dist'));
server.listen(Number(process.env.PORT??3001),process.env.HOST??'127.0.0.1',()=>console.log(`OpenExcel listening on http://${process.env.HOST??'127.0.0.1'}:${process.env.PORT??3001}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
