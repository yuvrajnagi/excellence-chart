import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 3030;
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface StepResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const stepResults: StepResult[] = [];

async function step(name: string, fn: () => Promise<void>) {
  const start = performance.now();
  try {
    await fn();
    stepResults.push({ name, passed: true, durationMs: performance.now() - start });
    console.log(`✓ ${name}`);
  } catch (err: any) {
    stepResults.push({ name, passed: false, error: err.stack || err.message, durationMs: performance.now() - start });
    console.error(`✗ ${name}:`, err);
    throw err;
  }
}

async function startServer(dataDir: string): Promise<ChildProcess> {
  const serverProc = spawn('node', ['apps/server/dist/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      STATIC_DIR: resolve('apps/web/dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stderr.on('data', d => console.error('[Server Error]', d.toString()));

  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return serverProc;
    } catch {
      // Wait
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Server failed to start within 15 seconds');
}

async function main() {
  console.log('=== Starting Advanced Adversarial Persistence Challenge ===');
  const tempDir = mkdtempSync(join(tmpdir(), 'openexcel-e2e-adv2-'));
  const server = await startServer(tempDir);
  console.log('Server started on', BASE_URL);

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page: Page = await context.newPage();

  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  const cell = (addr: string) => page.getByRole('gridcell', { name: `${addr} cell`, exact: true });
  const input = async (addr: string, text: string) => {
    await cell(addr).click();
    await page.getByLabel('Formula bar', { exact: true }).fill(text);
    await page.getByLabel('Formula bar', { exact: true }).press('Enter');
  };

  try {
    await step('Adv 1. Circular reference detection and persistence without hang', async () => {
      await page.goto(BASE_URL);
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });
      await input('A1', '=B1+1');
      await input('B1', '=A1+1');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForSelector('text=Saved', { timeout: 5000 });

      // Reload
      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });

      // A1 and B1 should show #CIRC! error and browser should remain responsive
      await page.waitForFunction(() => {
        const elA = document.querySelector('[data-address="A1"]');
        const elB = document.querySelector('[data-address="B1"]');
        return elA?.textContent?.includes('#CIRC!') || elB?.textContent?.includes('#CIRC!');
      }, { timeout: 8000 });

      const textA = await cell('A1').textContent();
      const textB = await cell('B1').textContent();
      console.log('Circular reference results after reload:', { textA, textB });
      if (!textA?.includes('#CIRC!') && !textB?.includes('#CIRC!')) {
        throw new Error(`Expected #CIRC! error after reload, got A1="${textA}", B1="${textB}"`);
      }
    });

    await step('Adv 2. Unicode, quotes, special characters, and HTML-like injection in cell values', async () => {
      const specialText = '✨ "Quotes" & <script>alert(1)</script> / \\ € 100% 👍';
      await input('C1', specialText);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForSelector('text=Saved', { timeout: 5000 });

      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });

      const readBack = await cell('C1').textContent();
      console.log('Special characters read back after reload:', readBack);
      if (readBack?.trim() !== specialText) {
        throw new Error(`Special characters mismatch: got "${readBack}", expected "${specialText}"`);
      }
    });

    await step('Adv 3. Dynamic array formula spill persistence (=SEQUENCE(3, 2))', async () => {
      await input('D1', '=SEQUENCE(3, 2)');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForSelector('text=Saved', { timeout: 5000 });

      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });

      // Wait for calculation worker spill
      await page.waitForFunction(() => {
        const d1 = document.querySelector('[data-address="D1"]')?.textContent?.trim();
        const e1 = document.querySelector('[data-address="E1"]')?.textContent?.trim();
        return d1 === '1' && e1 === '2';
      }, { timeout: 8000 });

      const d1 = await cell('D1').textContent();
      const e1 = await cell('E1').textContent();
      const d2 = await cell('D2').textContent();
      const e2 = await cell('E2').textContent();
      const d3 = await cell('D3').textContent();
      const e3 = await cell('E3').textContent();
      console.log('Spill matrix after reload:', [[d1, e1], [d2, e2], [d3, e3]]);
      if (d1?.trim() !== '1' || e1?.trim() !== '2' || d2?.trim() !== '3' || e2?.trim() !== '4' || d3?.trim() !== '5' || e3?.trim() !== '6') {
        throw new Error(`Array spill not persisted or re-evaluated correctly across reload`);
      }
    });

    await step('Adv 4. Rapid batch edits and autosave convergence', async () => {
      // Perform 10 rapid cell edits in row 10
      for (let col = 0; col < 10; col++) {
        const colLetter = String.fromCharCode(65 + col);
        const addr = `${colLetter}10`;
        await input(addr, String(col * 100));
      }

      // Wait for debounce autosave to settle
      await page.waitForFunction(() => {
        const el = document.querySelector('[role="status"]');
        return el?.textContent?.trim() === 'Saved';
      }, { timeout: 10000 });

      // Reload
      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });

      // Verify all 10 cells persisted
      for (let col = 0; col < 10; col++) {
        const colLetter = String.fromCharCode(65 + col);
        const addr = `${colLetter}10`;
        const val = await cell(addr).textContent();
        if (val?.trim() !== String(col * 100)) {
          throw new Error(`Rapid edit cell ${addr} lost: got "${val}", expected "${col * 100}"`);
        }
      }
    });

    await step('Adv 5. Invalid / stale openexcel-last localStorage handling', async () => {
      // Set localStorage to non-existent ID
      await page.evaluate(() => localStorage.setItem('openexcel-last', '00000000-0000-0000-0000-000000000000'));
      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });

      // Status should be Ready, blank workbook should load without crash
      const status = await page.getByRole('status').textContent();
      if (status !== 'Ready') throw new Error(`Expected status "Ready", got "${status}"`);
      // A1 should be empty
      const a1 = await cell('A1').textContent();
      if (a1?.trim() !== '') throw new Error(`Expected blank A1 on nonexistent ID fallback, got "${a1}"`);
    });

    await step('Adv 6. Verify zero unhandled browser errors throughout all challenges', async () => {
      if (pageErrors.length > 0) {
        throw new Error(`Encountered page errors: ${pageErrors.join('; ')}`);
      }
    });

    console.log('\n=== ALL ADVANCED ADVERSARIAL TESTS PASSED! ===');
  } finally {
    await browser.close();
    server.kill();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('\nAdvanced test runner failed:', err);
  process.exit(1);
});
