import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const mocksUrl = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;
const VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nalpha beta gamma.\n";

test("yt-digest-node work --once processes a queued video", async ({ request }) => {
  await request.post("/ops/reset", { headers: ops });
  const enrolled = await request.post("/ops/nodes", { headers: ops, data: { node_id: "e2e-daemon", owner_label: "daemon" } });
  const { token } = await enrolled.json();
  expect((await request.post("/ops/jobs", { headers: ops, data: { video_ids: ["daemonvid01"] } })).status()).toBe(200);

  const fixtures = mkdtempSync(path.join(tmpdir(), "fake-ytdlp-"));
  mkdirSync(path.join(fixtures, "daemonvid01"));
  writeFileSync(path.join(fixtures, "daemonvid01", "meta.json"), JSON.stringify({ duration: 40 }));
  writeFileSync(path.join(fixtures, "daemonvid01", "en.manual.vtt"), VTT);

  const { stderr } = await run("uv", ["run", "--project", "node", "yt-digest-node", "work", "--once"], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    env: {
      ...process.env,
      WORKER_URL: workerUrl,
      NODE_TOKEN: token,
      FETCHER_FAKE_YTDLP: "1",
      FAKE_YTDLP_DIR: fixtures,
      SPONSORBLOCK_URL: `${mocksUrl}/sponsorblock`,
    },
  });
  expect(stderr).not.toContain(token);

  const job = await (await request.get("/ops/jobs/daemonvid01", { headers: ops })).json();
  expect(job).toMatchObject({ status: "done", leased_by: "e2e-daemon", last_outcome: "ok" });
  const stored = await (await request.get("/ops/transcripts/daemonvid01", { headers: ops })).json();
  expect(stored).toMatchObject({
    video_id: "daemonvid01",
    node_id: "e2e-daemon",
    transcript: { status: "ok", lang: "en", pages: ["alpha beta gamma."], word_count: 3 },
  });
});
