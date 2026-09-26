import { defineConfig } from "vitest/config";
import path from "node:path";

// The advisory scanner timing observation (DECISION_LOG.md § D-019), and only
// that. `vitest.config.ts` collects `*.test.ts` for `npm test`, the blocking
// suite; this pattern cannot match a `.test.ts` file and that one cannot
// match this, so no file is collected by both.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.timing-observation.ts"],
    // Never retried. A failure is the observation, and D-019 requires it to stay
    // visible rather than be retried away.
    retry: 0,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
