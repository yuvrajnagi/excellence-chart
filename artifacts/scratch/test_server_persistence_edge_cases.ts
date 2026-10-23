import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkbookStore } from '../../apps/server/src/storage.js';
import { createApp } from '../../apps/server/src/app.js';
import { createId, createWorkbook } from '@openexcel/model';
import type { Workbook } from '@openexcel/model';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  const start = performance.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: performance.now() - start });
    console.log(`✓ ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.stack || err.message, durationMs: performance.now() - start });
    console.error(`✗ ${name}:`, err);
  }
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'openexcel-challenge-'));
  const dbPath = join(dir, 'test.sqlite');
  const store = new WorkbookStore(dbPath);
  const server = createApp(store);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const cleanup = async () => {
    await new Promise<void>(r => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { base, store, dbPath, cleanup };
}

const sendJson = (base: string, path: string, method: string, data?: unknown, headers?: Record<string, string>) =>
  fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

async function main() {
  console.log('=== Running Server Persistence Edge Case Challenge ===');

  await runTest('1. Preserves workbook.id on POST /api/workbooks when ID is new', async () => {
    const { base, cleanup } = await fixture();
    try {
      const customId = createId('workbook');
      const sheetId = createId('sheet');
      const wb = createWorkbook({ id: customId, sheetId, name: 'Custom ID Workbook', timestamp: new Date().toISOString() });
      const res = await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: wb.properties.name, workbook: wb });
      if (res.status !== 201) throw new Error(`Expected status 201, got ${res.status}: ${await res.text()}`);
      const body = await res.json() as { workbook: Workbook; storageVersion: number };
      if (body.workbook.id !== customId) throw new Error(`Expected preserved ID ${customId}, got ${body.workbook.id}`);
      if (body.storageVersion !== 1) throw new Error(`Expected initial storageVersion 1, got ${body.storageVersion}`);
    } finally {
      await cleanup();
    }
  });

  await runTest('2. Assigns new ID on POST /api/workbooks when ID already exists in DB (collision guard)', async () => {
    const { base, cleanup } = await fixture();
    try {
      const customId = createId('workbook');
      const sheetId = createId('sheet');
      const wb = createWorkbook({ id: customId, sheetId, name: 'Collision Test', timestamp: new Date().toISOString() });
      
      const first = await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: 'First', workbook: wb });
      if (first.status !== 201) throw new Error(`First POST failed: ${first.status}`);
      const body1 = await first.json() as { workbook: Workbook };
      if (body1.workbook.id !== customId) throw new Error('First ID was not preserved');

      // Post second snapshot with the exact same ID
      const second = await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: 'Second', workbook: wb });
      if (second.status !== 201) throw new Error(`Second POST should succeed with 201, got ${second.status}: ${await second.text()}`);
      const body2 = await second.json() as { workbook: Workbook };
      if (body2.workbook.id === customId) throw new Error(`Second snapshot should have received a new ID, got ${body2.workbook.id}`);
    } finally {
      await cleanup();
    }
  });

  await runTest('3. Rejects PUT /api/workbooks/:id when If-Match header is missing or non-positive', async () => {
    const { base, cleanup } = await fixture();
    try {
      const wb = createWorkbook({ id: createId('workbook'), sheetId: createId('sheet'), name: 'Header Test', timestamp: new Date().toISOString() });
      await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: 'Header Test', workbook: wb });
      
      const noHeader = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', { workbook: wb, saveId: randomUUID() });
      if (noHeader.status !== 428) throw new Error(`Expected 428 when If-Match is missing, got ${noHeader.status}`);

      const zeroHeader = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', { workbook: wb, saveId: randomUUID() }, { 'if-match': '0' });
      if (zeroHeader.status !== 428) throw new Error(`Expected 428 when If-Match is 0, got ${zeroHeader.status}`);

      const invalidHeader = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', { workbook: wb, saveId: randomUUID() }, { 'if-match': 'invalid' });
      if (invalidHeader.status !== 428) throw new Error(`Expected 428 when If-Match is non-numeric, got ${invalidHeader.status}`);
    } finally {
      await cleanup();
    }
  });

  await runTest('4. Detects version conflict (HTTP 409) on stale If-Match', async () => {
    const { base, cleanup } = await fixture();
    try {
      const wb = createWorkbook({ id: createId('workbook'), sheetId: createId('sheet'), name: 'Stale Version Test', timestamp: new Date().toISOString() });
      await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: 'Stale', workbook: wb });

      // Save once (moves version from 1 to 2)
      const save1 = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', { workbook: { ...wb, revision: 1 }, saveId: randomUUID() }, { 'if-match': '1' });
      if (save1.status !== 200) throw new Error(`First save failed: ${save1.status}`);

      // Try saving with stale version 1
      const staleSave = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', { workbook: { ...wb, revision: 2 }, saveId: randomUUID() }, { 'if-match': '1' });
      if (staleSave.status !== 409) throw new Error(`Expected 409 on stale version, got ${staleSave.status}: ${await staleSave.text()}`);
      const err = await staleSave.json() as any;
      if (err.error?.code !== 'VERSION_CONFLICT') throw new Error(`Expected error code VERSION_CONFLICT, got ${err.error?.code}`);
      if (err.error?.currentVersion !== 2) throw new Error(`Expected currentVersion 2, got ${err.error?.currentVersion}`);
    } finally {
      await cleanup();
    }
  });

  await runTest('5. Idempotent save replay succeeds with identical response', async () => {
    const { base, cleanup } = await fixture();
    try {
      const wb = createWorkbook({ id: createId('workbook'), sheetId: createId('sheet'), name: 'Idempotency Test', timestamp: new Date().toISOString() });
      await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: 'Idempotency', workbook: wb });

      const saveId = randomUUID();
      const payload = { workbook: { ...wb, revision: 1 }, saveId };

      const res1 = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', payload, { 'if-match': '1' });
      if (res1.status !== 200) throw new Error(`Save 1 failed: ${res1.status}`);
      const body1 = await res1.json() as any;

      // Replay exact same request (even with If-Match: 1)
      const res2 = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', payload, { 'if-match': '1' });
      if (res2.status !== 200) throw new Error(`Replay failed with ${res2.status}: ${await res2.text()}`);
      const body2 = await res2.json() as any;

      if (body1.storageVersion !== body2.storageVersion) throw new Error(`Version mismatch in replay: ${body1.storageVersion} vs ${body2.storageVersion}`);
      if (body1.savedRevision !== body2.savedRevision) throw new Error(`Revision mismatch in replay`);
      if (body1.savedAt !== body2.savedAt) throw new Error(`savedAt timestamp must be identical on idempotent replay`);
    } finally {
      await cleanup();
    }
  });

  await runTest('6. Reusing saveId with altered payload is rejected with HTTP 409 SAVE_ID_REUSED', async () => {
    const { base, cleanup } = await fixture();
    try {
      const wb = createWorkbook({ id: createId('workbook'), sheetId: createId('sheet'), name: 'SaveId Reuse Test', timestamp: new Date().toISOString() });
      await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: 'SaveId', workbook: wb });

      const saveId = randomUUID();
      const res1 = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', { workbook: { ...wb, revision: 1 }, saveId }, { 'if-match': '1' });
      if (res1.status !== 200) throw new Error(`Save 1 failed`);

      // Try re-using the same saveId with modified workbook properties
      const alteredWb = { ...wb, properties: { ...wb.properties, name: 'Tampered' }, revision: 1 };
      const res2 = await sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', { workbook: alteredWb, saveId }, { 'if-match': '2' });
      if (res2.status !== 409) throw new Error(`Expected 409 when saveId is reused with altered content, got ${res2.status}`);
      const err = await res2.json() as any;
      if (err.error?.code !== 'SAVE_ID_REUSED') throw new Error(`Expected code SAVE_ID_REUSED, got ${err.error?.code}`);
    } finally {
      await cleanup();
    }
  });

  await runTest('7. Enforces concurrency locking: 5 parallel PUTs at version 1 yield exactly one winner', async () => {
    const { base, cleanup } = await fixture();
    try {
      const wb = createWorkbook({ id: createId('workbook'), sheetId: createId('sheet'), name: 'Race Test', timestamp: new Date().toISOString() });
      await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: 'Race', workbook: wb });

      const promises = Array.from({ length: 5 }, (_, i) =>
        sendJson(base, `/api/workbooks/${wb.id}`, 'PUT', {
          workbook: { ...wb, properties: { ...wb.properties, name: `Variant ${i}` }, revision: 1 },
          saveId: randomUUID(),
        }, { 'if-match': '1' })
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map(r => r.status);
      const successCount = statuses.filter(s => s === 200).length;
      const conflictCount = statuses.filter(s => s === 409).length;

      if (successCount !== 1) throw new Error(`Expected exactly 1 success (200), got ${successCount}`);
      if (conflictCount !== 4) throw new Error(`Expected 4 conflicts (409), got ${conflictCount}`);
    } finally {
      await cleanup();
    }
  });

  await runTest('8. SQLite WAL durability across store close and reopen', async () => {
    const { base, store, dbPath, cleanup } = await fixture();
    try {
      const customId = createId('workbook');
      const sheetId = createId('sheet');
      const wb = createWorkbook({ id: customId, sheetId, name: 'Durability Test', timestamp: new Date().toISOString() });
      await sendJson(base, '/api/workbooks', 'POST', { kind: 'snapshot', name: 'Durability', workbook: wb });

      // Save version 2
      await sendJson(base, `/api/workbooks/${customId}`, 'PUT', {
        workbook: { ...wb, properties: { ...wb.properties, name: 'Durability Updated' }, revision: 2 },
        saveId: randomUUID(),
      }, { 'if-match': '1' });

      // Close store and open fresh connection directly from disk
      const store2 = new WorkbookStore(dbPath);
      const loaded = store2.get(customId);
      if (loaded.storageVersion !== 2) throw new Error(`Expected storageVersion 2 after reopening DB, got ${loaded.storageVersion}`);
      if (loaded.workbook.properties.name !== 'Durability Updated') throw new Error(`Expected updated name`);
      store2.close();
    } finally {
      await cleanup();
    }
  });

  console.log('\n=== Summary ===');
  const allPassed = results.every(r => r.passed);
  console.log(`Passed: ${results.filter(r => r.passed).length}/${results.length}`);
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
