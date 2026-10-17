import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

const call = (path: string, init: RequestInit = {}, token?: string): Promise<Response> =>
  worker.fetch(
    new Request(`http://worker.test${path}`, {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    }),
    env,
  );
const post = (path: string, body: unknown, token: string): Promise<Response> =>
  call(path, { method: "POST", body: JSON.stringify(body) }, token);
const enroll = async (id: string): Promise<string> =>
  ((await (await post("/ops/nodes", { node_id: id, owner_label: id }, "ops-test")).json()) as { token: string }).token;
const enqueue = (ids: string[]): Promise<Response> => post("/ops/jobs", { video_ids: ids }, "ops-test");
type Lease = { video_id: string; lease_id: string; lease_expires_at: string };
const claim = async (token: string, max_jobs = 1): Promise<Lease[]> =>
  ((await (await post("/node/claim", { max_jobs }, token)).json()) as { jobs: Lease[] }).jobs;
const job = async (id: string): Promise<Record<string, unknown>> => (await call(`/ops/jobs/${id}`, {}, "ops-test")).json();
const count = async (table: string): Promise<number> =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;

const V = "aaaaaaaaaaa";
const transcript = (video_id = V, pages = ["hello big world", "[…]", "again"]) => ({
  video_id, status: "ok", lang: "en", source: "manual", word_count: 4, truncated: false, sponsor_ratio: null, pages,
});
const sendResult = (token: string, lease_id: string, outcome: string, t: unknown = null): Promise<Response> =>
  post("/node/result", { lease_id, outcome, transcript: t }, token);
const events = (): { event: string; video_id?: string; attrs: Record<string, unknown> }[] => logs.map((l) => JSON.parse(l));

let logs: string[];
beforeEach(async () => {
  logs = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(line));
  await call("/ops/reset", { method: "POST" }, "ops-test");
});
afterEach(() => vi.useRealTimers());

