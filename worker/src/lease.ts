import type { NodeJobAck } from "./contracts/node-job-ack";
import type { NodeResultRequest } from "./contracts/node-result-request";
import type { Env } from "./env";
import { errorResponse, json } from "./http";
import { log } from "./log";
import {
  VIDEO_ID,
  check,
  invalidRequest,
  isInt,
  isNumber,
  isString,
  type Fields,
} from "./validate";

export const MAX_ATTEMPTS = 3;

type NodeEventKind = "job_ok" | "job_no_transcript" | "job_unavailable" | "job_blocked" | "job_error" | "lease_expired" | "validation_failed";
type LeaseRow = { lease_id: string; video_id: string; node_id: string; state: string; response_json: string | null };
type JobStatus = NodeJobAck["status"];

// The failure handling of 8.7 for the job held through `lease`, once the lease left the `active` state in `leaseState`.
// Returns the job's new status, or null when another request already ended this lease.
async function failLease(
  env: Env,
  lease: Pick<LeaseRow, "lease_id" | "video_id" | "node_id">,
  leaseState: "completed" | "rejected" | "expired" | "revoked",
  lastOutcome: string,
  eventKind: NodeEventKind | null,
  mustBeExpiredAt?: string,
): Promise<{ status: JobStatus; attempts: number } | null> {
  const now = new Date().toISOString();
  // The lease update is the arbiter: only one request moves a lease out of `active`.
  const arbiter = await env.DB.prepare(
    "UPDATE leases SET state = ?1 WHERE lease_id = ?2 AND state = 'active' AND (?3 IS NULL OR expires_at <= ?3)",
  )
    .bind(leaseState, lease.lease_id, mustBeExpiredAt ?? null)
    .run();
  if (arbiter.meta.changes !== 1) return null;
  const statements = [
    env.DB.prepare(
      `UPDATE jobs SET status = CASE WHEN attempts >= ?1 THEN 'failed_video' ELSE 'queued' END,
         done_at = CASE WHEN attempts >= ?1 THEN ?2 ELSE done_at END,
         leased_by = NULL, lease_id = NULL, lease_expires_at = NULL, last_outcome = ?3
       WHERE video_id = ?4 AND kind = 'primary' AND lease_id = ?5 AND status = 'leased'
       RETURNING status, attempts`,
    ).bind(MAX_ATTEMPTS, now, lastOutcome, lease.video_id, lease.lease_id),
  ];
  if (eventKind) statements.push(recordEvent(env, lease.node_id, eventKind, lease.video_id, now));
  const [update] = await env.DB.batch<{ status: JobStatus; attempts: number }>(statements);
  return update?.results[0] ?? null;
}

const recordEvent = (env: Env, nodeId: string, kind: NodeEventKind, videoId: string, ts: string): D1PreparedStatement =>
  env.DB.prepare("INSERT INTO node_events (node_id, ts, kind, video_id) VALUES (?1, ?2, ?3, ?4)").bind(nodeId, ts, kind, videoId);

// 8.6: every leased job whose lease is at or before now goes through the failure handling.
export async function sweepExpired(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    "SELECT lease_id, video_id, leased_by AS node_id FROM jobs WHERE status = 'leased' AND lease_expires_at <= ?1",
  )
    .bind(now)
    .all<{ lease_id: string; video_id: string; node_id: string }>();
  for (const lease of results) {
    const after = await failLease(env, lease, "expired", "lease_expired", "lease_expired", now);
    if (after) {
      log("job.lease_expired", { video_id: lease.video_id, attrs: { node_id: lease.node_id, attempts: after.attempts, status: after.status } });
    }
  }
}

// 8.8: the active leases of a revoked node. Returns how many were revoked.
export async function revokeLeases(env: Env, nodeId: string): Promise<number> {
  const { results } = await env.DB.prepare("SELECT lease_id, video_id, node_id FROM leases WHERE node_id = ?1 AND state = 'active'")
    .bind(nodeId)
    .all<{ lease_id: string; video_id: string; node_id: string }>();
  let revoked = 0;
  for (const lease of results) {
    if (await failLease(env, lease, "revoked", "lease_revoked", null)) revoked++;
  }
  return revoked;
}

const lookupLease = (env: Env, leaseId: string): Promise<LeaseRow | null> =>
  env.DB.prepare("SELECT lease_id, video_id, node_id, state, response_json FROM leases WHERE lease_id = ?1").bind(leaseId).first<LeaseRow>();

const stale = (lease: LeaseRow | null, nodeId: string): Response => {
  log("job.stale_result", { ...(lease ? { video_id: lease.video_id } : {}), attrs: { node_id: nodeId } });
  return errorResponse(409, "stale_lease", "The lease is unknown, not yours or no longer active");
};

const isTranscript = (v: unknown): boolean => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return (
    check(
      v as Fields,
      {
        video_id: (x) => typeof x === "string" && VIDEO_ID.test(x),
        status: (x) => x === "ok" || x === "no_transcript" || x === "unavailable" || x === "blocked",
        lang: (x) => x === null || typeof x === "string",
        source: (x) => x === null || x === "manual" || x === "auto",
        word_count: isInt(0),
        truncated: (x) => typeof x === "boolean",
        sponsor_ratio: (x) => x === null || isNumber(0, 1)(x),
        pages: (x) => Array.isArray(x) && x.every((p) => typeof p === "string"),
      },
      ["video_id", "status", "lang", "source", "word_count", "truncated", "sponsor_ratio", "pages"],
    ) === null
  );
};

