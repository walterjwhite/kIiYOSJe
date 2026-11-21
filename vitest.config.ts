import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "extension/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/dist/**"],
      reporter: ["text-summary", "text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // Floors sit about two points under the measured baseline (Nov 2026:
      // statements 55.95, branches 47.69, functions 52.45, lines 57.21). Raise
      // them as coverage improves; never lower them to make a change pass.
      thresholds: {
        statements: 53,
        branches: 45,
        functions: 50,
        lines: 55,
      },
    },
  },
});
