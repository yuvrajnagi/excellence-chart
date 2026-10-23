import { parentPort,workerData } from 'node:worker_threads';
import { importWorkbook,type ImportOptions } from '@openexcel/interop';
const data=workerData as {bytes:Uint8Array;options:ImportOptions};
parentPort!.postMessage(await importWorkbook(data.bytes,data.options));
