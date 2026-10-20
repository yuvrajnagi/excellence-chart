import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "tests/compatibility/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    maxWorkers: 4,
    restoreMocks: true,
  },
});
