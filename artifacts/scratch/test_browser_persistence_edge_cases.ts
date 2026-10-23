import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 3029;
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

  // Wait for health check
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
  console.log('=== Starting Browser Persistence & Reload Edge Cases Challenge ===');
  const tempDir = mkdtempSync(join(tmpdir(), 'openexcel-e2e-adv-'));
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
    await step('1. Load app, edit cell values and formulas, verify recalculation', async () => {
      await page.goto(BASE_URL);
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });
      await input('A1', 'Price');
      await input('B1', 'Quantity');
      await input('C1', 'Total');
      await input('A2', '19.99');
      await input('B2', '5');
      await input('C2', '=A2*B2');
      const val = await cell('C2').textContent();
      if (!val?.includes('99.95')) throw new Error(`Expected C2 to evaluate to 99.95, got ${val}`);
    });

    await step('2. Apply cell formatting (bold + fill color), manual save, and reload page', async () => {
      await cell('C2').click();
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForSelector('text=Saved', { timeout: 5000 });

      // Reload page
      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });

      // Check values and formatting survived reload
      const valA2 = await cell('A2').textContent();
      const valB2 = await cell('B2').textContent();
      const valC2 = await cell('C2').textContent();
      if (valA2?.trim() !== '19.99') throw new Error(`A2 lost after reload: ${valA2}`);
      if (valB2?.trim() !== '5') throw new Error(`B2 lost after reload: ${valB2}`);
      if (!valC2?.includes('99.95')) throw new Error(`Formula C2 lost or recalculated incorrectly: ${valC2}`);

      // Verify bold font weight persisted
      const fontWeight = await cell('C2').evaluate(el => window.getComputedStyle(el).fontWeight);
      if (fontWeight !== '700' && fontWeight !== 'bold') {
        throw new Error(`Expected bold font-weight (700), got ${fontWeight}`);
      }
    });

    await step('3. Autosave verification without clicking Save button', async () => {
      // Edit a new cell D2
      const statusBefore = await page.getByRole('status').textContent();
      console.log('Status before edit in step 3:', statusBefore);
      await input('D2', 'AutosavedValue');
      const valImmediate = await cell('D2').textContent();
      console.log('D2 immediately after input:', valImmediate);
      const statusAfterEdit = await page.getByRole('status').textContent();
      console.log('Status after edit in step 3:', statusAfterEdit);

      // Wait for status to change from Unsaved changes -> Saving -> Saved
      await page.waitForFunction(() => {
        const el = document.querySelector('[role="status"]');
        return el?.textContent?.trim() === 'Saved';
      }, { timeout: 8000 });
      console.log('Status after waiting for autosave:', await page.getByRole('status').textContent());

      const lastIdBeforeReload = await page.evaluate(() => localStorage.getItem('openexcel-last'));
      console.log('localStorage openexcel-last before reload:', lastIdBeforeReload);

      // Reload page immediately after autosave completed
      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });
      const lastIdAfterReload = await page.evaluate(() => localStorage.getItem('openexcel-last'));
      console.log('localStorage openexcel-last after reload:', lastIdAfterReload);

      const valD2 = await cell('D2').textContent();
      console.log('D2 after reload:', valD2);
      if (valD2?.trim() !== 'AutosavedValue') {
        throw new Error(`Autosave failed to persist D2! Got: "${valD2}"`);
      }
    });

    await step('4. Multiple sequential reloads with incremental changes', async () => {
      for (let i = 1; i <= 3; i++) {
        const addr = `E${i}`;
        const content = `Step_${i}_${Date.now()}`;
        await input(addr, content);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForSelector('text=Saved', { timeout: 5000 });
        await page.reload();
        await page.waitForSelector('[role="grid"]', { timeout: 10000 });

        const readBack = await cell(addr).textContent();
        if (readBack?.trim() !== content) {
          throw new Error(`Sequential reload ${i} failed for ${addr}: got ${readBack}, expected ${content}`);
        }
      }
    });

    await step('5. Complex formula recalculation across reload (dynamic array / functions)', async () => {
      await input('F1', '=AVERAGE(A2, B2)');
      await input('G1', '=IF(C2>50, "Expensive", "Cheap")');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForSelector('text=Saved', { timeout: 5000 });

      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });

      // Wait for calculation worker to compute values
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-address="G1"]');
        return el?.textContent?.trim() === 'Expensive';
      }, { timeout: 10000 });

      const f1 = await cell('F1').textContent();
      const g1 = await cell('G1').textContent();
      if (!f1?.includes('12.495')) throw new Error(`F1 AVERAGE expected 12.495, got ${f1}`);
      if (g1?.trim() !== 'Expensive') throw new Error(`G1 IF expected "Expensive", got ${g1}`);
    });

    await step('6. Multi-sheet creation, switching, and reload persistence', async () => {
      // Add sheet
      await page.getByRole('button', { name: 'Insert', exact: true }).click();
      await page.getByRole('button', { name: 'New sheet', exact: true }).click();

      // Enter data on Sheet2
      await input('A1', 'OnSheet2');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForSelector('text=Saved', { timeout: 5000 });

      // Reload
      await page.reload();
      await page.waitForSelector('[role="grid"]', { timeout: 10000 });

      // Check if Sheet2 tab is present
      const sheet2Tab = page.locator('footer.oe-sheets button:has-text("Sheet2")');
      await sheet2Tab.click();
      await page.waitForTimeout(500);

      const sheet2Cell = await cell('A1').textContent();
      if (sheet2Cell?.trim() !== 'OnSheet2') {
        throw new Error(`Sheet2 cell A1 lost after reload: got ${sheet2Cell}`);
      }
    });

    await step('7. Zero unhandled page errors', async () => {
      if (pageErrors.length > 0) {
        throw new Error(`Page errors occurred: ${pageErrors.join('; ')}`);
      }
    });

    console.log('\n=== All Browser Persistence & Reload Tests PASSED! ===');
  } finally {
    await browser.close();
    server.kill();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('\nTest runner failed:', err);
  process.exit(1);
});
