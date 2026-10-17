import { expect, test, type APIRequestContext } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };

async function enroll(request: APIRequestContext, nodeId: string): Promise<string> {
  const res = await request.post("/ops/nodes", { headers: ops, data: { node_id: nodeId, owner_label: nodeId } });
  expect(res.status()).toBe(200);
  return (await res.json()).token;
}

test("2 nodes claiming 6 jobs concurrently get each job once", async ({ request }) => {
  await request.post("/ops/reset", { headers: ops });
  const tokens = await Promise.all([enroll(request, "e2e-a"), enroll(request, "e2e-b")]);
  const ids = Array.from({ length: 6 }, (_, i) => `e2eclaim${String(i).padStart(3, "0")}`);
  expect((await request.post("/ops/jobs", { headers: ops, data: { video_ids: ids } })).status()).toBe(200);

  const claims = await Promise.all(
    tokens.flatMap((token) =>
      [1, 2].map(async () => {
        const res = await request.post("/node/claim", { headers: { Authorization: `Bearer ${token}` }, data: { max_jobs: 3 } });
        expect(res.status()).toBe(200);
        return (await res.json()).jobs as { video_id: string }[];
      }),
    ),
  );
  const handed = claims.flat().map((j) => j.video_id);
  expect(handed).toHaveLength(6);
  expect([...handed].sort()).toEqual(ids);
  for (const id of ids) {
    const job = await (await request.get(`/ops/jobs/${id}`, { headers: ops })).json();
    expect(job).toMatchObject({ status: "leased", attempts: 1 });
    expect(job.tried_nodes).toHaveLength(1);
  }
});
