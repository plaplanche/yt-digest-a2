import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import worker from "../../src/index";
import type { Env } from "../../src/env";

const call = (path: string, init?: RequestInit, e: Env = env): Promise<Response> =>
  worker.fetch(new Request(`http://worker.test${path}`, init), e);
const ops = (path: string, init: RequestInit = {}, token = "ops-test"): Promise<Response> =>
  call(path, { method: "POST", ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });

// Ajv generates code with `new Function`, which workerd forbids: the error body of contracts/error.schema.json is checked by hand.
const isErrorBody = (body: unknown): boolean => {
  const { error, ...rest } = body as { error?: Record<string, unknown> };
  return (
    Object.keys(rest).length === 0 &&
    typeof error?.code === "string" &&
    typeof error.message === "string" &&
    Object.keys(error).length === 2
  );
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const COLUMNS: Record<string, string[]> = {
  nodes: ["node_id", "owner_label", "token_hash", "state", "state_since", "last_heartbeat_at", "version", "hourly_budget", "created_at", "revoked_at"],
  jobs: ["video_id", "kind", "priority", "status", "leased_by", "lease_id", "lease_expires_at", "attempts", "tried_nodes", "last_outcome", "created_at", "done_at"],
  leases: ["lease_id", "video_id", "node_id", "issued_at", "expires_at", "state", "response_json"],
  node_events: ["node_id", "ts", "kind", "video_id"],
  invites: ["email", "invited_at", "accepted_user_sub", "revoked"],
  users: ["user_sub", "email", "role", "google_refresh_token_enc", "created_at"],
  oauth_clients: ["client_id", "client_name", "redirect_uris", "created_at"],
  oauth_requests: ["request_id", "client_id", "redirect_uri", "client_state", "code_challenge", "scope", "resource", "google_state", "google_nonce", "expires_at", "used_at"],
  oauth_codes: ["code_hash", "client_id", "user_sub", "redirect_uri", "code_challenge", "scope", "resource", "expires_at", "used_at"],
  oauth_tokens: ["token_hash", "kind", "client_id", "user_sub", "family_id", "scope", "resource", "expires_at", "used_at", "revoked_at"],
};

describe("migrations", () => {
  for (const [table, columns] of Object.entries(COLUMNS)) {
    it(`creates ${table} with its columns`, async () => {
      const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>();
      expect(results.map((r) => r.name)).toEqual(expect.arrayContaining(columns));
    });
  }
});

describe("GET /health", () => {
  it("answers 200 with the version of package.json", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ status: "ok", version: pkg.version });
  });
});

describe("unknown routes", () => {
  for (const [method, path] of [["GET", "/nope"], ["POST", "/health"], ["GET", "/ops/reset"]] as const) {
    it(`${method} ${path} gives 404 not_found`, async () => {
      const res = await call(path, { method, headers: { Authorization: "Bearer ops-test" } });
      expect(res.status).toBe(404);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      const body = await res.json();
      expect(isErrorBody(body)).toBe(true);
      expect(body).toMatchObject({ error: { code: "not_found" } });
    });
  }
});

describe("/ops authentication", () => {
  const unauthorized = async (res: Response): Promise<void> => {
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(isErrorBody(body)).toBe(true);
    expect(body).toMatchObject({ error: { code: "unauthorized" } });
  };

  it("refuses a missing bearer", async () => {
    await unauthorized(await call("/ops/reset", { method: "POST" }));
  });
  it("refuses a wrong bearer, a wrong scheme and a prefix of the token", async () => {
    await unauthorized(await ops("/ops/reset", {}, "wrong"));
    await unauthorized(await ops("/ops/reset", {}, "ops-tes"));
    await unauthorized(await call("/ops/reset", { method: "POST", headers: { Authorization: "Basic ops-test" } }));
  });
  it("checks authentication before the body", async () => {
    await unauthorized(await call("/ops/reset", { method: "POST", body: "{not json" }));
    await unauthorized(await ops("/ops/nodes", { body: "{not json" }, "wrong"));
  });
  it("answers 401 on an unknown /ops route without the bearer", async () => {
    await unauthorized(await call("/ops/whatever", { method: "GET" }));
  });
  it.each([undefined, ""])("answers 404 on every /ops route when OPS_TOKEN is %j", async (token) => {
    const e = { ...env, OPS_TOKEN: token };
    const res = await call("/ops/reset", { method: "POST", headers: { Authorization: "Bearer ops-test" } }, e);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
    expect((await call("/ops/reset", { method: "POST", headers: { Authorization: "Bearer " } }, e)).status).toBe(404);
    expect((await call("/ops/reset", { method: "POST" }, e)).status).toBe(404);
  });
});

describe("POST /ops/reset", () => {
  it("empties every table and every transcript object", async () => {
    const now = "2026-10-16T07:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES ('n1', 'x', 'h', 'healthy', ?1, ?1)").bind(now),
      env.DB.prepare("INSERT INTO jobs (video_id, kind, status, created_at) VALUES ('dQw4w9WgXcQ', 'primary', 'queued', ?1)").bind(now),
      env.DB.prepare("INSERT INTO leases (lease_id, video_id, node_id, issued_at, expires_at, state) VALUES ('l1', 'v', 'n1', ?1, ?1, 'active')").bind(now),
      env.DB.prepare("INSERT INTO node_events (node_id, ts, kind) VALUES ('n1', ?1, 'job_ok')").bind(now),
      env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('a@test', ?1)").bind(now),
      env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES ('s', 'a@test', 'admin', ?1)").bind(now),
      env.DB.prepare("INSERT INTO oauth_clients (client_id, redirect_uris, created_at) VALUES ('c', '[]', ?1)").bind(now),
      env.DB.prepare("INSERT INTO oauth_requests (request_id, client_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES ('r', 'c', 'u', 'x', 'digest', 'res', ?1)").bind(now),
      env.DB.prepare("INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES ('h', 'c', 's', 'u', 'x', 'digest', 'res', ?1)").bind(now),
      env.DB.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at) VALUES ('h', 'access', 'c', 's', 'f', 'digest', 'res', ?1)").bind(now),
    ]);
    for (let i = 0; i < 1005; i++) await env.TRANSCRIPTS.put(`transcripts/v${i}.json`, "{}");
    await env.TRANSCRIPTS.put("other/keep.txt", "keep");

    const res = await ops("/ops/reset", { body: "ignored" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    for (const table of Object.keys(COLUMNS)) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
    expect((await env.TRANSCRIPTS.list({ prefix: "transcripts/" })).objects).toHaveLength(0);
    expect(await env.TRANSCRIPTS.head("other/keep.txt")).not.toBeNull();
    await env.TRANSCRIPTS.delete("other/keep.txt");
  });
});
