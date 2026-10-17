import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "node", include: ["tests/*.test.ts"] } },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.toml" },
            miniflare: {
              bindings: {
                OPS_TOKEN: "ops-test",
                PUBLIC_URL: "http://worker.test",
                GOOGLE_ISSUER: "http://google.test",
                GOOGLE_CLIENT_ID: "google-client",
                GOOGLE_CLIENT_SECRET: "google-secret",
                ADMIN_EMAIL: "alice@test",
                TOKEN_ENC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
              },
            },
          })),
        ],
        test: { name: "worker", include: ["tests/worker/**/*.test.ts"], setupFiles: ["./tests/worker/setup.ts"] },
      },
    ],
  },
});
