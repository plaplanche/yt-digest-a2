import type { Env } from "./env";
import { log } from "./log";
import { sha256Hex } from "./node";
import { encryptSecret, randomToken } from "./secrets";

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const oauthError = (status: number, error: string, description?: string): Response =>
  jsonResponse(description ? { error, error_description: description } : { error }, status);

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function page(status: number, title: string, body: string): Response {
  const html = `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>\n`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
const errorPage = (status: number, message: string): Response =>
  page(status, "Error", `<h1>Error</h1><p>${escapeHtml(message)}</p>`);

const baseUrl = (env: Env): string => (env.PUBLIC_URL ?? "").replace(/\/+$/, "");
const seconds = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
};
const inSeconds = (n: number): string => new Date(Date.now() + n * 1000).toISOString();

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}
function clientRedirect(redirectUri: string, params: Record<string, string | null>): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  return redirect(url.toString());
}

// --- 10.1 discovery ---

function protectedResource(env: Env): Response {
  const base = baseUrl(env);
  return jsonResponse({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  });
}

function authorizationServer(env: Env): Response {
  const base = baseUrl(env);
  return jsonResponse({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
}

// --- 10.2 registration ---

function validRedirectUri(value: unknown): boolean {
  if (typeof value !== "string" || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

const isSubset = (value: unknown, allowed: string[]): boolean =>
  Array.isArray(value) && value.every((v) => typeof v === "string" && allowed.includes(v));

async function register(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_request", "Body is not valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return oauthError(400, "invalid_request", "Body must be a JSON object");
  }
  const meta = body as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must hold 1 to 10 valid redirect URIs");
  }
  const name = meta.client_name;
  if (name !== undefined && (typeof name !== "string" || name.length > 200)) {
    return oauthError(400, "invalid_client_metadata", "Invalid client_name");
  }
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== "none") {
    return oauthError(400, "invalid_client_metadata", "Invalid token_endpoint_auth_method");
  }
  if (meta.grant_types !== undefined && !isSubset(meta.grant_types, ["authorization_code", "refresh_token"])) {
    return oauthError(400, "invalid_client_metadata", "Invalid grant_types");
  }
  if (meta.response_types !== undefined && !isSubset(meta.response_types, ["code"])) {
    return oauthError(400, "invalid_client_metadata", "Invalid response_types");
  }
  const clientId = randomToken(16);
  const now = new Date();
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(clientId, name ?? null, JSON.stringify(uris), now.toISOString())
    .run();
  log("auth.client.registered", { attrs: { client_id: clientId } });
  return jsonResponse(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      ...(name !== undefined ? { client_name: name } : {}),
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

// --- 10.3 authorize and consent ---

interface Client {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
}

async function authorize(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams;
  const clientId = q.get("client_id");
  const client = clientId
    ? await env.DB.prepare("SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?1").bind(clientId).first<Client>()
    : null;
  const redirectUri = q.get("redirect_uri");
  if (!client) return errorPage(400, "Unknown client.");
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) {
    return errorPage(400, "The redirect URI is not registered for this client.");
  }
  const state = q.get("state");
  const fail = (error: string): Response => clientRedirect(redirectUri, { error, state });
  const challenge = q.get("code_challenge");
  const scope = q.get("scope") ?? SCOPE;
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  if (!challenge || q.get("code_challenge_method") !== "S256") return fail("invalid_request");
  const resource = q.get("resource");
  if (resource !== `${baseUrl(env)}/mcp`) return fail("invalid_target");
  if (scope !== SCOPE) return fail("invalid_scope");

  const requestId = randomToken(16);
  await env.DB.prepare(
    `INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(requestId, client.client_id, redirectUri, state, challenge, scope, resource, inSeconds(seconds(env.AUTH_REQUEST_TTL_SECONDS, 600)))
    .run();
  return page(
    200,
    "Authorize access",
    `<h1>Authorize access</h1>
<p><strong>${escapeHtml(client.client_name ?? client.client_id)}</strong> asks to access your yt-digest account.</p>
<p>Redirect URI: <code>${escapeHtml(redirectUri)}</code></p>
<p>Scope: <code>${escapeHtml(scope)}</code></p>
<form method="post" action="/authorize/consent">
<input type="hidden" name="request" value="${escapeHtml(requestId)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`,
  );
}

interface Pending {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string;
  resource: string;
}
const PENDING_COLUMNS = "request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource";

async function consent(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorPage(400, "Invalid request.");
  }
  const requestId = form.get("request");
  const decision = form.get("decision");
  if (typeof requestId !== "string" || (decision !== "approve" && decision !== "deny")) return errorPage(400, "Invalid request.");
  const now = new Date().toISOString();

  if (decision === "deny") {
    const pending = await env.DB.prepare(
      `UPDATE oauth_requests SET used_at = ?2 WHERE request_id = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING ${PENDING_COLUMNS}`,
    )
      .bind(requestId, now)
      .first<Pending>();
    if (!pending) return errorPage(400, "This authorization request is unknown, expired or already used.");
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "access_denied" } });
    return clientRedirect(pending.redirect_uri, { error: "access_denied", state: pending.client_state });
  }

  // Binds the Google state once: an approval cannot be replayed to rebind a pending authorization.
  const googleState = randomToken(24);
  const googleNonce = randomToken(24);
  const bound = await env.DB.prepare(
    `UPDATE oauth_requests SET google_state = ?2, google_nonce = ?3
     WHERE request_id = ?1 AND used_at IS NULL AND google_state IS NULL AND expires_at > ?4 RETURNING request_id`,
  )
    .bind(requestId, googleState, googleNonce, now)
    .first();
  if (!bound) return errorPage(400, "This authorization request is unknown, expired or already used.");

  const discovery = await googleDiscovery(env);
  if (!discovery) return errorPage(502, "The identity provider is unavailable.");
  const target = new URL(discovery.authorization_endpoint);
  const params: Record<string, string> = {
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: `${baseUrl(env)}/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: googleState,
    nonce: googleNonce,
    access_type: "offline",
    prompt: "consent",
  };
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return redirect(target.toString());
}

// --- 10.4 callback ---

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

async function googleDiscovery(env: Env): Promise<Discovery | null> {
  try {
    const res = await fetch(`${(env.GOOGLE_ISSUER ?? "").replace(/\/+$/, "")}/.well-known/openid-configuration`);
    if (!res.ok) return null;
    const doc = (await res.json()) as Partial<Discovery>;
    const { authorization_endpoint, token_endpoint, jwks_uri } = doc;
    if (typeof authorization_endpoint !== "string" || typeof token_endpoint !== "string" || typeof jwks_uri !== "string") return null;
    return { authorization_endpoint, token_endpoint, jwks_uri };
  } catch {
    return null;
  }
}

interface IdClaims {
  sub: string;
  email: string;
  email_verified: boolean;
}

const decodeSegment = (segment: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(segment.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// Verifies RS256 signature, iss, aud, exp and nonce (10.4 step 3); null on any failure.
async function verifyIdToken(token: string, jwksUri: string, env: Env, nonce: string): Promise<IdClaims | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = JSON.parse(new TextDecoder().decode(decodeSegment(h))) as { alg?: unknown; kid?: unknown };
    if (header.alg !== "RS256") return null;
    const res = await fetch(jwksUri);
    if (!res.ok) return null;
    const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
    const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${h}.${p}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeSegment(s), signed))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeSegment(p))) as Record<string, unknown>;
    const issuer = (env.GOOGLE_ISSUER ?? "").replace(/\/+$/, "");
    if (claims.iss !== issuer || claims.aud !== env.GOOGLE_CLIENT_ID) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
    if (claims.nonce !== nonce) return null;
    if (typeof claims.sub !== "string" || typeof claims.email !== "string") return null;
    return { sub: claims.sub, email: claims.email, email_verified: claims.email_verified === true };
  } catch {
    return null;
  }
}

function refusalPage(): Response {
  return page(403, "Access refused", "<h1>Access refused</h1><p>This account is not invited.</p>");
}

async function callback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get("state");
  const now = new Date().toISOString();
  const pending = state
    ? await env.DB.prepare(
        `UPDATE oauth_requests SET used_at = ?2 WHERE google_state = ?1 AND used_at IS NULL AND expires_at > ?2
         RETURNING ${PENDING_COLUMNS}, google_nonce`,
      )
        .bind(state, now)
        .first<Pending & { google_nonce: string }>()
    : null;
  if (!pending) return errorPage(400, "This sign-in is unknown, expired or already used.");
  const deny = (reason: "access_denied" | "google_error", error: string): Response => {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason } });
    return clientRedirect(pending.redirect_uri, { error, state: pending.client_state });
  };
  if (url.searchParams.has("error")) return deny("access_denied", "access_denied");

  const code = url.searchParams.get("code");
  const discovery = code ? await googleDiscovery(env) : null;
  if (!code || !discovery) return deny("google_error", "server_error");
  let tokens: { id_token?: unknown; refresh_token?: unknown };
  try {
    const res = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${baseUrl(env)}/callback`,
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      }),
    });
    if (!res.ok) return deny("google_error", "server_error");
    tokens = (await res.json()) as typeof tokens;
  } catch {
    return deny("google_error", "server_error");
  }
  const claims =
    typeof tokens.id_token === "string" ? await verifyIdToken(tokens.id_token, discovery.jwks_uri, env, pending.google_nonce) : null;
  if (!claims) return deny("google_error", "server_error");

  const email = claims.email.toLowerCase();
  if (!claims.email_verified) {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "email_unverified" } });
    return refusalPage();
  }
  const isAdmin = email === (env.ADMIN_EMAIL ?? "").toLowerCase();
  const invite = isAdmin
    ? null
    : await env.DB.prepare("SELECT email FROM invites WHERE email = ?1 AND revoked = 0").bind(email).first();
  if (!isAdmin && !invite) {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "not_invited" } });
    return refusalPage();
  }
  const role = isAdmin ? "admin" : "member";

  const refreshEnc = typeof tokens.refresh_token === "string" ? await encryptSecret(tokens.refresh_token, env.TOKEN_ENC_KEY ?? "") : null;
  const authCode = randomToken(32);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_sub) DO UPDATE SET email = ?2, role = ?3,
         google_refresh_token_enc = COALESCE(?4, google_refresh_token_enc)`,
    ).bind(claims.sub, email, role, refreshEnc, now),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ?2 WHERE email = ?1").bind(email, claims.sub),
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
      inSeconds(seconds(env.AUTH_CODE_TTL_SECONDS, 60)),
    ),
  ]);
  log("auth.oauth.completed", { attrs: { client_id: pending.client_id, role } });
  return clientRedirect(pending.redirect_uri, { code: authCode, state: pending.client_state });
}

// Answers the OAuth routes of 10.1 to 10.4; null for any other route or method.
export async function handleOAuth(request: Request, env: Env, path: string): Promise<Response | null> {
  const { method } = request;
  if (method === "GET" && (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")) {
    return protectedResource(env);
  }
  if (method === "GET" && path === "/.well-known/oauth-authorization-server") return authorizationServer(env);
  if (method === "POST" && path === "/register") return register(request, env);
  if (method === "GET" && path === "/authorize") return authorize(new URL(request.url), env);
  if (method === "POST" && path === "/authorize/consent") return consent(request, env);
  if (method === "GET" && path === "/callback") return callback(new URL(request.url), env);
  return null;
}
