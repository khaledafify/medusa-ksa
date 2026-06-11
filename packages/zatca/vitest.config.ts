import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    // The scaffold lands before the first test file (S1); flip has no effect
    // once tests exist because vitest then fails on real failures only.
    passWithNoTests: true,
  },
});
