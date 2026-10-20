import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  createId,
  createWorkbook,
  DEFAULT_LIMITS,
} from "@openexcel/model";
import type {
  CellAddress,
  ComputedValue,
  Patch,
  Result,
} from "@openexcel/model";
import { Engine } from "@openexcel/formula";
import { createDefaultRegistry } from "@openexcel/formula/functions";
import { edgeCases, functionCases } from "./function-cases.js";
import type { Expected } from "./function-cases.js";

class FixtureError extends Error {
  constructor(readonly detail: unknown) {
    super("Compatibility fixture could not be constructed");
    this.name = "FixtureError";
  }
}

function unwrap<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new FixtureError(result.error);
  return result.value;
}

const timestamp = "2024-01-02T00:00:00.000Z";
const sheetId = createId("sheet");
const blank = createWorkbook({
  id: createId("workbook"),
  sheetId,
  name: "Independent compatibility fixtures",
  timestamp,
});
const seed: readonly [number, number, number | string][] = [
  [0, 0, 10], [1, 0, 20], [2, 0, 30], [3, 0, "text"],
  [0, 1, "North"], [1, 1, "South"], [2, 1, "North"],
  [0, 2, 100], [1, 2, 200], [2, 2, 300],
];
const patches: readonly Patch[] = seed.map(([row, col, value]) => ({
  kind: "cell",
  at: { sheetId, row, col },
  cell: { input: { kind: "value", value } },
}));
const template = unwrap(applyTransaction(blank, {
  id: createId("transaction"),
  baseRevision: blank.revision,
  label: "Seed independent oracle inputs",
  timestamp,
  patches,
})).workbook;
const registry = createDefaultRegistry();
const epoch = { id: 1, nowMs: Date.parse(timestamp), randomSeed: 12345 };
const origin: CellAddress = { sheetId, row: 0, col: 10 };

function assertValue(actual: ComputedValue, expected: Expected): void {
  if (typeof expected === "number") {
    expect(typeof actual).toBe("number");
    if (typeof actual !== "number") throw new FixtureError(actual);
    expect(actual).toBeCloseTo(expected, 8);
    return;
  }
  if (expected === null || typeof expected !== "object") {
    expect(actual).toBe(expected);
    return;
  }
  if ("error" in expected) {
    expect(actual).toMatchObject({ kind: "error", code: expected.error });
    return;
  }
  if ("matrix" in expected) {
    expect(actual).toMatchObject({
      kind: "array",
      rows: expected.matrix.length,
      cols: expected.matrix[0]?.length ?? 0,
      values: expected.matrix.flat(),
    });
    return;
  }
  expect(typeof actual).toBe("number");
  if (typeof actual !== "number") throw new FixtureError(actual);
  expect(actual).toBeGreaterThanOrEqual(expected.minimum);
  expect(actual).toBeLessThan(expected.maximumExclusive);
}

describe("independent function compatibility oracle", () => {
  for (const group of [
    { name: "ordinary inputs", cases: functionCases },
    { name: "boundary and error inputs", cases: edgeCases },
  ]) {
    describe(group.name, () => {
      it.each(group.cases)("$name evaluates $formula", ({ formula, expected }) => {
        // Given: real sparse workbook, real registry and a fixed clock/seed.
        const engine = unwrap(Engine.create(template, {
          registry,
          limits: DEFAULT_LIMITS,
          history: { maxEntries: 200, maxBytes: 64 * 1024 * 1024 },
        }));
        try {
          // When: the custom parser/interpreter evaluates the literal fixture.
          const actual = engine.evaluateFormula(formula, origin, epoch);
          // Then: values, errors and array shapes match independent examples.
          assertValue(actual, expected);
        } finally {
          engine.dispose();
        }
      });
    });
  }

  it("registers every independently exercised mandatory function", () => {
    // Given: names from the independently authored examples.
    const names = functionCases.map((entry) => entry.name);
    // When: actual public registry entries are resolved.
    const missing = names.filter((name) => registry.get(name) === undefined);
    // Then: none are absent; a registry stub cannot pass the value cases above.
    expect(missing).toEqual([]);
  });

  for (const name of functionCases.map((entry) => entry.name)) {
    const definition = registry.get(name);
    if (definition === undefined) continue; // Missing entries fail explicitly above.
    const invalid = definition.minArgs > 0
      ? `=${name}()`
      : definition.maxArgs !== null
        ? `=${name}(${Array.from({ length: definition.maxArgs + 1 }, () => "1").join(",")})`
        : null;
    if (invalid === null) continue; // Variadic zero-minimum functions have no arity violation.
    it(`${name} rejects argument counts outside its declared contract`, () => {
      // Given: a fresh real engine and an out-of-contract argument count.
      const engine = unwrap(Engine.create(template, {
        registry,
        limits: DEFAULT_LIMITS,
        history: { maxEntries: 200, maxBytes: 64 * 1024 * 1024 },
      }));
      try {
        // When: invocation goes through the actual formula dispatch.
        const actual = engine.evaluateFormula(invalid, origin, epoch);
        // Then: invalid arity is a spreadsheet error, not a host exception/value.
        expect(actual).toMatchObject({ kind: "error", code: "#VALUE!" });
      } finally {
        engine.dispose();
      }
    });
  }
});
