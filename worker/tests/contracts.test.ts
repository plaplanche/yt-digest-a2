import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventName } from "../src/contracts/log-event";
import type { TranscriptResult } from "../src/contracts/transcript-result";

vi.setConfig({ testTimeout: 60_000 }); // each --check run installs and regenerates

const root = resolve(__dirname, "../..");

it("the generated types accept a valid result and catalogue name", () => {
  const result: TranscriptResult = {
    video_id: "dQw4w9WgXcQ", status: "ok", lang: "en", source: "manual",
    word_count: 3, truncated: false, sponsor_ratio: null, pages: ["a b c"],
  };
  const event: EventName = "fetch.transcript";
  // @ts-expect-error an extra field is rejected by the type
  const extra: TranscriptResult = { ...result, extra: 1 };
  // @ts-expect-error a bad status is rejected by the type
  const bad: TranscriptResult = { ...result, status: "nope" };
  expect([result.status, event, extra, bad]).toBeTruthy();
});

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "contracts-"));
  for (const name of ["contracts", "scripts", "worker/src/contracts", "node/src/yt_digest_node/contracts"]) {
    cpSync(join(root, name), join(repo, name), { recursive: true, filter: (s) => !s.includes("__pycache__") });
  }
  // Reuse the installed dependencies instead of installing them again.
  symlinkSync(join(root, "worker/node_modules"), join(repo, "worker/node_modules"));
  for (const name of ["worker/package.json", "worker/package-lock.json", "node/pyproject.toml", "node/uv.lock"]) {
    cpSync(join(root, name), join(repo, name));
  }
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const check = () => spawnSync("./scripts/contracts.sh", ["--check"], { cwd: repo, encoding: "utf8" });

it("--check passes when up to date", () => {
  expect(check().status).toBe(0);
});

it("--check names a hand-edited file", () => {
  const file = join(repo, "node/src/yt_digest_node/contracts/log_event.py");
  writeFileSync(file, readFileSync(file, "utf8") + "# edited\n");
  const done = check();
  expect(done.status).toBe(1);
  expect(done.stderr).toContain("node/src/yt_digest_node/contracts/log_event.py");
});

it("--check names the files when a schema changes without regeneration", () => {
  const file = join(repo, "contracts/log-event.schema.json");
  writeFileSync(file, readFileSync(file, "utf8").replace('"sponsorblock.call"', '"sponsorblock.call", "new.event"'));
  const done = check();
  expect(done.status).toBe(1);
  expect(done.stderr).toContain("worker/src/contracts/log-event.ts");
});