describe("POST /node/result", () => {
  it("stores an ok transcript in R2 with its metadata and makes the job done; a retry answers the same and writes nothing", async () => {
    const token = await enroll("n1");
    await enqueue([V]);
    const [lease] = await claim(token);
    const res = await sendResult(token, lease!.lease_id, "ok", transcript());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ video_id: V, status: "done" });
    const stored = await env.TRANSCRIPTS.get(`transcripts/${V}.json`);
    expect(stored?.httpMetadata?.contentType).toBe("application/json");
    expect(stored?.customMetadata).toMatchObject({ node_id: "n1", lease_id: lease!.lease_id });
    expect(stored?.customMetadata?.produced_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(await job(V)).toMatchObject({ status: "done", last_outcome: "ok", attempts: 1 });
    expect((await job(V)).done_at).toMatch(/Z$/);
    const op = await (await call(`/ops/transcripts/${V}`, {}, "ops-test")).json();
    expect(op).toEqual({ video_id: V, transcript: transcript(), node_id: "n1", lease_id: lease!.lease_id, produced_at: stored?.customMetadata?.produced_at });

    const etag = stored?.etag;
    const again = await sendResult(token, lease!.lease_id, "ok", transcript(V, ["other words"]));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ video_id: V, status: "done" });
    expect((await env.TRANSCRIPTS.get(`transcripts/${V}.json`))?.etag).toBe(etag);
    expect(await count("node_events")).toBe(1);
    expect(events().filter((e) => e.event === "job.completed").map((e) => [e.video_id, e.attrs])).toEqual([
      [V, { node_id: "n1", outcome: "ok", status: "done" }],
    ]);
  });
  it("never overwrites an existing object", async () => {
    const token = await enroll("n1");
    await enqueue([V]);
    await env.TRANSCRIPTS.put(`transcripts/${V}.json`, "{}", { customMetadata: { node_id: "old" } });
    const [lease] = await claim(token);
    expect((await sendResult(token, lease!.lease_id, "ok", transcript())).status).toBe(200);
    expect((await env.TRANSCRIPTS.get(`transcripts/${V}.json`))?.customMetadata?.node_id).toBe("old");
    expect(await job(V)).toMatchObject({ status: "done" });
  });
  it("makes no_transcript terminal without an R2 write", async () => {
    const token = await enroll("n1");
    await enqueue([V]);
    const [lease] = await claim(token);
    const res = await sendResult(token, lease!.lease_id, "no_transcript");
    expect(await res.json()).toEqual({ video_id: V, status: "done" });
    expect(await env.TRANSCRIPTS.get(`transcripts/${V}.json`)).toBeNull();
    expect(await job(V)).toMatchObject({ status: "done", last_outcome: "no_transcript" });
    expect((await call(`/ops/transcripts/${V}`, {}, "ops-test")).status).toBe(404);
  });
  it.each(["unavailable", "blocked", "error"])("requeues the job after %s for another node and fails it at the third attempt", async (outcome) => {
    const tokens = await Promise.all(["n1", "n2", "n3", "n4"].map(enroll));
    await enqueue([V]);
    for (const [i, token] of tokens.slice(0, 3).entries()) {
      const [lease] = await claim(token);
      expect(lease?.video_id).toBe(V);
      const res = await sendResult(token, lease!.lease_id, outcome);
      expect(await res.json()).toEqual({ video_id: V, status: i < 2 ? "queued" : "failed_video" });
      expect(await job(V)).toMatchObject({ attempts: i + 1, last_outcome: outcome, leased_by: null });
    }
    expect(await job(V)).toMatchObject({ status: "failed_video", tried_nodes: ["n1", "n2", "n3"] });
    expect((await job(V)).done_at).toMatch(/Z$/);
    expect(await claim(tokens[3]!)).toEqual([]);
    const kinds = (await env.DB.prepare("SELECT kind FROM node_events").all<{ kind: string }>()).results.map((r) => r.kind);
    expect(kinds).toEqual([`job_${outcome}`, `job_${outcome}`, `job_${outcome}`]);
  });
  it("does not give a failed job back to the node that failed it", async () => {
    const [a, b] = await Promise.all([enroll("n1"), enroll("n2")]);
    await enqueue([V]);
    const [lease] = await claim(a);
    await sendResult(a, lease!.lease_id, "error");
    expect(await claim(a)).toEqual([]);
    expect((await claim(b)).map((j) => j.video_id)).toEqual([V]);
  });

  it("requeues an expired lease and answers its late result with 409 stale_lease, writing nothing", async () => {
    const [a, b] = await Promise.all([enroll("n1"), enroll("n2")]);
    await enqueue([V]);
    const [lease] = await claim(a);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date(lease!.lease_expires_at).getTime() + 1));
    const late = await sendResult(a, lease!.lease_id, "ok", transcript());
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: "stale_lease" } });
    expect(await env.TRANSCRIPTS.get(`transcripts/${V}.json`)).toBeNull();
    expect(await job(V)).toMatchObject({ status: "queued", last_outcome: "lease_expired", leased_by: null, attempts: 1, tried_nodes: ["n1"] });
    expect((await env.DB.prepare("SELECT state FROM leases").first<{ state: string }>())?.state).toBe("expired");
    expect((await env.DB.prepare("SELECT kind, node_id FROM node_events").first())).toEqual({ kind: "lease_expired", node_id: "n1" });
    expect((await claim(b)).map((j) => j.video_id)).toEqual([V]);
    expect(events().find((e) => e.event === "job.lease_expired")).toMatchObject({ video_id: V, attrs: { node_id: "n1", attempts: 1, status: "queued" } });
    expect(events().find((e) => e.event === "job.stale_result")).toMatchObject({ video_id: V, attrs: { node_id: "n1" } });
  });
  it("treats a lease as expired exactly at lease_expires_at, and as valid one millisecond before", async () => {
    const token = await enroll("n1");
    await enqueue([V]);
    const [lease] = await claim(token);
    const expiry = new Date(lease!.lease_expires_at).getTime();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(expiry - 1));
    expect(await job(V)).toMatchObject({ status: "leased" });
    vi.setSystemTime(new Date(expiry));
    expect(await job(V)).toMatchObject({ status: "queued", last_outcome: "lease_expired" });
    expect((await sendResult(token, lease!.lease_id, "no_transcript")).status).toBe(409);
  });
  it("fails a job whose third lease expires", async () => {
    const tokens = await Promise.all(["n1", "n2", "n3"].map(enroll));
    await enqueue([V]);
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const token of tokens) {
      const [lease] = await claim(token);
      vi.setSystemTime(new Date(new Date(lease!.lease_expires_at).getTime()));
      await job(V);
    }
    expect(await job(V)).toMatchObject({ status: "failed_video", attempts: 3 });
  });

  it("answers 409 stale_lease for an unknown lease, another node's lease, and writes nothing", async () => {
    const [a, b] = await Promise.all([enroll("n1"), enroll("n2")]);
    await enqueue([V]);
    const [lease] = await claim(a);
    for (const [token, id] of [[a, "nope"], [b, lease!.lease_id]] as const) {
      const res = await sendResult(token, id, "ok", transcript());
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "stale_lease" } });
    }
    expect(await env.TRANSCRIPTS.get(`transcripts/${V}.json`)).toBeNull();
    expect(await job(V)).toMatchObject({ status: "leased", leased_by: "n1" });
    expect(await count("node_events")).toBe(0);
    expect(events().filter((e) => e.event === "job.stale_result")).toHaveLength(2);
  });
  it("answers 409 for the result of a released lease", async () => {
    const token = await enroll("n1");
    await enqueue([V]);
    const [lease] = await claim(token);
    await post("/node/release", { lease_id: lease!.lease_id }, token);
    expect((await sendResult(token, lease!.lease_id, "ok", transcript())).status).toBe(409);
  });
  it("validates the body with 400", async () => {
    const token = await enroll("n1");
    for (const bad of [{}, { lease_id: "x", outcome: "ok" }, { lease_id: "", outcome: "ok", transcript: null }, { lease_id: "x", outcome: "maybe", transcript: null },
      { lease_id: "x", outcome: "ok", transcript: { video_id: V } }, { lease_id: "x", outcome: "error", transcript: null, extra: 1 }]) {
      expect((await post("/node/result", bad, token)).status).toBe(400);
    }
    expect((await post("/node/result", { lease_id: "x", outcome: "ok", transcript: null }, "bad")).status).toBe(401);
  });

  describe("validation (8.4 step 3)", () => {
    const cases: [string, string, unknown][] = [
      ["ok with a null transcript", "ok", null],
      ["ok with a transcript whose status is not ok", "ok", { ...transcript(), status: "blocked" }],
      ["ok with another video id", "ok", transcript("bbbbbbbbbbb")],
      ["ok with no page", "ok", { ...transcript(), pages: [], word_count: 0 }],
      ["ok with a wrong word_count", "ok", { ...transcript(), word_count: 5 }],
      ["a non-ok outcome with a transcript", "error", transcript()],
    ];
    it.each(cases)("%s gives 422 and counts as a failure", async (_name, outcome, t) => {
      const token = await enroll("n1");
      await enqueue([V]);
      const [lease] = await claim(token);
      const res = await sendResult(token, lease!.lease_id, outcome, t);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: { code: "validation_failed" } });
      expect(await env.TRANSCRIPTS.get(`transcripts/${V}.json`)).toBeNull();
      expect(await job(V)).toMatchObject({ status: "queued", last_outcome: "validation_failed", leased_by: null });
      expect((await env.DB.prepare("SELECT state FROM leases").first<{ state: string }>())?.state).toBe("rejected");
      expect((await env.DB.prepare("SELECT kind FROM node_events").first<{ kind: string }>())?.kind).toBe("validation_failed");
      expect(events().find((e) => e.event === "job.validation_failed")).toMatchObject({ video_id: V, attrs: { node_id: "n1" } });
      expect((await sendResult(token, lease!.lease_id, "ok", transcript())).status).toBe(409);
    });
    it("fails the job at the third validation failure", async () => {
      const tokens = await Promise.all(["n1", "n2", "n3"].map(enroll));
      await enqueue([V]);
      for (const token of tokens) {
        const [lease] = await claim(token);
        expect((await sendResult(token, lease!.lease_id, "ok", null)).status).toBe(422);
      }
      expect(await job(V)).toMatchObject({ status: "failed_video", attempts: 3 });
    });
    it("counts whitespace-separated tokens and skips the […] pages", async () => {
      const token = await enroll("n1");
      await enqueue([V]);
      const [lease] = await claim(token);
      const t = { ...transcript(), pages: ["  a\tb\n c ", "[…]", "d"], word_count: 4 };
      expect((await sendResult(token, lease!.lease_id, "ok", t)).status).toBe(200);
    });
  });
});

