import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tools/**/*.test.mjs"],
    // .local.test files are untracked scratch harnesses (corpus sweeps,
    // one-off probes); they run by explicit path only, never with the suite.
    exclude: ["**/node_modules/**", "**/*.local.test.*"],
  },
});
