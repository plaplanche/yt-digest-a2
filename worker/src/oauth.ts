import { encrypt, fromBase64url, randomToken } from "./crypto";
import type { Env } from "./env";
import { errorPage, escapeHtml, page } from "./html";
import { json } from "./http";
import { log } from "./log";
import { sha256Hex } from "./node";

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";
const DEFAULT_AUTH_CODE_TTL_SECONDS = 60;
const DEFAULT_AUTH_REQUEST_TTL_SECONDS = 600;
const GRANT_TYPES = ["authorization_code", "refresh_token"];

const base = (request: Request, env: Env): string => (env.PUBLIC_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
const seconds = (value: string | undefined, fallback: number): number => (Number(value) > 0 ? Number(value) : fallback);
const after = (s: number): string => new Date(Date.now() + s * 1000).toISOString();

const oauthError = (status: number, error: string, description?: string): Response =>
  json(description === undefined ? { error } : { error, error_description: description }, status);

function redirect(uri: string, params: Record<string, string | undefined>): Response {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.append(key, value);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

export async function handleOauth(request: Request, env: Env, pathname: string): Promise<Response | null> {
  const get = request.method === "GET";
  const post = request.method === "POST";
  if (get && (pathname === "/.well-known/oauth-protected-resource" || pathname === "/.well-known/oauth-protected-resource/mcp")) {
    const issuer = base(request, env);
    return json({ resource: `${issuer}/mcp`, authorization_servers: [issuer], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] });
  }
  if (get && pathname === "/.well-known/oauth-authorization-server") {
    const issuer = base(request, env);
    return json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    });
  }
  if (post && pathname === "/register") return register(request, env);
  if (get && pathname === "/authorize") return authorize(request, env);
  if (post && pathname === "/authorize/consent") return consent(request, env);
  if (get && pathname === "/callback") return callback(request, env);
  return null;
}

function validRedirectUri(value: unknown): boolean {
  if (typeof value !== "string" || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

// The first invalid field of a registration, as the error to answer, or null.
function registrationProblem(body: Record<string, unknown>): Response | null {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must hold 1 to 10 https or loopback http URLs without fragment");
  }
  const invalid = (field: string): Response => oauthError(400, "invalid_client_metadata", `Invalid ${field}`);
  const name = body.client_name;
  if (name !== undefined && (typeof name !== "string" || name.length > 200)) return invalid("client_name");
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") return invalid("token_endpoint_auth_method");
  const grants = body.grant_types;
  if (grants !== undefined && !(isStringArray(grants) && grants.every((g) => GRANT_TYPES.includes(g)))) return invalid("grant_types");
  const types = body.response_types;
  if (types !== undefined && !(isStringArray(types) && types.every((t) => t === "code"))) return invalid("response_types");
  return null;
}

async function register(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_request", "Body is not valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return oauthError(400, "invalid_request", "Body must be a JSON object");
  const fields = body as Record<string, unknown>;
  const problem = registrationProblem(fields);
  if (problem) return problem;
  const clientId = randomToken();
  const clientName = typeof fields.client_name === "string" ? fields.client_name : undefined;
  const redirectUris = fields.redirect_uris as string[];
  const now = new Date();
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(clientId, clientName ?? null, JSON.stringify(redirectUris), now.toISOString())
    .run();
  log("auth.client.registered", { attrs: { client_id: clientId } });
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      ...(clientName === undefined ? {} : { client_name: clientName }),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: GRANT_TYPES,
      response_types: ["code"],
    },
    201,
  );
}

type Client = { client_id: string; client_name: string | null; redirect_uris: string };
type PendingRequest = {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string;
  resource: string;
};

