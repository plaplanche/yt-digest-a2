import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64url } from "../../src/crypto";
import worker from "../../src/index";

const BASE = "http://worker.test";
const GOOGLE = "http://google.test";
const CB = "http://127.0.0.1:7000/cb";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const call = (path: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(`${BASE}${path}`, init), env);
const ops = (path: string, body: unknown): Promise<Response> =>
  call(path, { method: "POST", headers: { Authorization: "Bearer ops-test" }, body: JSON.stringify(body) });
const register = (body: unknown): Promise<Response> => call("/register", { method: "POST", body: JSON.stringify(body) });
const registerClient = async (extra: Record<string, unknown> = {}): Promise<string> =>
  ((await (await register({ redirect_uris: [CB], ...extra })).json()) as { client_id: string }).client_id;

const authorizeQuery = (clientId: string, extra: Record<string, string | undefined> = {}): string => {
  const params: Record<string, string | undefined> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CB,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
    state: "client-state",
    ...extra,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  return `/authorize?${q}`;
};
const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields),
});
const requestId = async (res: Response): Promise<string> => /name="request" value="([^"]+)"/.exec(await res.text())?.[1] ?? "";
const location = (res: Response): URL => new URL(res.headers.get("Location") ?? "");

// A fake Google: signs ID tokens with its own key and answers discovery, JWKS and the token endpoint.
const keys = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const otherKeys = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

const b64 = (value: unknown): string => base64url(new TextEncoder().encode(JSON.stringify(value)));
async function idToken(claims: Record<string, unknown>, key: CryptoKey = keys.privateKey): Promise<string> {
  const input = `${b64({ alg: "RS256", typ: "JWT", kid: "k1" })}.${b64(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(sig))}`;
}

interface Stub {
  claims: Record<string, unknown>;
  signWith: CryptoKey;
  refreshToken?: string;
  tokenBody?: URLSearchParams;
  tokenStatus: number;
}
let stub: Stub;
let nonce = "";
let logs: string[];

beforeEach(async () => {
  logs = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(line));
  stub = { claims: { sub: "g-bob", email: "Bob@Test", email_verified: true }, signWith: keys.privateKey, refreshToken: "google-refresh-secret", tokenStatus: 200 };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === `${GOOGLE}/.well-known/openid-configuration`) {
      return Response.json({ authorization_endpoint: `${GOOGLE}/authorize`, token_endpoint: `${GOOGLE}/token`, jwks_uri: `${GOOGLE}/jwks` });
    }
    if (url === `${GOOGLE}/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${GOOGLE}/token`) {
      stub.tokenBody = new URLSearchParams(String(init?.body));
      const iat = Math.floor(Date.now() / 1000);
      const claims = { iss: GOOGLE, aud: "google-client", iat, exp: iat + 3600, nonce, ...stub.claims };
      return Response.json(
        { access_token: "google-access", token_type: "Bearer", id_token: await idToken(claims, stub.signWith), refresh_token: stub.refreshToken },
        { status: stub.tokenStatus },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  await call("/ops/reset", { method: "POST", headers: { Authorization: "Bearer ops-test" } });
});
afterEach(() => vi.unstubAllGlobals());

// Registers a client, approves the consent and returns what Google was sent.
async function approve(extra: Record<string, string | undefined> = {}): Promise<{ clientId: string; google: URL }> {
  const clientId = await registerClient({ client_name: "Test client" });
  const page = await call(authorizeQuery(clientId, extra));
  const res = await call("/authorize/consent", form({ request: await requestId(page), decision: "approve" }));
  expect(res.status).toBe(302);
  const google = location(res);
  nonce = google.searchParams.get("nonce") ?? "";
  return { clientId, google };
}
const callback = (google: URL, extra: Record<string, string> = {}): Promise<Response> =>
  call(`/callback?${new URLSearchParams({ code: "gcode", state: google.searchParams.get("state") ?? "", ...extra })}`);

