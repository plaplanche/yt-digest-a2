import { log } from "./log";
import { errorResponse, json, notFound } from "./http";
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

export async function handleOps(request: Request, env: Env, path: string): Promise<Response> {
  const token = env.OPS_TOKEN;
  if (!token) return notFound();
  if (!(await authenticated(request, token))) return errorResponse(401, "unauthorized", "Missing or wrong operator bearer");
  if (request.method === "POST" && path === "/ops/reset") return reset(env);
  return notFound();
}