async function authorize(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const clientId = q.get("client_id");
  const redirectUri = q.get("redirect_uri");
  const client = clientId ? await env.DB.prepare("SELECT * FROM oauth_clients WHERE client_id = ?1").bind(clientId).first<Client>() : null;
  if (!client) return errorPage("Unknown client.");
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) {
    return errorPage("The redirect URI is not registered for this client.");
  }
  const state = q.get("state") ?? undefined;
  const fail = (error: string): Response => redirect(redirectUri, { error, state });
  const scope = q.get("scope") ?? SCOPE;
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = q.get("code_challenge");
  if (!challenge || q.get("code_challenge_method") !== "S256") return fail("invalid_request");
  const resource = q.get("resource");
  if (resource !== `${base(request, env)}/mcp`) return fail("invalid_target");
  if (scope !== SCOPE) return fail("invalid_scope");

  const requestId = randomToken();
  await env.DB.prepare(
    `INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(requestId, client.client_id, redirectUri, state ?? null, challenge, scope, resource, after(seconds(env.AUTH_REQUEST_TTL_SECONDS, DEFAULT_AUTH_REQUEST_TTL_SECONDS)))
    .run();
  return page(
    200,
    "Authorize access",
    `<p><strong>${escapeHtml(client.client_name ?? client.client_id)}</strong> asks to access your yt-digest data.</p>
<ul>
<li>Redirect URI: ${escapeHtml(redirectUri)}</li>
<li>Scope: ${escapeHtml(scope)}</li>
</ul>
<form method="post" action="/authorize/consent">
<input type="hidden" name="request" value="${escapeHtml(requestId)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`,
  );
}

async function consent(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorPage("The form could not be read.");
  }
  const id = form.get("request");
  const decision = form.get("decision");
  if (typeof id !== "string" || (decision !== "approve" && decision !== "deny")) return errorPage("The form is incomplete.");
  const now = new Date().toISOString();
  const pending = await env.DB.prepare(
    `SELECT request_id, client_id, redirect_uri, client_state FROM oauth_requests
     WHERE request_id = ?1 AND used_at IS NULL AND expires_at > ?2 AND google_state IS NULL`,
  )
    .bind(id, now)
    .first<PendingRequest>();
  if (!pending) return errorPage("This authorization request is unknown, expired or already used.");

  if (decision === "deny") {
    const used = await env.DB.prepare("UPDATE oauth_requests SET used_at = ?2 WHERE request_id = ?1 AND used_at IS NULL")
      .bind(id, now)
      .run();
    if (used.meta.changes === 0) return errorPage("This authorization request is unknown, expired or already used.");
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "access_denied" } });
    return redirect(pending.redirect_uri, { error: "access_denied", state: pending.client_state ?? undefined });
  }

  const endpoints = await discoverGoogle(env);
  if (!endpoints) return page(502, "Sign-in unavailable", "<p>The sign-in provider cannot be reached.</p>");
  const googleState = randomToken();
  const nonce = randomToken();
  const bound = await env.DB.prepare(
    "UPDATE oauth_requests SET google_state = ?2, google_nonce = ?3 WHERE request_id = ?1 AND used_at IS NULL AND google_state IS NULL",
  )
    .bind(id, googleState, nonce)
    .run();
  if (bound.meta.changes === 0) return errorPage("This authorization request is unknown, expired or already used.");
  const url = new URL(endpoints.authorization_endpoint);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", `${base(request, env)}/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("state", googleState);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

type GoogleEndpoints = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string };

