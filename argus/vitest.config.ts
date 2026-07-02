import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Each test file gets its own process and an in-memory database.
    env: { ARGUS_DB: ":memory:" },
    pool: "forks",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