describe("POST /node/release", () => {
  it("undoes the claim and is idempotent", async () => {
    const [a, b] = await Promise.all([enroll("n1"), enroll("n2")]);
    await enqueue([V]);
    const [lease] = await claim(a);
    const res = await post("/node/release", { lease_id: lease!.lease_id }, a);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ video_id: V, status: "queued" });
    expect(await job(V)).toMatchObject({ status: "queued", leased_by: null, lease_expires_at: null, attempts: 0, tried_nodes: [], last_outcome: "released" });
    expect((await env.DB.prepare("SELECT lease_id FROM jobs").first<{ lease_id: string | null }>())?.lease_id).toBeNull();
    const again = await post("/node/release", { lease_id: lease!.lease_id }, a);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ video_id: V, status: "queued" });
    expect(await job(V)).toMatchObject({ attempts: 0 });
    expect(events().filter((e) => e.event === "job.released").map((e) => [e.video_id, e.attrs])).toEqual([[V, { node_id: "n1" }]]);
    // The node can claim it again, and so can another.
    expect((await claim(a)).map((j) => j.video_id)).toEqual([V]);
    void b;
  });
  it("keeps the other nodes in tried_nodes", async () => {
    const [a, b] = await Promise.all([enroll("n1"), enroll("n2")]);
    await enqueue([V]);
    const [first] = await claim(a);
    await sendResult(a, first!.lease_id, "error");
    const [second] = await claim(b);
    await post("/node/release", { lease_id: second!.lease_id }, b);
    expect(await job(V)).toMatchObject({ attempts: 1, tried_nodes: ["n1"] });
  });
  it("answers 409 for an unknown lease, another node's, a completed and an expired one", async () => {
    const [a, b] = await Promise.all([enroll("n1"), enroll("n2")]);
    await enqueue([V, "bbbbbbbbbbb"]);
    const [done, other] = await claim(a, 2);
    await sendResult(a, done!.lease_id, "no_transcript");
    for (const [token, id] of [[a, "nope"], [b, other!.lease_id], [a, done!.lease_id]] as const) {
      const res = await post("/node/release", { lease_id: id }, token);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "stale_lease" } });
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date(other!.lease_expires_at).getTime()));
    expect((await post("/node/release", { lease_id: other!.lease_id }, a)).status).toBe(409);
    expect(await job("bbbbbbbbbbb")).toMatchObject({ status: "queued", last_outcome: "lease_expired" });
  });
  it("validates the body", async () => {
    const token = await enroll("n1");
    expect((await post("/node/release", {}, token)).status).toBe(400);
    expect((await post("/node/release", { lease_id: "" }, token)).status).toBe(400);
  });
});

