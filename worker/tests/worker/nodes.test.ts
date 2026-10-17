import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
const enroll = async (id: string): Promise<string> => {
  const res = await post("/ops/nodes", { node_id: id, owner_label: `owner ${id}` }, "ops-test");
  return ((await res.json()) as { token: string }).token;
};
const enqueue = (ids: string[], priority?: number): Promise<Response> => post("/ops/jobs", { video_ids: ids, priority }, "ops-test");
const claim = async (token: string, body: unknown = {}): Promise<{ video_id: string; lease_id: string; lease_expires_at: string }[]> => {
  const res = await post("/node/claim", body, token);
  expect(res.status).toBe(200);
  return ((await res.json()) as { jobs: { video_id: string; lease_id: string; lease_expires_at: string }[] }).jobs;
};
const job = async (id: string): Promise<Record<string, unknown>> => (await call(`/ops/jobs/${id}`, {}, "ops-test")).json();
const vid = (n: number): string => `video${String(n).padStart(6, "0")}`;

let logs: string[];
beforeEach(async () => {
  logs = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(line));
  await call("/ops/reset", { method: "POST" }, "ops-test");
});

describe("POST /ops/nodes", () => {
  it("returns a token shown once, stores only its SHA-256 and logs node.enrolled", async () => {
    const res = await post("/ops/nodes", { node_id: "pi-1", owner_label: "Alice" }, "ops-test");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { node_id: string; owner_label: string; token: string };
    expect(body).toMatchObject({ node_id: "pi-1", owner_label: "Alice" });
    expect(body.token).toMatch(/^ytd_node_[A-Za-z0-9_-]{43}$/);
    const row = await env.DB.prepare("SELECT token_hash, state FROM nodes WHERE node_id = 'pi-1'").first<{ token_hash: string; state: string }>();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.token));
    expect(row?.token_hash).toBe([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
    expect(row?.state).toBe("healthy");
    expect(logs.some((l) => JSON.parse(l).event === "node.enrolled")).toBe(true);
    expect(logs.join("\n")).not.toContain(body.token);
  });
  it("refuses an existing node id with 409 conflict and a bad body with 400", async () => {
    await enroll("pi-1");
    const dup = await post("/ops/nodes", { node_id: "pi-1", owner_label: "x" }, "ops-test");
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "conflict" } });
    for (const bad of [{ node_id: "Pi", owner_label: "x" }, { node_id: "pi-2", owner_label: "" }, { node_id: "pi-2" }]) {
      expect((await post("/ops/nodes", bad, "ops-test")).status).toBe(400);
    }
  });
});

describe("node authentication", () => {
  it("answers 401 without a bearer, with an unknown token and with the operator token", async () => {
    await enroll("pi-1");
    for (const token of [undefined, "ytd_node_unknown", "ops-test"]) {
      const res = await call("/node/claim", { method: "POST", body: "{}" }, token);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
    }
    const rejected = logs.map((l) => JSON.parse(l)).filter((e) => e.event === "auth.bearer.rejected");
    expect(rejected.map((e) => e.attrs)).toEqual([
      { surface: "node", reason: "missing" },
      { surface: "node", reason: "unknown" },
      { surface: "node", reason: "unknown" },
    ]);
  });
  it("refuses the token of a revoked node", async () => {
    const token = await enroll("pi-1");
    await env.DB.prepare("UPDATE nodes SET state = 'disabled', revoked_at = '2026-10-16T07:00:00.000Z'").run();
    expect((await post("/node/claim", {}, token)).status).toBe(401);
  });
  it("validates the body", async () => {
    const token = await enroll("pi-1");
    expect((await call("/node/claim", { method: "POST", body: "{nope" }, token)).status).toBe(400);
    expect((await post("/node/claim", { max_jobs: 11 }, token)).status).toBe(400);
    expect((await post("/node/claim", { max_jobs: 0 }, token)).status).toBe(400);
    expect((await post("/node/claim", { other: 1 }, token)).status).toBe(400);
    expect((await post("/node/heartbeat", { version: "1" }, token)).status).toBe(400);
  });
});

describe("POST /node/heartbeat", () => {
  it("records the heartbeat and answers healthy, run, 60", async () => {
    const token = await enroll("pi-1");
    const res = await post("/node/heartbeat", { version: "0.2.0", uptime_s: 5, jobs_in_progress: 1 }, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ node_id: "pi-1", state: "healthy", hourly_budget: 60, directive: "run" });
    const row = await env.DB.prepare("SELECT last_heartbeat_at, version FROM nodes").first<{ last_heartbeat_at: string; version: string }>();
    expect(row?.version).toBe("0.2.0");
    expect(row?.last_heartbeat_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    const event = logs.map((l) => JSON.parse(l)).find((e) => e.event === "node.heartbeat");
    expect(event.attrs).toEqual({ node_id: "pi-1", version: "0.2.0", jobs_in_progress: 1 });
  });
});