// The reason a result breaks the validation rules of 8.4 step 3, or null.
function validationProblem(req: NodeResultRequest, videoId: string): string | null {
  if (req.outcome !== "ok") return req.transcript === null ? null : "transcript must be null unless the outcome is ok";
  const t = req.transcript;
  if (t === null) return "transcript is null with outcome ok";
  if (t.status !== "ok") return "transcript status is not ok";
  if (t.video_id !== videoId) return "transcript video_id differs from the job's";
  if (t.pages.length === 0) return "transcript has no page";
  const words = t.pages.filter((p) => p !== "[…]").reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0);
  if (t.word_count !== words) return "word_count does not match the pages";
  return null;
}

const ack = (videoId: string, status: JobStatus): NodeJobAck => ({ video_id: videoId, status });

async function storeResponse(env: Env, leaseId: string, response: NodeJobAck): Promise<void> {
  await env.DB.prepare("UPDATE leases SET response_json = ?1 WHERE lease_id = ?2").bind(JSON.stringify(response), leaseId).run();
}

export async function result(env: Env, nodeId: string, body: Fields): Promise<Response> {
  const problem = check(body, { lease_id: isString(1), outcome: (v) => ["ok", "no_transcript", "unavailable", "blocked", "error"].includes(v as string), transcript: (v) => v === null || isTranscript(v) }, [
    "lease_id",
    "outcome",
    "transcript",
  ]);
  if (problem) return invalidRequest(problem);
  const req = body as unknown as NodeResultRequest;
  await sweepExpired(env);

  // Two attempts: a concurrent retry of the same request may finish the lease between the lookup and our update.
  for (let attempt = 0; attempt < 2; attempt++) {
    const lease = await lookupLease(env, req.lease_id);
    if (!lease || lease.node_id !== nodeId) return stale(lease, nodeId);
    if (lease.state === "completed" && lease.response_json) return new Response(lease.response_json, { headers: { "Content-Type": "application/json" } });
    if (lease.state !== "active") return stale(lease, nodeId);

    const reason = validationProblem(req, lease.video_id);
    if (reason) {
      const after = await failLease(env, lease, "rejected", "validation_failed", "validation_failed");
      if (!after) continue;
      log("job.validation_failed", { video_id: lease.video_id, attrs: { node_id: nodeId, reason } });
      return errorResponse(422, "validation_failed", reason);
    }

    if (req.outcome === "ok" && req.transcript) {
      try {
        // onlyIf makes the write a no-op when an object exists: a transcript is never overwritten.
        await env.TRANSCRIPTS.put(`transcripts/${lease.video_id}.json`, JSON.stringify(req.transcript), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { node_id: nodeId, lease_id: lease.lease_id, produced_at: new Date().toISOString() },
          onlyIf: { etagDoesNotMatch: "*" },
        });
      } catch {
        return errorResponse(503, "storage_error", "The transcript could not be stored");
      }
    }

    let status: JobStatus;
    if (req.outcome === "ok" || req.outcome === "no_transcript") {
      const done = await completeLease(env, lease, req.outcome);
      if (!done) continue;
      status = "done";
    } else {
      const after = await failLease(env, lease, "completed", req.outcome, `job_${req.outcome}`);
      if (!after) continue;
      status = after.status;
    }
    const response = ack(lease.video_id, status);
    await storeResponse(env, lease.lease_id, response);
    log("job.completed", { video_id: lease.video_id, attrs: { node_id: nodeId, outcome: req.outcome, status } });
    return json(response);
  }
  return stale(null, nodeId);
}

// A terminal outcome: the lease is completed and the job done.
async function completeLease(env: Env, lease: LeaseRow, outcome: "ok" | "no_transcript"): Promise<boolean> {
  const now = new Date().toISOString();
  const arbiter = await env.DB.prepare("UPDATE leases SET state = 'completed' WHERE lease_id = ?1 AND state = 'active'").bind(lease.lease_id).run();
  if (arbiter.meta.changes !== 1) return false;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET status = 'done', done_at = ?1, lease_expires_at = NULL, last_outcome = ?2
       WHERE video_id = ?3 AND kind = 'primary' AND lease_id = ?4 AND status = 'leased'`,
    ).bind(now, outcome, lease.video_id, lease.lease_id),
    recordEvent(env, lease.node_id, `job_${outcome}`, lease.video_id, now),
  ]);
  return true;
}

export async function release(env: Env, nodeId: string, body: Fields): Promise<Response> {
  const problem = check(body, { lease_id: isString(1) }, ["lease_id"]);
  if (problem) return invalidRequest(problem);
  await sweepExpired(env);

  for (let attempt = 0; attempt < 2; attempt++) {
    const lease = await lookupLease(env, String(body.lease_id));
    if (!lease || lease.node_id !== nodeId) return stale(lease, nodeId);
    if (lease.state === "released" && lease.response_json) return new Response(lease.response_json, { headers: { "Content-Type": "application/json" } });
    if (lease.state !== "active") return stale(lease, nodeId);

    const response = ack(lease.video_id, "queued");
    const arbiter = await env.DB.prepare("UPDATE leases SET state = 'released', response_json = ?1 WHERE lease_id = ?2 AND state = 'active'")
      .bind(JSON.stringify(response), lease.lease_id)
      .run();
    if (arbiter.meta.changes !== 1) continue;
    await env.DB.prepare(
      `UPDATE jobs SET status = 'queued', leased_by = NULL, lease_id = NULL, lease_expires_at = NULL, attempts = attempts - 1,
         tried_nodes = (SELECT json_group_array(value) FROM json_each(tried_nodes) WHERE value != ?1), last_outcome = 'released'
       WHERE video_id = ?2 AND kind = 'primary' AND lease_id = ?3 AND status = 'leased'`,
    )
      .bind(nodeId, lease.video_id, lease.lease_id)
      .run();
    log("job.released", { video_id: lease.video_id, attrs: { node_id: nodeId } });
    return json(response);
  }
  return stale(null, nodeId);
}