describe("DELETE /ops/nodes/<node_id>", () => {
  it("disables the node, refuses its token and reassigns its jobs", async () => {
    const [a, b] = await Promise.all([enroll("n1"), enroll("n2")]);
    await enqueue([V, "bbbbbbbbbbb"]);
    const [lease] = await claim(a, 2);
    const res = await call("/ops/nodes/n1", { method: "DELETE" }, "ops-test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ node_id: "n1", state: "disabled" });
    const row = await env.DB.prepare("SELECT state, revoked_at FROM nodes WHERE node_id = 'n1'").first<{ state: string; revoked_at: string }>();
    expect(row?.state).toBe("disabled");
    expect(row?.revoked_at).toMatch(/Z$/);
    expect((await post("/node/claim", {}, a)).status).toBe(401);
    expect((await sendResult(a, lease!.lease_id, "no_transcript")).status).toBe(401);
    expect(await job(V)).toMatchObject({ status: "queued", last_outcome: "lease_revoked", leased_by: null, tried_nodes: ["n1"] });
    expect((await env.DB.prepare("SELECT DISTINCT state FROM leases").all<{ state: string }>()).results.map((r) => r.state)).toEqual(["revoked"]);
    expect((await claim(b, 2)).map((j) => j.video_id).sort()).toEqual([V, "bbbbbbbbbbb"]);
    expect(events().find((e) => e.event === "node.revoked")?.attrs).toEqual({ node_id: "n1", leases_revoked: 2 });
    // Idempotent: the same answer, and no second event.
    const again = await call("/ops/nodes/n1", { method: "DELETE" }, "ops-test");
    expect(await again.json()).toEqual({ node_id: "n1", state: "disabled" });
    expect(events().filter((e) => e.event === "node.revoked")).toHaveLength(1);
  });
  it("fails a job whose third lease is revoked", async () => {
    const tokens = await Promise.all(["n1", "n2", "n3"].map(enroll));
    await enqueue([V]);
    for (const [i, token] of tokens.entries()) {
      await claim(token);
      await call(`/ops/nodes/n${i + 1}`, { method: "DELETE" }, "ops-test");
    }
    expect(await job(V)).toMatchObject({ status: "failed_video", attempts: 3, last_outcome: "lease_revoked" });
  });
  it("answers 404 for an unknown node and 401 without the operator bearer", async () => {
    expect((await call("/ops/nodes/ghost", { method: "DELETE" }, "ops-test")).status).toBe(404);
    await enroll("n1");
    expect((await call("/ops/nodes/n1", { method: "DELETE" })).status).toBe(401);
    expect((await call("/ops/nodes/n1", { method: "DELETE" }, "wrong")).status).toBe(401);
  });
});

describe("GET /ops/transcripts/<video_id>", () => {
  it("answers 404 when nothing is stored", async () => {
    expect((await call(`/ops/transcripts/${V}`, {}, "ops-test")).status).toBe(404);
    expect((await call(`/ops/transcripts/${V}`)).status).toBe(401);
  });
});
