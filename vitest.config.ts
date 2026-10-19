import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Enhetstester för lib/ mot fixturerna i test/fixtures. Inga nätverksanrop.
// lib/fetch-round.db.test.ts startar en egen tillfällig Postgres
// (embedded-postgres) på 127.0.0.1; hoppa över den med SKIP_DB_TESTS=1.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "") },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/api/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 180_000,
  },
});
