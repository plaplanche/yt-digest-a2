import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import type { NodeResultRequest } from "../src/contracts/node-result-request";
import type { TranscriptResult } from "../src/contracts/transcript-result";

const contracts = resolve(__dirname, "../../contracts");
const load = (name: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(contracts, `${name}.schema.json`), "utf8"));

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(load("transcript-result"), "transcript-result.schema.json");
const validator = (name: string) => ajv.compile(load(name));

const transcript: TranscriptResult = {
  video_id: "dQw4w9WgXcQ", status: "ok", lang: "en", source: "manual",
  word_count: 3, truncated: false, sponsor_ratio: null, pages: ["a b c"],
};
const ts = "2026-10-16T07:00:01.123Z";

const cases: Record<string, { valid: unknown; invalid: [string, unknown][] }> = {
  "node-heartbeat-request": {
    valid: { version: "0.1.0", uptime_s: 5, jobs_in_progress: 0, last_success_at: ts, last_blocked_at: null, disk_free_ratio: 0.5, cpu_temp_c: 40.5 },
    invalid: [
      ["extra field", { version: "1", uptime_s: 0, jobs_in_progress: 0, extra: 1 }],
      ["no version", { uptime_s: 0, jobs_in_progress: 0 }],
      ["empty version", { version: "", uptime_s: 0, jobs_in_progress: 0 }],
      ["negative uptime", { version: "1", uptime_s: -1, jobs_in_progress: 0 }],
      ["disk ratio above 1", { version: "1", uptime_s: 0, jobs_in_progress: 0, disk_free_ratio: 1.1 }],
    ],
  },
  "node-heartbeat-response": {
    valid: { node_id: "n1", state: "healthy", hourly_budget: 10, directive: "run" },
    invalid: [
      ["extra field", { node_id: "n1", state: "healthy", hourly_budget: 10, directive: "run", extra: 1 }],
      ["unknown state", { node_id: "n1", state: "sad", hourly_budget: 10, directive: "run" }],
      ["unknown directive", { node_id: "n1", state: "healthy", hourly_budget: 10, directive: "stop" }],
    ],
  },
  "node-claim-request": {
    valid: { max_jobs: 3 },
    invalid: [
      ["extra field", { extra: 1 }],
      ["max_jobs 0", { max_jobs: 0 }],
      ["max_jobs 11", { max_jobs: 11 }],
    ],
  },
  "node-claim-response": {
    valid: { jobs: [{ video_id: "dQw4w9WgXcQ", lease_id: "0123456789abcdef", lease_expires_at: ts }] },
    invalid: [
      ["extra field", { jobs: [], extra: 1 }],
      ["short lease_id", { jobs: [{ video_id: "dQw4w9WgXcQ", lease_id: "short", lease_expires_at: ts }] }],
      ["bad video id", { jobs: [{ video_id: "x", lease_id: "0123456789abcdef", lease_expires_at: ts }] }],
    ],
  },
  "node-result-request": {
    valid: { lease_id: "l1", outcome: "ok", transcript },
    invalid: [
      ["extra field", { lease_id: "l1", outcome: "error", transcript: null, extra: 1 }],
      ["unknown outcome", { lease_id: "l1", outcome: "done", transcript: null }],
      ["missing transcript key", { lease_id: "l1", outcome: "error" }],
      ["broken transcript", { lease_id: "l1", outcome: "ok", transcript: { ...transcript, status: "nope" } }],
    ],
  },
  "node-release-request": {
    valid: { lease_id: "l1" },
    invalid: [["extra field", { lease_id: "l1", extra: 1 }], ["empty lease_id", { lease_id: "" }]],
  },
  "node-job-ack": {
    valid: { video_id: "dQw4w9WgXcQ", status: "failed_video" },
    invalid: [
      ["extra field", { video_id: "dQw4w9WgXcQ", status: "done", extra: 1 }],
      ["unknown status", { video_id: "dQw4w9WgXcQ", status: "lost" }],
    ],
  },
  error: {
    valid: { error: { code: "bad_request", message: "no" } },
    invalid: [
      ["extra field", { error: { code: "a", message: "b" }, extra: 1 }],
      ["extra nested field", { error: { code: "a", message: "b", extra: 1 } }],
      ["missing message", { error: { code: "a" } }],
    ],
  },
};

for (const [name, { valid, invalid }] of Object.entries(cases)) {
  it(`${name}: accepts a valid instance`, () => {
    expect(validator(name)(valid)).toBe(true);
  });
  it.each(invalid)(`${name}: rejects %s`, (_label, instance) => {
    expect(validator(name)(instance)).toBe(false);
  });
}

it("a claim request without max_jobs is valid", () => {
  expect(validator("node-claim-request")({})).toBe(true);
});

it("the result request type uses the generated transcript-result type", () => {
  const source = readFileSync(resolve(__dirname, "../src/contracts/node-result-request.ts"), "utf8");
  expect(source).toContain('import type { TranscriptResult } from "./transcript-result";');
  expect(source).not.toMatch(/video_id|sponsor_ratio/);
  const request: NodeResultRequest = { lease_id: "l1", outcome: "ok", transcript };
  expect(request.transcript).toBe(transcript);
});
