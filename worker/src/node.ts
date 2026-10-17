import type { NodeClaimResponse } from "./contracts/node-claim-response";
import type { NodeHeartbeatResponse } from "./contracts/node-heartbeat-response";
import type { Env } from "./env";
import { errorResponse, json, notFound } from "./http";
import { log } from "./log";
import { check, invalidRequest, isInt, isNumber, isString, isTimestampOrNull, readObject } from "./validate";

export const sha256Hex = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const DEFAULT_LEASE_SECONDS = 600;
const DEFAULT_MAX_JOBS = 3;

type NodeRow = { node_id: string; hourly_budget: number; revoked_at: string | null };

// The node the bearer belongs to, or the 401 to answer.
async function authenticate(request: Request, env: Env): Promise<NodeRow | Response> {
  const reject = (reason: "missing" | "unknown" | "revoked"): Response => {
    log("auth.bearer.rejected", { attrs: { surface: "node", reason } });
    return errorResponse(401, "unauthorized", "Missing, unknown or revoked node token");
  };
  const match = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
  if (!match?.[1]) return reject("missing");
  const node = await env.DB.prepare("SELECT node_id, hourly_budget, revoked_at FROM nodes WHERE token_hash = ?1")
    .bind(await sha256Hex(match[1]))
    .first<NodeRow>();
  if (!node) return reject("unknown");
  if (node.revoked_at !== null) return reject("revoked");
  return node;
}

async function heartbeat(env: Env, node: NodeRow, body: Record<string, unknown>): Promise<Response> {
  const problem = check(
    body,
    {
      version: isString(1, 64),
      uptime_s: isInt(0),
      jobs_in_progress: isInt(0),
      last_success_at: isTimestampOrNull,
      last_blocked_at: isTimestampOrNull,
      disk_free_ratio: isNumber(0, 1),
      cpu_temp_c: isNumber(),
    },
    ["version", "uptime_s", "jobs_in_progress"],
  );
  if (problem) return invalidRequest(problem);
  await env.DB.prepare("UPDATE nodes SET last_heartbeat_at = ?1, version = ?2 WHERE node_id = ?3")
    .bind(new Date().toISOString(), body.version, node.node_id)
    .run();
  log("node.heartbeat", { attrs: { node_id: node.node_id, version: body.version, jobs_in_progress: body.jobs_in_progress } });
  const response: NodeHeartbeatResponse = {
    node_id: node.node_id,
    state: "healthy",
    hourly_budget: node.hourly_budget,
    directive: "run",
  };
  return json(response);
}

type ClaimedRow = { video_id: string; lease_id: string; lease_expires_at: string; priority: number; created_at: string; attempts: number };

async function claim(env: Env, node: NodeRow, body: Record<string, unknown>): Promise<Response> {
  const problem = check(body, { max_jobs: isInt(1, 10) }, []);
  if (problem) return invalidRequest(problem);
  const maxJobs = (body.max_jobs as number | undefined) ?? DEFAULT_MAX_JOBS;
  const leaseSeconds = Number(env.LEASE_SECONDS) > 0 ? Number(env.LEASE_SECONDS) : DEFAULT_LEASE_SECONDS;
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  // Every lease id of this claim starts with this random prefix, which the second statement uses to find them.
  const prefix = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");

  // One D1 batch is one transaction: the conditional UPDATE picks and leases the jobs, and the leases rows follow from them.
  const [update] = await env.DB.batch<ClaimedRow>([
    env.DB.prepare(
      `UPDATE jobs SET status = 'leased', leased_by = ?1, lease_id = ?2 || lower(hex(randomblob(8))), lease_expires_at = ?3,
         attempts = attempts + 1, tried_nodes = json_insert(tried_nodes, '$[#]', ?1)
       WHERE status = 'queued' AND video_id IN (
         SELECT j.video_id FROM jobs j
         WHERE j.status = 'queued' AND NOT EXISTS (SELECT 1 FROM json_each(j.tried_nodes) WHERE value = ?1)
         ORDER BY j.priority DESC, j.created_at ASC, j.video_id ASC LIMIT ?4)
       RETURNING video_id, lease_id, lease_expires_at, priority, created_at, attempts`,
    ).bind(node.node_id, prefix, expiresAt, maxJobs),
    env.DB.prepare(
      `INSERT INTO leases (lease_id, video_id, node_id, issued_at, expires_at, state)
       SELECT lease_id, video_id, leased_by, ?1, lease_expires_at, 'active' FROM jobs
       WHERE leased_by = ?2 AND status = 'leased' AND lease_id LIKE ?3 || '%'`,
    ).bind(issuedAt, node.node_id, prefix),
  ]);
  const rows = (update?.results ?? []).sort(
    (a, b) => b.priority - a.priority || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || (a.video_id < b.video_id ? -1 : 1),
  );
  for (const row of rows) {
    log("job.claimed", { video_id: row.video_id, attrs: { node_id: node.node_id, attempt: row.attempts, lease_seconds: leaseSeconds } });
  }
  const response: NodeClaimResponse = {
    jobs: rows.map((r) => ({ video_id: r.video_id, lease_id: r.lease_id, lease_expires_at: r.lease_expires_at })),
  };
  return json(response);
}

export async function handleNode(request: Request, env: Env, path: string): Promise<Response> {
  const handlers: Record<string, typeof heartbeat> = { "/node/heartbeat": heartbeat, "/node/claim": claim };
  const handler = handlers[path];
  if (!handler || request.method !== "POST") return notFound();
  const node = await authenticate(request, env);
  if (node instanceof Response) return node;
  const body = await readObject(request);
  if (body instanceof Response) return body;
  return handler(env, node, body);
}
