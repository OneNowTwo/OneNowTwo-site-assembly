import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Modules that import prisma evaluate createClient at load time.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://siteassembly:siteassembly@localhost:5432/site_assembly?schema=public",
    },
  },
});
