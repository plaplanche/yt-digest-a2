import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

const BASE = "http://worker.test";
const REDIRECT = "http://127.0.0.1:9/cb";
const ISSUER = "http://google.test";
const RESOURCE = `${BASE}/mcp`;

const call = (path: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(`${BASE}${path}`, init), env);
const ops = (path: string, body?: unknown): Promise<Response> =>
  call(path, { method: "POST", headers: { Authorization: "Bearer ops-test" }, body: body === undefined ? undefined : JSON.stringify(body) });
const register = (body: unknown): Promise<Response> => call("/register", { method: "POST", body: JSON.stringify(body) });
const b64url = (data: ArrayBuffer | string): string =>
  btoa(typeof data === "string" ? data : String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };
const generate = (): Promise<CryptoKeyPair> =>
  crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;

async function signJwt(claims: Record<string, unknown>, pair = keys): Promise<string> {
  const head = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

// What the stub of Google's token endpoint answers next, and the claims of its ID token.
let idClaims: Record<string, unknown>;
let signWith: () => CryptoKeyPair;
let tokenStatus: number;
let tokenRequests: URLSearchParams[];
let logs: string[];

beforeAll(async () => {
  keys = await generate();
  otherKeys = await generate();
  jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

beforeEach(async () => {
  logs = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(line));
  await ops("/ops/reset");
  tokenStatus = 200;
  tokenRequests = [];
  signWith = () => keys;
  idClaims = {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== ISSUER) throw new Error(`unexpected fetch ${url}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
    if (url.pathname === "/token") {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      if (tokenStatus !== 200) return Response.json({ error: "invalid_grant" }, { status: tokenStatus });
      const nonce = lastNonce;
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: ISSUER, aud: "yt-digest-test", sub: "g-bob", email: "bob@test", email_verified: true, iat: now, exp: now + 3600, nonce, ...idClaims };
      return Response.json({ access_token: "g-access", refresh_token: "g-refresh-secret", id_token: await signJwt(claims, signWith()) });
    }
    return new Response("nope", { status: 404 });
  });
});

let lastNonce = "";

async function newClient(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await register({ redirect_uris: [REDIRECT], client_name: "Test <b>client</b>", ...extra });
  return ((await res.json()) as { client_id: string }).client_id;
}
const authorizeQuery = (clientId: string, extra: Record<string, string | null> = {}): string => {
  const params: Record<string, string | null> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: "challenge-value",
    code_challenge_method: "S256",
    resource: RESOURCE,
    state: "client-state",
    ...extra,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null) q.set(k, v);
  return `/authorize?${q}`;
};
const location = (res: Response): URL => new URL(res.headers.get("Location") ?? "");
const consent = (request: string, decision: string): Promise<Response> =>
  call("/authorize/consent", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request, decision }) });

async function pendingRequestId(clientId: string): Promise<string> {
  const res = await call(authorizeQuery(clientId));
  expect(res.status).toBe(200);
  return /name="request" value="([^"]+)"/.exec(await res.text())?.[1] ?? "";
}
// Runs consent approval and returns the state Google would send back.
async function approve(clientId: string): Promise<string> {
  const res = await consent(await pendingRequestId(clientId), "approve");
  expect(res.status).toBe(302);
  lastNonce = location(res).searchParams.get("nonce") ?? "";
  return location(res).searchParams.get("state") ?? "";
}
const callback = (state: string, extra = "code=g-code"): Promise<Response> => call(`/callback?state=${encodeURIComponent(state)}&${extra}`);
const users = async (): Promise<{ user_sub: string; email: string; role: string }[]> =>
  ((await (await call("/ops/users", { headers: { Authorization: "Bearer ops-test" } })).json()) as { users: { user_sub: string; email: string; role: string }[] }).users;

describe("discovery (10.1)", () => {
  it("serves the protected resource metadata on both paths", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await call(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ resource: RESOURCE, authorization_servers: [BASE], scopes_supported: ["digest"], bearer_methods_supported: ["header"] });
    }
  });
  it("serves the authorization server metadata", async () => {
    const res = await call("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["digest"],
    });
  });
});

describe("POST /register (10.2)", () => {
  it("registers a public client and logs auth.client.registered", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await register({ redirect_uris: [REDIRECT, "https://app.example/cb"], client_name: "My client", token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      client_name: "My client",
      redirect_uris: [REDIRECT, "https://app.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect((body.client_id as string).length).toBeGreaterThanOrEqual(16);
    expect(body.client_id_issued_at).toBeGreaterThanOrEqual(before);
    expect(logs.map((l) => JSON.parse(l)).find((l) => l.event === "auth.client.registered").attrs).toEqual({ client_id: body.client_id });
  });
  it("omits client_name when none is given", async () => {
    const body = (await (await register({ redirect_uris: [REDIRECT] })).json()) as Record<string, unknown>;
    expect("client_name" in body).toBe(false);
  });
  it.each([
    ["missing", undefined],
    ["empty", []],
    ["not an array", REDIRECT],
    ["a relative URI", ["/cb"]],
    ["plain http on another host", ["http://example.com/cb"]],
    ["a fragment", ["https://app.example/cb#x"]],
    ["a custom scheme", ["app://cb"]],
    ["11 URIs", Array.from({ length: 11 }, (_, i) => `https://app.example/${i}`)],
  ])("refuses %s redirect_uris with invalid_redirect_uri", async (_name, uris) => {
    const res = await register({ redirect_uris: uris });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_redirect_uri");
  });
  it.each([
    { client_name: "x".repeat(201) },
    { client_name: 5 },
    { token_endpoint_auth_method: "client_secret_basic" },
    { grant_types: ["password"] },
    { response_types: ["token"] },
  ])("refuses %j with invalid_client_metadata", async (extra) => {
    const res = await register({ redirect_uris: [REDIRECT], ...extra });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_client_metadata");
  });
  it("accepts http on localhost and 127.0.0.1, and 200 characters of name", async () => {
    expect((await register({ redirect_uris: ["http://localhost:3000/cb", "http://127.0.0.1/cb"], client_name: "x".repeat(200) })).status).toBe(201);
  });
  it("refuses a body that is not JSON with 400 invalid_request", async () => {
    const res = await call("/register", { method: "POST", body: "nope" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
  });
});

describe("GET /authorize (10.3)", () => {
  it("answers 400 HTML, never a redirect, for an unknown client or a non-exact redirect_uri", async () => {
    const id = await newClient();
    for (const path of [
      authorizeQuery("unknown"),
      authorizeQuery(id, { redirect_uri: null }),
      authorizeQuery(id, { redirect_uri: `${REDIRECT}/` }),
      authorizeQuery(id, { redirect_uri: "http://127.0.0.1:9/cb?x=1" }),
      authorizeQuery(id, { redirect_uri: "http://127.0.0.1:9/CB" }),
    ]) {
      const res = await call(path);
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Location")).toBeNull();
    }
  });
  it("redirects each error in order with error and state", async () => {
    const id = await newClient();
    const cases: [Record<string, string | null>, string][] = [
      [{ response_type: "token", code_challenge: null, resource: null, scope: "other" }, "unsupported_response_type"],
      [{ code_challenge: null, resource: null, scope: "other" }, "invalid_request"],
      [{ code_challenge_method: "plain", resource: null, scope: "other" }, "invalid_request"],
      [{ code_challenge_method: null, resource: null, scope: "other" }, "invalid_request"],
      [{ resource: null, scope: "other" }, "invalid_target"],
      [{ resource: `${BASE}/mcp/`, scope: "other" }, "invalid_target"],
      [{ scope: "other" }, "invalid_scope"],
      [{ scope: "digest other" }, "invalid_scope"],
    ];
    for (const [extra, error] of cases) {
      const res = await call(authorizeQuery(id, extra));
      expect(res.status, JSON.stringify(extra)).toBe(302);
      const to = location(res);
      expect(to.origin + to.pathname).toBe(REDIRECT);
      expect(to.searchParams.get("error")).toBe(error);
      expect(to.searchParams.get("state")).toBe("client-state");
    }
    const noState = location(await call(authorizeQuery(id, { state: null, response_type: "token" })));
    expect(noState.searchParams.has("state")).toBe(false);
  });
  it("shows the consent page with the client name escaped and two decision buttons", async () => {
    const id = await newClient();
    const res = await call(authorizeQuery(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Test &lt;b&gt;client&lt;/b&gt;");
    expect(html).not.toContain("<b>client</b>");
    expect(html).toContain(REDIRECT);
    expect(html).toContain("digest");
    expect(html).toContain('<form method="post" action="/authorize/consent">');
    expect(html).toMatch(/<input type="hidden" name="request" value="[A-Za-z0-9_-]{16,}">/);
    expect(html).toContain('<button type="submit" name="decision" value="approve">');
    expect(html).toContain('<button type="submit" name="decision" value="deny">');
    expect((html.match(/<button type="submit" name="decision"/g) ?? []).length).toBe(2);
  });
  it("shows the client_id when the client has no name, and the default scope", async () => {
    const id = ((await (await register({ redirect_uris: [REDIRECT] })).json()) as { client_id: string }).client_id;
    const html = await (await call(authorizeQuery(id, { scope: null }))).text();
    expect(html).toContain(id);
  });
});

describe("POST /authorize/consent (10.3)", () => {
  it("refuses an unknown request and a bad decision with 400 HTML", async () => {
    const id = await newClient();
    const request = await pendingRequestId(id);
    for (const res of [await consent("unknown", "approve"), await consent("unknown", "deny"), await consent(request, "maybe")]) {
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("text/html");
    }
    expect((await call("/authorize/consent", { method: "POST", body: "not a form" })).status).toBe(400);
  });
  it("deny redirects with access_denied and the state, and uses the request up", async () => {
    const id = await newClient();
    const request = await pendingRequestId(id);
    const res = await consent(request, "deny");
    expect(res.status).toBe(302);
    const to = location(res);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("client-state");
    expect((await consent(request, "deny")).status).toBe(400);
    expect((await consent(request, "approve")).status).toBe(400);
    expect(logs.map((l) => JSON.parse(l)).some((l) => l.event === "auth.oauth.denied" && l.attrs.reason === "access_denied")).toBe(true);
  });
  it("approve redirects to Google with every parameter", async () => {
    const id = await newClient();
    const res = await consent(await pendingRequestId(id), "approve");
    expect(res.status).toBe(302);
    const to = location(res);
    expect(to.origin + to.pathname).toBe(`${ISSUER}/authorize`);
    const p = to.searchParams;
    expect(p.get("client_id")).toBe("yt-digest-test");
    expect(p.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email https://www.googleapis.com/auth/youtube.readonly");
    expect(p.get("state")?.length).toBeGreaterThanOrEqual(16);
    expect(p.get("nonce")?.length).toBeGreaterThanOrEqual(16);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
  });
  it("binds a new state and nonce per pending authorization, and approves only once", async () => {
    const id = await newClient();
    const a = await approve(id);
    const b = await approve(id);
    expect(a).not.toBe(b);
    const request = await pendingRequestId(id);
    expect((await consent(request, "approve")).status).toBe(302);
    expect((await consent(request, "approve")).status).toBe(400);
  });
  it("refuses an expired request", async () => {
    const id = await newClient();
    const request = await pendingRequestId(id);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?1").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await consent(request, "approve")).status).toBe(400);
  });
});

describe("GET /callback (10.4)", () => {
  it("refuses an unknown state with 400 HTML, and a state only once", async () => {
    expect((await callback("nope")).status).toBe(400);
    expect((await call("/callback?code=x")).status).toBe(400);
    await ops("/ops/invites", { email: "bob@test" });
    const state = await approve(await newClient());
    expect((await callback(state)).status).toBe(302);
    const again = await callback(state);
    expect(again.status).toBe(400);
    expect(again.headers.get("Content-Type")).toContain("text/html");
  });
  it("refuses an expired pending authorization", async () => {
    const state = await approve(await newClient());
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?1").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await callback(state)).status).toBe(400);
  });
  it("turns a Google error into access_denied for the client, using the request up", async () => {
    const state = await approve(await newClient());
    const res = await callback(state, "error=access_denied");
    expect(res.status).toBe(302);
    expect(location(res).searchParams.get("error")).toBe("access_denied");
    expect(location(res).searchParams.get("state")).toBe("client-state");
    expect((await callback(state)).status).toBe(400);
  });
  it("gives an invited user a code and a member row, exchanging the code with the client secret", async () => {
    await ops("/ops/invites", { email: "Bob@Test" });
    const id = await newClient();
    const res = await callback(await approve(id));
    expect(res.status).toBe(302);
    const to = location(res);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get("state")).toBe("client-state");
    const code = to.searchParams.get("code") ?? "";
    expect(code.length).toBeGreaterThanOrEqual(32);
    expect(await users()).toEqual([{ user_sub: "g-bob", email: "bob@test", role: "member" }]);
    expect(Object.fromEntries(tokenRequests[0] ?? [])).toMatchObject({
      grant_type: "authorization_code",
      code: "g-code",
      redirect_uri: `${BASE}/callback`,
      client_id: "yt-digest-test",
      client_secret: "google-secret-test",
    });
    const invite = await env.DB.prepare("SELECT accepted_user_sub FROM invites WHERE email = 'bob@test'").first<{ accepted_user_sub: string }>();
    expect(invite?.accepted_user_sub).toBe("g-bob");
    const row = await env.DB.prepare("SELECT * FROM oauth_codes").first<Record<string, unknown>>();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
    expect(row).toMatchObject({
      code_hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      client_id: id,
      user_sub: "g-bob",
      redirect_uri: REDIRECT,
      code_challenge: "challenge-value",
      scope: "digest",
      resource: RESOURCE,
      used_at: null,
    });
    expect(Date.parse(row?.expires_at as string) - Date.now()).toBeLessThanOrEqual(60_000);
    const completed = logs.map((l) => JSON.parse(l)).find((l) => l.event === "auth.oauth.completed");
    expect(completed.attrs).toEqual({ client_id: id, role: "member" });
  });
  it("admits the admin without an invite, with the admin role", async () => {
    idClaims = { sub: "g-alice", email: "Alice@Test" };
    const res = await callback(await approve(await newClient()));
    expect(location(res).searchParams.get("code")).toBeTruthy();
    expect(await users()).toEqual([{ user_sub: "g-alice", email: "alice@test", role: "admin" }]);
  });
  it("updates the existing row on a second login and keeps the refresh token when Google sends none", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await callback(await approve(await newClient()));
    const first = await env.DB.prepare("SELECT created_at, google_refresh_token_enc AS enc FROM users").first<{ created_at: string; enc: string }>();
    await callback(await approve(await newClient()));
    const second = await env.DB.prepare("SELECT created_at, google_refresh_token_enc AS enc FROM users").first<{ created_at: string; enc: string }>();
    expect((await users()).length).toBe(1);
    expect(second?.created_at).toBe(first?.created_at);
    expect(second?.enc).toMatch(/^v1:/);
  });
  it.each([
    ["not invited", { email: "mallory@test", sub: "g-mallory" }, "not_invited", false],
    ["email not verified (invited)", { email_verified: false }, "email_unverified", true],
    ["email_verified as a string", { email_verified: "true" }, "email_unverified", true],
    ["email not verified (admin)", { email: "alice@test", email_verified: false }, "email_unverified", false],
  ])("shows the 403 page and writes no user when %s", async (_name, claims, reason, invited) => {
    if (invited) await ops("/ops/invites", { email: "bob@test" });
    idClaims = claims;
    const id = await newClient();
    const res = await callback(await approve(id));
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>Access refused</title>");
    expect(html).toContain("This account is not invited.");
    expect(await users()).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_codes").first<{ n: number }>())?.n).toBe(0);
    const denied = logs.map((l) => JSON.parse(l)).find((l) => l.event === "auth.oauth.denied");
    expect(denied.attrs).toEqual({ client_id: id, reason });
  });
  it("refuses a revoked invite", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await ops("/ops/invites/revoke", { email: "bob@test" });
    expect((await callback(await approve(await newClient()))).status).toBe(403);
    expect(await users()).toEqual([]);
  });
  it.each([
    ["a bad signature", () => void (signWith = () => otherKeys), {}],
    ["a wrong aud", () => undefined, { aud: "someone-else" }],
    ["a wrong iss", () => undefined, { iss: "http://evil.test" }],
    ["a wrong nonce", () => undefined, { nonce: "other-nonce" }],
    ["a missing nonce", () => undefined, { nonce: undefined }],
    ["an expired token", () => undefined, { exp: Math.floor(Date.now() / 1000) - 10 }],
  ])("redirects server_error on %s, with no user and no code", async (_name, setup, claims) => {
    await ops("/ops/invites", { email: "bob@test" });
    setup();
    idClaims = claims;
    const id = await newClient();
    const res = await callback(await approve(id));
    expect(res.status).toBe(302);
    expect(location(res).searchParams.get("error")).toBe("server_error");
    expect(location(res).searchParams.get("state")).toBe("client-state");
    expect(location(res).searchParams.has("code")).toBe(false);
    expect(await users()).toEqual([]);
    expect(logs.map((l) => JSON.parse(l)).find((l) => l.event === "auth.oauth.denied").attrs).toEqual({ client_id: id, reason: "google_error" });
  });
  it("redirects server_error when Google's token endpoint refuses the code or no code comes", async () => {
    tokenStatus = 400;
    const res = await callback(await approve(await newClient()));
    expect(location(res).searchParams.get("error")).toBe("server_error");
    const noCode = await call(`/callback?state=${await approve(await newClient())}`);
    expect(location(noCode).searchParams.get("error")).toBe("server_error");
  });
  it("stores the Google refresh token encrypted, and logs no secret", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const state = await approve(await newClient());
    const res = await callback(state);
    const code = location(res).searchParams.get("code") ?? "";
    const dump = JSON.stringify(
      await Promise.all(["users", "oauth_clients", "oauth_requests", "oauth_codes", "invites"].map(async (t) => (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results)),
    );
    expect(dump).not.toContain("g-refresh-secret");
    const enc = (await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>())?.enc ?? "";
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    // Decrypts with the configured key: 12-byte IV then the ciphertext.
    const raw = Uint8Array.from(atob(enc.slice(3)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
    expect(new TextDecoder().decode(plain)).toBe("g-refresh-secret");
    const all = logs.join("\n");
    for (const secret of [code, state, "g-code", "g-refresh-secret", "g-access", "bob@test", "g-bob"]) expect(all).not.toContain(secret);
  });
  it("uses a fresh IV for each encrypted value", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await callback(await approve(await newClient()));
    const a = (await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>())?.enc;
    await callback(await approve(await newClient()));
    const b = (await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>())?.enc;
    expect(a).not.toBe(b);
  });
});
