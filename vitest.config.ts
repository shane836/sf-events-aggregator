import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local so integration tests that hit Neon work without a wrapper
// script. Best-effort: if the file isn't present (CI), tests that require
// DATABASE_URL will fail loudly at import time.
loadEnv({ path: resolve(__dirname, ".env.local") });

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
  test: {
    // Default Node env. Files that need jsdom opt in with the
    // `// @vitest-environment jsdom` docblock directive (vitest 4 dropped
    // `environmentMatchGlobs` — directives or per-project workspaces only).
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