async function fetchJson(input: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function discoverGoogle(env: Env): Promise<GoogleEndpoints | null> {
  const issuer = (env.GOOGLE_ISSUER ?? "").replace(/\/+$/, "");
  const doc = await fetchJson(`${issuer}/.well-known/openid-configuration`);
  const { authorization_endpoint: auth, token_endpoint: token, jwks_uri: jwks } = doc ?? {};
  if (typeof auth !== "string" || typeof token !== "string" || typeof jwks !== "string") return null;
  return { authorization_endpoint: auth, token_endpoint: token, jwks_uri: jwks };
}

const decodePart = (part: string): unknown => JSON.parse(new TextDecoder().decode(fromBase64url(part)));

// The claims of an ID token whose signature, issuer, audience, expiry and nonce are right, or null.
async function verifyIdToken(token: string, jwksUri: string, env: Env, nonce: string): Promise<Record<string, unknown> | null> {
  try {
    const [head, payload, signature, ...extra] = token.split(".");
    if (!head || !payload || !signature || extra.length > 0) return null;
    const header = decodePart(head) as { alg?: unknown; kid?: unknown };
    if (header.alg !== "RS256") return null;
    const jwks = await fetchJson(jwksUri);
    const keys = Array.isArray(jwks?.keys) ? (jwks.keys as (JsonWebKey & { kid?: string })[]) : [];
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${head}.${payload}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(signature), signed))) return null;
    const claims = decodePart(payload) as Record<string, unknown>;
    const issuer = (env.GOOGLE_ISSUER ?? "").replace(/\/+$/, "");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audiences.includes(env.GOOGLE_CLIENT_ID) || claims.nonce !== nonce) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

async function callback(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const state = q.get("state");
  if (!state) return errorPage("The sign-in response does not match a pending authorization.");
  const now = new Date().toISOString();
  const pending = await env.DB.prepare(
    `UPDATE oauth_requests SET used_at = ?2 WHERE google_state = ?1 AND used_at IS NULL AND expires_at > ?2
     RETURNING request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, google_nonce`,
  )
    .bind(state, now)
    .first<PendingRequest & { google_nonce: string }>();
  if (!pending) return errorPage("The sign-in response does not match a pending authorization.");
  const clientState = pending.client_state ?? undefined;
  const deny = (error: string, reason: "google_error"): Response => {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason } });
    return redirect(pending.redirect_uri, { error, state: clientState });
  };

  if (q.has("error")) return deny("access_denied", "google_error");
  const code = q.get("code");
  const endpoints = await discoverGoogle(env);
  if (!code || !endpoints) return deny("server_error", "google_error");
  const tokens = await fetchJson(endpoints.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${base(request, env)}/callback`,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  });
  const claims = typeof tokens?.id_token === "string" ? await verifyIdToken(tokens.id_token, endpoints.jwks_uri, env, pending.google_nonce) : null;
  if (!tokens || !claims || typeof claims.sub !== "string" || typeof claims.email !== "string") return deny("server_error", "google_error");

  const email = claims.email.toLowerCase();
  const invite = await env.DB.prepare("SELECT revoked FROM invites WHERE email = ?1").bind(email).first<{ revoked: number }>();
  const isAdmin = email === (env.ADMIN_EMAIL ?? "").toLowerCase();
  const refused = (reason: "not_invited" | "email_unverified"): Response => {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason } });
    return page(403, "Access refused", "<p>This account is not invited.</p>");
  };
  if (claims.email_verified !== true) return refused("email_unverified");
  const role = isAdmin ? "admin" : invite?.revoked === 0 ? "member" : null;
  if (!role) return refused("not_invited");

  const refreshToken = typeof tokens.refresh_token === "string" ? await encrypt(tokens.refresh_token, env.TOKEN_ENC_KEY ?? "") : null;
  const authCode = randomToken();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_sub) DO UPDATE SET email = excluded.email, role = excluded.role,
         google_refresh_token_enc = COALESCE(excluded.google_refresh_token_enc, users.google_refresh_token_enc)`,
    ).bind(claims.sub, email, role, refreshToken, now),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ?2 WHERE email = ?1 AND revoked = 0").bind(email, claims.sub),
    env.DB.prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(
      await sha256Hex(authCode),
      pending.client_id,
      claims.sub,
      pending.redirect_uri,
      pending.code_challenge,
      pending.scope,
      pending.resource,
      after(seconds(env.AUTH_CODE_TTL_SECONDS, DEFAULT_AUTH_CODE_TTL_SECONDS)),
    ),
  ]);
  log("auth.oauth.completed", { attrs: { client_id: pending.client_id, role } });
  return redirect(pending.redirect_uri, { code: authCode, state: clientState });
}
