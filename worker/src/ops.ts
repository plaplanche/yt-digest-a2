import { log } from "./log";
import { errorResponse, json, notFound } from "./http";
import { revokeLeases, sweepExpired } from "./lease";
import { sha256Hex } from "./node";
import { VIDEO_ID, check, invalidRequest, isInt, isString, readObject } from "./validate";
import type { Env } from "./env";

// Every table of the D1 schema (migrations/0001_init.sql).
const TABLES = [
  "nodes",
  "jobs",
  "leases",
  "node_events",
  "invites",
  "users",
  "oauth_clients",
  "oauth_requests",
  "oauth_codes",
  "oauth_tokens",
] as const;

const sha256 = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

// Compares the digests, so the comparison time does not depend on where the strings differ or on their length.
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= (da[i] ?? 0) ^ (db[i] ?? 0);
  return diff === 0;
}

async function authenticated(request: Request, token: string): Promise<boolean> {
  const match = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
  if (!match?.[1]) {
    log("auth.bearer.rejected", { attrs: { surface: "ops", reason: "missing" } });
    return false;
  }
  if (!(await constantTimeEqual(match[1], token))) {
    log("auth.bearer.rejected", { attrs: { surface: "ops", reason: "unknown" } });
    return false;
  }
  return true;
}

async function reset(env: Env): Promise<Response> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  let cursor: string | undefined;
  do {
    const page = await env.TRANSCRIPTS.list({ prefix: "transcripts/", cursor });
    if (page.objects.length > 0) await env.TRANSCRIPTS.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json({ ok: true });
}

async function enrollNode(request: Request, env: Env): Promise<Response> {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const problem = check(
    body,
    { node_id: (v) => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(v), owner_label: isString(1, 100) },
    ["node_id", "owner_label"],
  );
  if (problem) return invalidRequest(problem);
  const token = `ytd_node_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(
    `INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES (?1, ?2, ?3, 'healthy', ?4, ?4)
     ON CONFLICT (node_id) DO NOTHING`,
  )
    .bind(body.node_id, body.owner_label, await sha256Hex(token), now)
    .run();
  if (inserted.meta.changes === 0) return errorResponse(409, "conflict", "Node already exists");
  log("node.enrolled", { attrs: { node_id: body.node_id } });
  return json({ node_id: body.node_id, owner_label: body.owner_label, token });
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function enqueueJobs(request: Request, env: Env): Promise<Response> {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const problem = check(
    body,
    {
      video_ids: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 100 && v.every((id) => typeof id === "string" && VIDEO_ID.test(id)),
      priority: isInt(0),
    },
    ["video_ids"],
  );
  if (problem) return invalidRequest(problem);
  const ids = body.video_ids as string[];
  const priority = (body.priority as number | undefined) ?? 0;
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    ...ids.map((id) =>
      env.DB.prepare(
        `INSERT INTO jobs (video_id, kind, priority, status, created_at) VALUES (?1, 'primary', ?2, 'queued', ?3)
         ON CONFLICT (video_id, kind) DO NOTHING`,
      ).bind(id, priority, now),
    ),
    // Raises the priority of the jobs that already existed; never lowers it.
    env.DB.prepare(
      `UPDATE jobs SET priority = ?1 WHERE priority < ?1 AND kind = 'primary' AND video_id IN (SELECT value FROM json_each(?2))`,
    ).bind(priority, JSON.stringify(ids)),
  ]);
  const enqueued = ids.filter((_, i) => results[i]?.meta.changes === 1);
  const existing = ids.filter((_, i) => results[i]?.meta.changes !== 1);
  if (enqueued.length > 0) log("job.enqueued", { attrs: { count: enqueued.length, priority } });
  return json({ enqueued, existing });
}

async function getJob(env: Env, videoId: string): Promise<Response> {
  await sweepExpired(env);
  const row = await env.DB.prepare(
    `SELECT video_id, kind, priority, status, leased_by, lease_expires_at, attempts, tried_nodes, last_outcome, created_at, done_at
     FROM jobs WHERE video_id = ?1 AND kind = 'primary'`,
  )
    .bind(videoId)
    .first<{ tried_nodes: string }>();
  if (!row) return notFound();
  return json({ ...row, tried_nodes: JSON.parse(row.tried_nodes) });
}

async function revokeNode(env: Env, nodeId: string): Promise<Response> {
  const node = await env.DB.prepare("SELECT revoked_at FROM nodes WHERE node_id = ?1").bind(nodeId).first();
  if (!node) return notFound();
  const now = new Date().toISOString();
  // Only the request that sets revoked_at revokes the leases.
  const update = await env.DB.prepare("UPDATE nodes SET state = 'disabled', state_since = ?1, revoked_at = ?1 WHERE node_id = ?2 AND revoked_at IS NULL")
    .bind(now, nodeId)
    .run();
  if (update.meta.changes === 1) {
    log("node.revoked", { attrs: { node_id: nodeId, leases_revoked: await revokeLeases(env, nodeId) } });
  }
  return json({ node_id: nodeId, state: "disabled" });
}

async function getTranscript(env: Env, videoId: string): Promise<Response> {
  const object = await env.TRANSCRIPTS.get(`transcripts/${videoId}.json`);
  if (!object) return notFound();
  const meta = object.customMetadata ?? {};
  return json({
    video_id: videoId,
    transcript: JSON.parse(await object.text()),
    node_id: meta.node_id,
    lease_id: meta.lease_id,
    produced_at: meta.produced_at,
  });
}

export async function handleOps(request: Request, env: Env, path: string): Promise<Response> {
  const token = env.OPS_TOKEN;
  if (!token) return notFound();
  if (!(await authenticated(request, token))) return errorResponse(401, "unauthorized", "Missing or wrong operator bearer");
  if (request.method === "POST" && path === "/ops/reset") return reset(env);
  if (request.method === "POST" && path === "/ops/nodes") return enrollNode(request, env);
  if (request.method === "POST" && path === "/ops/jobs") return enqueueJobs(request, env);
  const job = /^\/ops\/jobs\/([^/]+)$/.exec(path);
  if (request.method === "GET" && job?.[1]) return getJob(env, job[1]);
  const transcript = /^\/ops\/transcripts\/([^/]+)$/.exec(path);
  if (request.method === "GET" && transcript?.[1]) return getTranscript(env, transcript[1]);
  const node = /^\/ops\/nodes\/([^/]+)$/.exec(path);
  if (request.method === "DELETE" && node?.[1]) return revokeNode(env, node[1]);
  return notFound();
}