describe("POST /ops/jobs and GET /ops/jobs/<id>", () => {
  it("enqueues new ids and keeps existing ones, raising the priority only upwards", async () => {
    const first = await enqueue(["aaaaaaaaaaa", "bbbbbbbbbbb"], 5);
    expect(await first.json()).toEqual({ enqueued: ["aaaaaaaaaaa", "bbbbbbbbbbb"], existing: [] });
    const second = await enqueue(["bbbbbbbbbbb", "ccccccccccc"], 2);
    expect(await second.json()).toEqual({ enqueued: ["ccccccccccc"], existing: ["bbbbbbbbbbb"] });
    expect((await job("bbbbbbbbbbb")).priority).toBe(5);
    await enqueue(["bbbbbbbbbbb"], 9);
    expect(await job("bbbbbbbbbbb")).toMatchObject({
      video_id: "bbbbbbbbbbb", kind: "primary", priority: 9, status: "queued", leased_by: null, lease_expires_at: null,
      attempts: 0, tried_nodes: [], last_outcome: null, done_at: null,
    });
    expect((await job("ccccccccccc")).priority).toBe(2);
    expect(logs.map((l) => JSON.parse(l)).filter((e) => e.event === "job.enqueued").map((e) => e.attrs)).toEqual([
      { count: 2, priority: 5 }, { count: 1, priority: 2 },
    ]);
  });
  it("defaults the priority to 0, treats a repeated id in a request as existing, and validates", async () => {
    expect(await (await enqueue(["aaaaaaaaaaa", "aaaaaaaaaaa"])).json()).toEqual({ enqueued: ["aaaaaaaaaaa"], existing: ["aaaaaaaaaaa"] });
    for (const bad of [{ video_ids: [] }, { video_ids: ["short"] }, { video_ids: ["aaaaaaaaaaa"], priority: -1 }, { video_ids: Array(101).fill("aaaaaaaaaaa") }, {}]) {
      expect((await post("/ops/jobs", bad, "ops-test")).status).toBe(400);
    }
  });
  it("answers 404 for an unknown job", async () => {
    expect((await call("/ops/jobs/zzzzzzzzzzz", {}, "ops-test")).status).toBe(404);
  });
});

