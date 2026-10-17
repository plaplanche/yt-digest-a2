import { expect, test, type APIRequestContext } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
type Lease = { video_id: string; lease_id: string; lease_expires_at: string };

async function enroll(request: APIRequestContext, nodeId: string): Promise<string> {
  const res = await request.post("/ops/nodes", { headers: ops, data: { node_id: nodeId, owner_label: nodeId } });
  expect(res.status()).toBe(200);
  return (await res.json()).token;
}
async function claim(request: APIRequestContext, token: string, maxJobs = 3): Promise<Lease[]> {
  const res = await request.post("/node/claim", { headers: bearer(token), data: { max_jobs: maxJobs } });
  expect(res.status()).toBe(200);
  return (await res.json()).jobs;
}
const sendResult = (request: APIRequestContext, token: string, leaseId: string, outcome: string, transcript: unknown = null) =>
  request.post("/node/result", { headers: bearer(token), data: { lease_id: leaseId, outcome, transcript } });
const getJob = async (request: APIRequestContext, id: string) => (await request.get(`/ops/jobs/${id}`, { headers: ops })).json();
const enqueue = async (request: APIRequestContext, ids: string[]) =>
  expect((await request.post("/ops/jobs", { headers: ops, data: { video_ids: ids } })).status()).toBe(200);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeEach(async ({ request }) => {
  await request.post("/ops/reset", { headers: ops });
});

test("E2E-13 (reduced): the 6 jobs claimed concurrently all end done", async ({ request }) => {
  const tokens = await Promise.all([enroll(request, "e2e-a"), enroll(request, "e2e-b")]);
  const ids = Array.from({ length: 6 }, (_, i) => `e2edone${String(i).padStart(4, "0")}`);
  await enqueue(request, ids);
  const claims = await Promise.all(tokens.map(async (token) => ({ token, jobs: await claim(request, token, 3) })));
  const handed = claims.flatMap((c) => c.jobs.map((j) => j.video_id));
  expect([...handed].sort()).toEqual(ids);
  for (const { token, jobs } of claims) {
    for (const j of jobs) expect((await sendResult(request, token, j.lease_id, "no_transcript")).status()).toBe(200);
  }
  for (const id of ids) expect(await getJob(request, id)).toMatchObject({ status: "done", attempts: 1 });
});

test("E2E-14: an expired lease goes to another node and the late result gets 409", async ({ request }) => {
  const [a, b] = await Promise.all([enroll(request, "e2e-a"), enroll(request, "e2e-b")]);
  await enqueue(request, ["e2elease001"]);
  const [lease] = await claim(request, a);
  await sleep(2500); // LEASE_SECONDS is 2 in the e2e check
  const second = await claim(request, b);
  expect(second.map((j) => j.video_id)).toEqual(["e2elease001"]);
  const late = await sendResult(request, a, lease!.lease_id, "no_transcript");
  expect(late.status()).toBe(409);
  expect((await late.json()).error.code).toBe("stale_lease");
  expect(await getJob(request, "e2elease001")).toMatchObject({ status: "leased", leased_by: "e2e-b", tried_nodes: ["e2e-a", "e2e-b"] });
  expect((await sendResult(request, b, second[0]!.lease_id, "no_transcript")).status()).toBe(200);
  expect(await getJob(request, "e2elease001")).toMatchObject({ status: "done" });
});

test("E2E-16 (reduced): unavailable on 3 nodes gives failed_video and a 4th node gets nothing", async ({ request }) => {
  const tokens = await Promise.all(["e2e-a", "e2e-b", "e2e-c", "e2e-d"].map((id) => enroll(request, id)));
  await enqueue(request, ["e2efail0001"]);
  for (const token of tokens.slice(0, 3)) {
    const [lease] = await claim(request, token);
    expect(lease?.video_id).toBe("e2efail0001");
    expect((await sendResult(request, token, lease!.lease_id, "unavailable")).status()).toBe(200);
  }
  expect(await getJob(request, "e2efail0001")).toMatchObject({ status: "failed_video", attempts: 3, last_outcome: "unavailable" });
  expect(await claim(request, tokens[3]!)).toEqual([]);
});

test("E2E-20: a revoked node is refused and its job reassigned", async ({ request }) => {
  const [a, b] = await Promise.all([enroll(request, "e2e-a"), enroll(request, "e2e-b")]);
  await enqueue(request, ["e2erevoke01"]);
  const [lease] = await claim(request, a);
  const revoke = await request.delete("/ops/nodes/e2e-a", { headers: ops });
  expect(revoke.status()).toBe(200);
  expect(await revoke.json()).toEqual({ node_id: "e2e-a", state: "disabled" });
  expect((await request.post("/node/claim", { headers: bearer(a), data: {} })).status()).toBe(401);
  expect((await sendResult(request, a, lease!.lease_id, "no_transcript")).status()).toBe(401);
  expect(await getJob(request, "e2erevoke01")).toMatchObject({ status: "queued", last_outcome: "lease_revoked" });
  expect((await claim(request, b)).map((j) => j.video_id)).toEqual(["e2erevoke01"]);
});

test("E2E-21: /node/* responses hold no user data", async ({ request }) => {
  const token = await enroll(request, "e2e-a");
  await enqueue(request, ["e2edata0001", "e2edata0002"]);
  const bodies: unknown[] = [];
  const record = async (res: Awaited<ReturnType<typeof sendResult>>) => {
    expect(res.status()).toBe(200);
    bodies.push(await res.json());
  };
  await record(await request.post("/node/heartbeat", { headers: bearer(token), data: { version: "1", uptime_s: 1, jobs_in_progress: 0 } }));
  const claimRes = await request.post("/node/claim", { headers: bearer(token), data: { max_jobs: 2 } });
  await record(claimRes);
  const jobs = (bodies[1] as { jobs: Lease[] }).jobs;
  const secret = "very private sentence";
  const transcript = { video_id: "e2edata0001", status: "ok", lang: "en", source: "manual", word_count: 3, truncated: false, sponsor_ratio: null, pages: [secret] };
  await record(await sendResult(request, token, jobs[0]!.lease_id, "ok", { ...transcript, word_count: 3 }));
  await record(await request.post("/node/release", { headers: bearer(token), data: { lease_id: jobs[1]!.lease_id } }));
  expect(Object.keys(bodies[0] as object).sort()).toEqual(["directive", "hourly_budget", "node_id", "state"]);
  for (const job of jobs) expect(Object.keys(job).sort()).toEqual(["lease_expires_at", "lease_id", "video_id"]);
  expect(bodies[2]).toEqual({ video_id: "e2edata0001", status: "done" });
  expect(bodies[3]).toEqual({ video_id: "e2edata0002", status: "queued" });
  expect(JSON.stringify(bodies)).not.toContain(secret);
});
