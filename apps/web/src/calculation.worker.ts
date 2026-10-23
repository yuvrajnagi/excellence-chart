import { createEngine } from '@openexcel/formula';
import type { Workbook, CellAddress } from '@openexcel/model';
import initWasm, { WasmEngine } from '@openexcel/formula-wasm';

let tsEngine: ReturnType<typeof createEngine> | undefined;
let wasmEngine: WasmEngine | undefined;
let wasmReady = false;
let wasmInitPromise: Promise<boolean> | null = null;

async function ensureWasm(): Promise<boolean> {
  if (wasmReady && wasmEngine) return true;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      await initWasm();
      wasmEngine = new WasmEngine();
      wasmReady = true;
      return true;
    } catch (err) {
      console.warn('OpenExcel: WASM calculation engine unavailable, falling back to TypeScript engine:', err);
      wasmReady = false;
      return false;
    }
  })();

  return wasmInitPromise;
}

// Kick off initialization immediately in background
ensureWasm().catch(() => {});

self.onmessage = async (
  event: MessageEvent<{ id: number; workbook?: Workbook; addresses: CellAddress[] }>
) => {
  const { id, workbook, addresses } = event.data;
  try {
    const isWasmAvailable = await ensureWasm();

    if (isWasmAvailable && wasmEngine) {
      if (workbook) {
        wasmEngine.updateWorkbook(JSON.stringify(workbook));
        wasmEngine.recalculate();
      }
      const raw = wasmEngine.getComputedValues(JSON.stringify(addresses));
      const values = JSON.parse(raw);
      self.postMessage({ id, values, engine: 'wasm' });
      return;
    }

    // Fallback: TypeScript calculation engine
    if (workbook) {
      if (tsEngine) {
        tsEngine.updateWorkbook(workbook);
      } else {
        tsEngine = createEngine(workbook);
      }
      tsEngine.recalculate();
    }
    const values = Object.fromEntries(
      addresses.map((at) => [`${at.sheetId}/${at.row}:${at.col}`, tsEngine?.value(at) ?? null])
    );
    self.postMessage({ id, values, engine: 'typescript' });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