describe("POST /node/claim", () => {
  it("answers an empty list on an empty queue", async () => {
    const token = await enroll("pi-1");
    expect(await (await post("/node/claim", {}, token)).json()).toEqual({ jobs: [] });
  });
  it("takes 3 jobs by default, by priority then creation order", async () => {
    const token = await enroll("pi-1");
    await enqueue([vid(1)], 0);
    await new Promise((r) => setTimeout(r, 5));
    await enqueue([vid(2)], 0);
    await enqueue([vid(3)], 7);
    await enqueue([vid(4)], 0);
    const jobs = await claim(token);
    expect(jobs.map((j) => j.video_id)).toEqual([vid(3), vid(1), vid(2)]);
    expect(await job(vid(4))).toMatchObject({ status: "queued", attempts: 0 });
    for (const j of jobs) expect(j.lease_id.length).toBeGreaterThanOrEqual(16);
    expect(new Set(jobs.map((j) => j.lease_id)).size).toBe(3);
  });
  it("honours max_jobs and records the lease on the job and in leases", async () => {
    const token = await enroll("pi-1");
    await enqueue([vid(1), vid(2)]);
    const before = Date.now();
    const jobs = await claim(token, { max_jobs: 1 });
    expect(jobs).toHaveLength(1);
    const [lease] = jobs;
    expect(await job(lease!.video_id)).toMatchObject({
      status: "leased", leased_by: "pi-1", attempts: 1, tried_nodes: ["pi-1"], lease_expires_at: lease!.lease_expires_at,
    });
    expect(Date.parse(lease!.lease_expires_at) - before).toBeGreaterThan(590_000);
    const row = await env.DB.prepare("SELECT * FROM leases WHERE lease_id = ?1").bind(lease!.lease_id).first();
    expect(row).toMatchObject({ video_id: lease!.video_id, node_id: "pi-1", state: "active", expires_at: lease!.lease_expires_at, response_json: null });
    const event = logs.map((l) => JSON.parse(l)).find((e) => e.event === "job.claimed");
    expect(event).toMatchObject({ video_id: lease!.video_id, attrs: { node_id: "pi-1", attempt: 1, lease_seconds: 600 } });
  });
  it("uses LEASE_SECONDS", async () => {
    const token = await enroll("pi-1");
    await enqueue([vid(1)]);
    const res = await worker.fetch(
      new Request("http://worker.test/node/claim", { method: "POST", body: "{}", headers: { Authorization: `Bearer ${token}` } }),
      { ...env, LEASE_SECONDS: "2" },
    );
    const [lease] = ((await res.json()) as { jobs: { lease_expires_at: string }[] }).jobs;
    expect(Date.parse(lease!.lease_expires_at) - Date.now()).toBeLessThanOrEqual(2000);
  });
  it("does not give a job to a node already in its tried_nodes, nor a leased job", async () => {
    const t1 = await enroll("pi-1");
    const t2 = await enroll("pi-2");
    await enqueue([vid(1)]);
    await claim(t1);
    expect(await claim(t2)).toEqual([]);
    await env.DB.prepare("UPDATE jobs SET status = 'queued', leased_by = NULL, lease_id = NULL").run();
    expect(await claim(t1)).toEqual([]);
    expect(await claim(t2)).toHaveLength(1);
    expect(await job(vid(1))).toMatchObject({ attempts: 2, tried_nodes: ["pi-1", "pi-2"] });
  });
  it("never hands a job out twice under concurrent claims, and each claim gets min(max_jobs, eligible)", async () => {
    const tokens = await Promise.all(["n1", "n2", "n3", "n4"].map(enroll));
    const ids = Array.from({ length: 20 }, (_, i) => vid(i));
    await enqueue(ids);
    // 4 claims of 5 jobs over 20 eligible jobs: every claim must come back full, and they partition the queue.
    const claims = await Promise.all(tokens.map((t) => claim(t, { max_jobs: 5 })));
    expect(claims.map((c) => c.length)).toEqual([5, 5, 5, 5]);
    const handed = claims.flat().map((j) => j.video_id);
    expect(new Set(handed).size).toBe(20);
    expect(new Set(claims.flat().map((j) => j.lease_id)).size).toBe(20);
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM leases WHERE state = 'active'").all<{ n: number }>();
    expect(results[0]?.n).toBe(20);
    // More demand than supply: 8 claims of 3 over 10 jobs hand out exactly 10 jobs, once each.
    await call("/ops/reset", { method: "POST" }, "ops-test");
    const more = await Promise.all(Array.from({ length: 8 }, (_, i) => enroll(`m${i}`)));
    await enqueue(ids.slice(0, 10));
    const got = (await Promise.all(more.map((t) => claim(t)))).map((c) => c.length);
    expect(got.reduce((a, b) => a + b, 0)).toBe(10);
    expect(got.filter((n) => n === 3)).toHaveLength(3);
    expect(got.every((n) => n <= 3)).toBe(true);
  });
});

describe("invites and users", () => {
  const users = async (): Promise<{ user_sub: string; email: string; role: string }[]> =>
    ((await (await call("/ops/users", {}, "ops-test")).json()) as { users: { user_sub: string; email: string; role: string }[] }).users;
  it("stores an invite lowercased", async () => {
    const res = await post("/ops/invites", { email: "Bob@Test" }, "ops-test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "bob@test", revoked: false });
    const row = await env.DB.prepare("SELECT email, revoked FROM invites").first();
    expect(row).toEqual({ email: "bob@test", revoked: 0 });
  });
  it("refuses a bad body with 400", async () => {
    expect((await post("/ops/invites", { email: "nope" }, "ops-test")).status).toBe(400);
    expect((await post("/ops/invites", {}, "ops-test")).status).toBe(400);
  });
  it("re-activates a revoked invite when inviting again", async () => {
    await post("/ops/invites", { email: "bob@test" }, "ops-test");
    const revoked = await post("/ops/invites/revoke", { email: "BOB@test" }, "ops-test");
    expect(await revoked.json()).toEqual({ email: "bob@test", revoked: true });
    expect((await env.DB.prepare("SELECT revoked FROM invites").first<{ revoked: number }>())?.revoked).toBe(1);
    expect(await (await post("/ops/invites", { email: "bob@test" }, "ops-test")).json()).toEqual({ email: "bob@test", revoked: false });
    expect((await env.DB.prepare("SELECT revoked FROM invites").first<{ revoked: number }>())?.revoked).toBe(0);
  });
  it("answers 404 not_found when revoking an unknown invite", async () => {
    const res = await post("/ops/invites/revoke", { email: "ghost@test" }, "ops-test");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
  it("lists users sorted by e-mail and needs the operator bearer", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES ('g-2', 'bob@test', 'member', 'x')"),
      env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES ('g-1', 'alice@test', 'admin', 'x')"),
    ]);
    expect(await users()).toEqual([
      { user_sub: "g-1", email: "alice@test", role: "admin" },
      { user_sub: "g-2", email: "bob@test", role: "member" },
    ]);
    expect((await call("/ops/users")).status).toBe(401);
  });
});