describe("discovery", () => {
  it.each(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"])("serves %s", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({
      resource: `${BASE}/mcp`,
      authorization_servers: [BASE],
      scopes_supported: ["digest"],
      bearer_methods_supported: ["header"],
    });
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

describe("POST /register", () => {
  it("registers a client and logs auth.client.registered", async () => {
    const res = await register({ redirect_uris: [CB, "https://app.example/cb"], client_name: "Claude" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      client_id: expect.stringMatching(/^.{16,}$/),
      client_id_issued_at: expect.any(Number),
      client_name: "Claude",
      redirect_uris: [CB, "https://app.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(Math.abs((body.client_id_issued_at as number) - Date.now() / 1000)).toBeLessThan(10);
    expect(logs.map((l) => JSON.parse(l))).toContainEqual(expect.objectContaining({ event: "auth.client.registered", attrs: { client_id: body.client_id } }));
    const row = await env.DB.prepare("SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?1").bind(body.client_id).first();
    expect(row).toEqual({ client_name: "Claude", redirect_uris: JSON.stringify([CB, "https://app.example/cb"]) });
  });
  it("omits client_name when none is given and accepts the optional fields", async () => {
    const res = await register({
      redirect_uris: ["http://localhost/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("client_name");
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
  });
  it("gives each client its own id", async () => {
    expect(await registerClient()).not.toBe(await registerClient());
  });
  it.each([
    ["missing", undefined],
    ["empty", []],
    ["eleven", Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`)],
    ["not an array", "https://a.example/cb"],
    ["a non-string", [42]],
    ["http on a public host", ["http://a.example/cb"]],
    ["a fragment", ["https://a.example/cb#x"]],
    ["an empty fragment", ["https://a.example/cb#"]],
    ["relative", ["/cb"]],
    ["another scheme", ["myapp://cb"]],
    ["one bad among good", [CB, "ftp://a.example"]],
  ])("refuses redirect_uris %s with invalid_redirect_uri", async (_name, uris) => {
    const res = await register({ redirect_uris: uris });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });
  it.each([
    ["a long client_name", { client_name: "x".repeat(201) }],
    ["a non-string client_name", { client_name: 3 }],
    ["a secret auth method", { token_endpoint_auth_method: "client_secret_basic" }],
    ["an unknown grant type", { grant_types: ["password"] }],
    ["grant_types not an array", { grant_types: "authorization_code" }],
    ["another response type", { response_types: ["token"] }],
  ])("refuses %s with invalid_client_metadata", async (_name, extra) => {
    const res = await register({ redirect_uris: [CB], ...extra });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_client_metadata" });
  });
  it("checks redirect_uris before the other fields", async () => {
    const res = await register({ client_name: 3 });
    expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });
  it("accepts a client_name of 200 characters", async () => {
    expect((await register({ redirect_uris: [CB], client_name: "x".repeat(200) })).status).toBe(201);
  });
  it.each(["{not json", "[]", "null"])("refuses the body %j with 400 invalid_request", async (body) => {
    const res = await call("/register", { method: "POST", body });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });
  it("does not answer GET", async () => {
    expect((await call("/register")).status).toBe(404);
  });
});

describe("GET /authorize", () => {
  it("answers 400 HTML, never a redirect, for an unknown client", async () => {
    const res = await call(authorizeQuery("nope"));
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.has("Location")).toBe(false);
  });
  it("answers 400 HTML, never a redirect, for a missing client_id", async () => {
    const res = await call("/authorize");
    expect(res.status).toBe(400);
    expect(res.headers.has("Location")).toBe(false);
  });
  it.each([undefined, "http://127.0.0.1:7000/cb/", "http://127.0.0.1:7000/CB", "http://127.0.0.1:7000/cb?x=1", "https://evil.example/cb"])(
    "answers 400 HTML for the redirect_uri %j that is not registered",
    async (uri) => {
      const res = await call(authorizeQuery(await registerClient(), { redirect_uri: uri }));
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.has("Location")).toBe(false);
    },
  );
  it.each([
    ["response_type", { response_type: "token" }, "unsupported_response_type"],
    ["a missing response_type", { response_type: undefined }, "unsupported_response_type"],
    ["a missing code_challenge", { code_challenge: undefined }, "invalid_request"],
    ["a missing method", { code_challenge_method: undefined }, "invalid_request"],
    ["the plain method", { code_challenge_method: "plain" }, "invalid_request"],
    ["a missing resource", { resource: undefined }, "invalid_target"],
    ["another resource", { resource: `${BASE}/other` }, "invalid_target"],
    ["a resource with a trailing slash", { resource: `${BASE}/mcp/` }, "invalid_target"],
    ["another scope", { scope: "digest other" }, "invalid_scope"],
  ])("redirects %s as %s with the state", async (_name, extra, error) => {
    const res = await call(authorizeQuery(await registerClient(), extra));
    expect(res.status).toBe(302);
    const url = location(res);
    expect(url.origin + url.pathname).toBe(CB);
    expect(url.searchParams.get("error")).toBe(error);
    expect(url.searchParams.get("state")).toBe("client-state");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_requests").first<{ n: number }>())?.n).toBe(0);
  });
  it("redirects an error without state when the client sent none", async () => {
    const res = await call(authorizeQuery(await registerClient(), { response_type: "token", state: undefined }));
    expect(location(res).searchParams.has("state")).toBe(false);
  });
  it("checks the errors in order", async () => {
    const res = await call(authorizeQuery(await registerClient(), { response_type: "token", code_challenge: undefined, resource: undefined, scope: "x" }));
    expect(location(res).searchParams.get("error")).toBe("unsupported_response_type");
    const res2 = await call(authorizeQuery(await registerClient(), { code_challenge_method: "plain", resource: undefined, scope: "x" }));
    expect(location(res2).searchParams.get("error")).toBe("invalid_request");
    const res3 = await call(authorizeQuery(await registerClient(), { resource: undefined, scope: "x" }));
    expect(location(res3).searchParams.get("error")).toBe("invalid_target");
  });
  it("keeps the existing query of the redirect_uri when redirecting an error", async () => {
    const id = await registerClient({ redirect_uris: ["https://app.example/cb?a=1"] });
    const res = await call(authorizeQuery(id, { redirect_uri: "https://app.example/cb?a=1", response_type: "token" }));
    expect(location(res).searchParams.get("a")).toBe("1");
  });
  it("shows the consent page with the client name as escaped text and two decision buttons", async () => {
    const id = await registerClient({ client_name: `<script>alert("x")</script> & Co` });
    const res = await call(authorizeQuery(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co");
    expect(html).toContain(CB);
    expect(html).toContain("digest");
    expect(html).toContain('<form method="post" action="/authorize/consent">');
    expect(html).toMatch(/<input type="hidden" name="request" value="[A-Za-z0-9_-]{16,}">/);
    expect(html).toContain('<button type="submit" name="decision" value="approve">');
    expect(html).toContain('<button type="submit" name="decision" value="deny">');
    expect((html.match(/<button type="submit" name="decision"/g) ?? []).length).toBe(2);
  });
  it("shows the client_id when the client has no name and escapes the redirect_uri", async () => {
    const uri = "https://app.example/cb?a=1&b=<2>";
    const id = await registerClient({ redirect_uris: [uri] });
    const html = await (await call(authorizeQuery(id, { redirect_uri: uri }))).text();
    expect(html).toContain(id);
    expect(html).toContain("https://app.example/cb?a=1&amp;b=&lt;2&gt;");
  });
  it("stores a pending authorization with the TTL", async () => {
    const id = await registerClient();
    const before = Date.now();
    const rid = await requestId(await call(authorizeQuery(id, { scope: "digest" })));
    const row = await env.DB.prepare("SELECT * FROM oauth_requests WHERE request_id = ?1").bind(rid).first<Record<string, string>>();
    expect(row).toMatchObject({ client_id: id, redirect_uri: CB, client_state: "client-state", code_challenge: CHALLENGE, scope: "digest", resource: `${BASE}/mcp`, used_at: null });
    const ttl = Date.parse(row?.expires_at ?? "") - before;
    expect(ttl).toBeGreaterThan(590_000);
    expect(ttl).toBeLessThanOrEqual(601_000);
  });
});

describe("POST /authorize/consent", () => {
  const html400 = async (res: Response): Promise<void> => {
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.has("Location")).toBe(false);
  };
  it("refuses an unknown request, a missing field and a body that is not a form", async () => {
    await html400(await call("/authorize/consent", form({ request: "unknown", decision: "approve" })));
    await html400(await call("/authorize/consent", form({ decision: "approve" })));
    await html400(await call("/authorize/consent", form({ request: "x" })));
    await html400(await call("/authorize/consent", { method: "POST", body: "{}" }));
  });
  it("refuses an unknown decision and keeps the request usable", async () => {
    const rid = await requestId(await call(authorizeQuery(await registerClient())));
    await html400(await call("/authorize/consent", form({ request: rid, decision: "maybe" })));
    expect((await call("/authorize/consent", form({ request: rid, decision: "approve" }))).status).toBe(302);
  });
  it("refuses an expired request", async () => {
    const rid = await requestId(await call(authorizeQuery(await registerClient())));
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?1").bind(new Date(Date.now() - 1000).toISOString()).run();
    await html400(await call("/authorize/consent", form({ request: rid, decision: "approve" })));
    await html400(await call("/authorize/consent", form({ request: rid, decision: "deny" })));
  });
  it("deny redirects access_denied with the state, uses the request up and logs it", async () => {
    const id = await registerClient();
    const rid = await requestId(await call(authorizeQuery(id)));
    const res = await call("/authorize/consent", form({ request: rid, decision: "deny" }));
    expect(res.status).toBe(302);
    const url = location(res);
    expect(url.origin + url.pathname).toBe(CB);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("client-state");
    await html400(await call("/authorize/consent", form({ request: rid, decision: "deny" })));
    await html400(await call("/authorize/consent", form({ request: rid, decision: "approve" })));
    expect(logs.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({ event: "auth.oauth.denied", attrs: { client_id: id, reason: "access_denied" } }),
    );
  });
  it("approve redirects to Google with every parameter", async () => {
    const { google } = await approve();
    expect(google.origin + google.pathname).toBe(`${GOOGLE}/authorize`);
    const p = google.searchParams;
    expect(p.get("client_id")).toBe("google-client");
    expect(p.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email https://www.googleapis.com/auth/youtube.readonly");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("state")).toMatch(/^.{16,}$/);
    expect(p.get("nonce")).toMatch(/^.{16,}$/);
    expect(p.get("state")).not.toBe(p.get("nonce"));
    const row = await env.DB.prepare("SELECT google_state, google_nonce, used_at FROM oauth_requests").first();
    expect(row).toEqual({ google_state: p.get("state"), google_nonce: p.get("nonce"), used_at: null });
  });
  it("approve twice does not issue a second Google state", async () => {
    const rid = await requestId(await call(authorizeQuery(await registerClient())));
    expect((await call("/authorize/consent", form({ request: rid, decision: "approve" }))).status).toBe(302);
    await html400(await call("/authorize/consent", form({ request: rid, decision: "approve" })));
  });
});

describe("GET /callback", () => {
  const codeRows = async (): Promise<Record<string, unknown>[]> => (await env.DB.prepare("SELECT * FROM oauth_codes").all()).results;
  const userRows = async (): Promise<Record<string, unknown>[]> => (await env.DB.prepare("SELECT * FROM users").all()).results;
  const refusedWith = async (res: Response, error: string): Promise<void> => {
    expect(res.status).toBe(302);
    const url = location(res);
    expect(url.origin + url.pathname).toBe(CB);
    expect(url.searchParams.get("error")).toBe(error);
    expect(url.searchParams.get("state")).toBe("client-state");
    expect(url.searchParams.has("code")).toBe(false);
    expect(await codeRows()).toEqual([]);
    expect(await userRows()).toEqual([]);
  };

  it("refuses an unknown or missing state with 400 HTML", async () => {
    for (const path of ["/callback?state=nope&code=x", "/callback?code=x"]) {
      const res = await call(path);
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("text/html");
    }
  });
  it("refuses an expired state and a state not yet bound to Google", async () => {
    const { google } = await approve();
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?1").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await callback(google)).status).toBe(400);
    const rid = await requestId(await call(authorizeQuery(await registerClient())));
    expect((await call(`/callback?state=${rid}&code=x`)).status).toBe(400);
  });
  it("uses the pending authorization up, whatever the outcome", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const { google } = await approve();
    expect((await callback(google)).status).toBe(302);
    expect((await callback(google)).status).toBe(400);
    expect((await codeRows()).length).toBe(1);
  });
  it("uses the state up when Google reports an error, and redirects access_denied", async () => {
    const { clientId, google } = await approve();
    await refusedWith(await callback(google, { error: "access_denied", code: "" }), "access_denied");
    expect((await callback(google)).status).toBe(400);
    expect(logs.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({ event: "auth.oauth.denied", attrs: { client_id: clientId, reason: "google_error" } }),
    );
  });
  it("sends the code, redirect_uri and client authentication to Google's token endpoint", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const { google } = await approve();
    await callback(google);
    expect(Object.fromEntries(stub.tokenBody ?? [])).toEqual({
      grant_type: "authorization_code",
      code: "gcode",
      redirect_uri: `${BASE}/callback`,
      client_id: "google-client",
      client_secret: "google-secret",
    });
  });

  describe("ID token checks", () => {
    const cases: [string, () => void][] = [
      ["a bad signature", () => void (stub.signWith = otherKeys.privateKey)],
      ["a wrong aud", () => void (stub.claims = { ...stub.claims, aud: "someone-else" })],
      ["a wrong iss", () => void (stub.claims = { ...stub.claims, iss: "http://evil.test" })],
      ["a wrong nonce", () => void (stub.claims = { ...stub.claims, nonce: "other" })],
      ["a missing nonce", () => void (stub.claims = { ...stub.claims, nonce: undefined })],
      ["an expired token", () => void (stub.claims = { ...stub.claims, exp: Math.floor(Date.now() / 1000) - 5 })],
      ["a token endpoint error", () => void (stub.tokenStatus = 400)],
    ];
    it.each(cases)("redirects server_error on %s", async (_name, break_) => {
      await ops("/ops/invites", { email: "bob@test" });
      const { clientId, google } = await approve();
      break_();
      await refusedWith(await callback(google), "server_error");
      expect(logs.map((l) => JSON.parse(l))).toContainEqual(
        expect.objectContaining({ event: "auth.oauth.denied", attrs: { client_id: clientId, reason: "google_error" } }),
      );
    });
    it("redirects server_error when Google sent no code", async () => {
      const { google } = await approve();
      await refusedWith(await call(`/callback?state=${google.searchParams.get("state")}`), "server_error");
    });
    it("accepts an aud that is a list holding the client id", async () => {
      await ops("/ops/invites", { email: "bob@test" });
      const { google } = await approve();
      stub.claims = { ...stub.claims, aud: ["other", "google-client"] };
      expect(location(await callback(google)).searchParams.has("code")).toBe(true);
    });
  });

  describe("access control", () => {
    it("gives an invited user a code, a member row and the accepted invite", async () => {
      await ops("/ops/invites", { email: "bob@test" });
      const { clientId, google } = await approve();
      const res = await callback(google);
      expect(res.status).toBe(302);
      const url = location(res);
      expect(url.origin + url.pathname).toBe(CB);
      expect(url.searchParams.get("state")).toBe("client-state");
      const code = url.searchParams.get("code") ?? "";
      expect(code.length).toBeGreaterThanOrEqual(32);
      expect(await userRows()).toEqual([
        { user_sub: "g-bob", email: "bob@test", role: "member", google_refresh_token_enc: expect.stringMatching(/^v1:/), created_at: expect.any(String) },
      ]);
      expect(await env.DB.prepare("SELECT accepted_user_sub FROM invites").first()).toEqual({ accepted_user_sub: "g-bob" });
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const before = Date.now();
      expect(await codeRows()).toEqual([
        {
          code_hash: hash,
          client_id: clientId,
          user_sub: "g-bob",
          redirect_uri: CB,
          code_challenge: CHALLENGE,
          scope: "digest",
          resource: `${BASE}/mcp`,
          expires_at: expect.any(String),
          used_at: null,
        },
      ]);
      const ttl = Date.parse(String((await codeRows())[0]?.expires_at)) - before;
      expect(ttl).toBeGreaterThan(50_000);
      expect(ttl).toBeLessThanOrEqual(61_000);
      expect(logs.map((l) => JSON.parse(l))).toContainEqual(
        expect.objectContaining({ event: "auth.oauth.completed", attrs: { client_id: clientId, role: "member" } }),
      );
    });
    it("admits the admin without invite, in any case, with the role admin", async () => {
      stub.claims = { sub: "g-alice", email: "ALICE@test", email_verified: true };
      const { google } = await approve();
      expect(location(await callback(google)).searchParams.has("code")).toBe(true);
      expect(await userRows()).toEqual([expect.objectContaining({ user_sub: "g-alice", email: "alice@test", role: "admin" })]);
    });
    it("refuses a non-invited user with the 403 page, no row and no code", async () => {
      stub.claims = { sub: "g-mallory", email: "mallory@test", email_verified: true };
      const { clientId, google } = await approve();
      const res = await callback(google);
      expect(res.status).toBe(403);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.has("Location")).toBe(false);
      const html = await res.text();
      expect(html).toContain("<title>Access refused</title>");
      expect(html).toContain("This account is not invited.");
      expect(await userRows()).toEqual([]);
      expect(await codeRows()).toEqual([]);
      expect(logs.map((l) => JSON.parse(l))).toContainEqual(
        expect.objectContaining({ event: "auth.oauth.denied", attrs: { client_id: clientId, reason: "not_invited" } }),
      );
    });
    it("refuses a user whose invite is revoked", async () => {
      await ops("/ops/invites", { email: "bob@test" });
      await ops("/ops/invites/revoke", { email: "bob@test" });
      const { google } = await approve();
      expect((await callback(google)).status).toBe(403);
      expect(await userRows()).toEqual([]);
    });
    it.each([false, undefined, "true"])("refuses email_verified %j, even for the admin", async (verified) => {
      stub.claims = { sub: "g-alice", email: "alice@test", email_verified: verified };
      const { clientId, google } = await approve();
      expect((await callback(google)).status).toBe(403);
      expect(await userRows()).toEqual([]);
      expect(logs.map((l) => JSON.parse(l))).toContainEqual(
        expect.objectContaining({ event: "auth.oauth.denied", attrs: { client_id: clientId, reason: "email_unverified" } }),
      );
    });
    it("updates the user on a second login and keeps the Google refresh token when none is sent", async () => {
      await ops("/ops/invites", { email: "bob@test" });
      await callback((await approve()).google);
      const first = (await userRows())[0];
      stub.refreshToken = undefined;
      await callback((await approve()).google);
      const rows = await userRows();
      expect(rows.length).toBe(1);
      expect(rows[0]?.google_refresh_token_enc).toBe(first?.google_refresh_token_enc);
    });
  });

  it("stores no value holding the Google refresh token in clear, and encrypts it with AES-GCM", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await callback((await approve()).google);
    for (const table of ["users", "invites", "oauth_clients", "oauth_requests", "oauth_codes", "oauth_tokens"]) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(results)).not.toContain("google-refresh-secret");
    }
    const stored = (await env.DB.prepare("SELECT google_refresh_token_enc AS v FROM users").first<{ v: string }>())?.v ?? "";
    const raw = Uint8Array.from(atob(stored.slice(3)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
    expect(new TextDecoder().decode(plain)).toBe("google-refresh-secret");
  });
  it("uses a new IV for each value", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await callback((await approve()).google);
    const first = (await env.DB.prepare("SELECT google_refresh_token_enc AS v FROM users").first<{ v: string }>())?.v;
    await callback((await approve()).google);
    const second = (await env.DB.prepare("SELECT google_refresh_token_enc AS v FROM users").first<{ v: string }>())?.v;
    expect(second).not.toBe(first);
  });
  it("never logs a code, token, e-mail or sub", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const { google } = await approve();
    const res = await callback(google);
    const code = location(res).searchParams.get("code") ?? "";
    const text = logs.join("\n");
    for (const secret of [code, "google-refresh-secret", "google-access", "bob@test", "g-bob", "gcode"]) expect(text).not.toContain(secret);
  });
});
