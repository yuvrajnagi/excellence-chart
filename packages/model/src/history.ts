import type { AppliedTransaction, Commit, EditHeader, History, HistoryOptions, HistoryState, Result, Workbook } from "./types.js";
import { commitSchema, freeze, headerSchema, historyStateSchema, parseBoundary } from "./schemas.js";
import { applyTransaction } from "./store.js";

const bytes = (commit: Commit): number => new TextEncoder().encode(JSON.stringify([commit.transaction.patches, commit.inverse])).length;
export function createHistory(options: HistoryOptions): History {
  let undo: readonly Commit[] = [], redo: readonly Commit[] = [];
  const validOptions = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
    && Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0;
  const limit = (message: string): Result<never> => ({ ok: false, error: { code: "HISTORY_LIMIT", message } });
  const fits = (commits: readonly Commit[]): boolean => validOptions
    && commits.length <= options.maxEntries && commits.reduce((n, c) => n + bytes(c), 0) <= options.maxBytes;
  const replay = (workbook: Workbook, header: EditHeader, direction: "undo" | "redo"): Result<AppliedTransaction> => {
    const parsed = parseBoundary(headerSchema, header);
    if (!parsed.ok) return parsed;
    const source = direction === "undo" ? undo : redo;
    const commit = source.at(-1);
    if (!commit) return { ok: false, error: { code: "NOT_FOUND", message: `Nothing to ${direction}` } };
    const applied = applyTransaction(workbook, {
      id: header.id, baseRevision: header.baseRevision, label: header.label, timestamp: header.timestamp,
      patches: direction === "undo" ? commit.inverse : commit.transaction.patches,
    });
    if (!applied.ok) return applied;
    const nextUndo = direction === "undo" ? undo.slice(0, -1) : [...undo, applied.value.commit];
    const nextRedo = direction === "undo" ? [...redo, commit] : redo.slice(0, -1);
    if (!fits([...nextUndo, ...nextRedo])) return limit("Replay exceeds history budget");
    undo = nextUndo; redo = nextRedo;
    return applied;
  };
  return {
    canUndo: () => undo.length > 0, canRedo: () => redo.length > 0,
    record(commit) {
      const parsed = parseBoundary(commitSchema, commit);
      if (!parsed.ok) return parsed;
      if (!fits([parsed.value])) return limit("Commit exceeds the entire history budget");
      let next = [...undo, parsed.value];
      while (!fits(next)) next = next.slice(1);
      undo = next; redo = [];
      return { ok: true, value: undefined };
    },
    undo: (workbook, header) => replay(workbook, header, "undo"),
    redo: (workbook, header) => replay(workbook, header, "redo"),
    snapshot: () => freeze({ undo: [...undo], redo: [...redo] }),
    restore(state: HistoryState) {
      const parsed = parseBoundary(historyStateSchema, state);
      if (!parsed.ok) return parsed;
      if (!fits([...parsed.value.undo, ...parsed.value.redo])) return limit("Restored state exceeds history budget");
      const all = [...parsed.value.undo, ...parsed.value.redo];
      if (new Set(all.map(c => c.transaction.id)).size !== all.length)
        return { ok: false, error: { code: "INVALID_INPUT", message: "Duplicate history transaction ID" } };
      undo = parsed.value.undo; redo = parsed.value.redo;
      return { ok: true, value: undefined };
    },
    clear() { undo = []; redo = []; },
  };
}
