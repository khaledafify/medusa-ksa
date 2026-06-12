import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/providers/unifonic/**/*.ts"],
      exclude: [
        "src/providers/unifonic/**/*.test.ts",
        "src/providers/unifonic/types.ts",
      ],
    },
  },
});
