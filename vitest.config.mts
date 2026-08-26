import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = import.meta.dirname;

// Vitest doesn't read tsconfig paths, so the three aliases are repeated here.
export default defineConfig({
  resolve: {
    alias: {
      "@ai": resolve(root, "ai"),
      "@sim": resolve(root, "sim/src"),
      "@": resolve(root, "."),
    },
  },
  test: { include: ["ai/**/*.test.ts", "lib/**/*.test.ts", "sim/**/*.test.ts"] },
});
