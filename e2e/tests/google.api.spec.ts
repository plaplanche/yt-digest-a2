import { createHash, createPublicKey, createVerify } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const mocksUrl = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;
const issuer = `${mocksUrl}/google`;
const clientId = process.env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "local-google-secret";
const redirectUri = "http://127.0.0.1:9/cb";

const authorizeUrl = (params: Record<string, string>): string =>
  `${issuer}/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email", ...params })}`;

async function login(request: APIRequestContext, params: Record<string, string> = {}, email = "Bob@Test"): Promise<string> {
  const res = await request.get(authorizeUrl({ login_hint: email, state: "st1", ...params }), { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const location = new URL(res.headers().location ?? "");
  expect(location.origin + location.pathname).toBe(redirectUri);
  expect(location.searchParams.get("state")).toBe("st1");
  return location.searchParams.get("code") ?? "";
}

const exchange = (request: APIRequestContext, form: Record<string, string>, secret = clientSecret) =>
  request.post(`${issuer}/token`, { form: { client_id: clientId, client_secret: secret, ...form } });

test("the discovery document lists the endpoints", async ({ request }) => {
  const res = await request.get(`${issuer}/.well-known/openid-configuration`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  });
});

test("authorize refuses a wrong client_id and a missing openid scope", async ({ request }) => {
  expect((await request.get(authorizeUrl({ client_id: "other" }))).status()).toBe(400);
  expect((await request.get(authorizeUrl({ scope: "email" }))).status()).toBe(400);
});

test("authorize without login_hint shows a form repeating every parameter", async ({ request }) => {
  const res = await request.get(authorizeUrl({ state: "s&1", nonce: "n1" }));
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('<form method="get" action="/google/authorize">');
  expect(html).toContain('name="login_hint"');
  for (const [name, value] of [["client_id", clientId], ["redirect_uri", redirectUri], ["response_type", "code"], ["scope", "openid email"], ["state", "s&amp;1"], ["nonce", "n1"]]) {
    expect(html).toContain(`<input type="hidden" name="${name}" value="${value}">`);
  }
});

test("the code gives a signed ID token with the claims of 5.3, and is single use", async ({ request }) => {
  const before = Math.floor(Date.now() / 1000);
  const code = await login(request, { nonce: "n-42" });
  const res = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "openid email" });
  expect(body.refresh_token).toBeUndefined();

  const [header, payload, signature] = (body.id_token as string).split(".") as [string, string, string];
  const jwks = await (await request.get(`${issuer}/jwks`)).json();
  const key = jwks.keys[0];
  expect(key).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
  expect(JSON.parse(Buffer.from(header, "base64url").toString())).toMatchObject({ alg: "RS256", kid: key.kid });
  const verifier = createVerify("RSA-SHA256").update(`${header}.${payload}`);
  expect(verifier.verify(createPublicKey({ key, format: "jwk" }), Buffer.from(signature, "base64url"))).toBe(true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  expect(claims).toMatchObject({
    iss: issuer,
    aud: clientId,
    sub: `g-${createHash("sha256").update("bob@test").digest("hex").slice(0, 16)}`,
    email: "bob@test",
    email_verified: true,
    nonce: "n-42",
  });
  expect(claims.iat).toBeGreaterThanOrEqual(before);
  expect(claims.exp).toBe(claims.iat + 3600);

  const again = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  expect(again.status()).toBe(400);
  expect(await again.json()).toEqual({ error: "invalid_grant" });
});

test("a wrong redirect_uri or an unknown code gives invalid_grant", async ({ request }) => {
  const code = await login(request);
  const wrong = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: "http://127.0.0.1:9/other" });
  expect(wrong.status()).toBe(400);
  expect((await exchange(request, { grant_type: "authorization_code", code: "nope", redirect_uri: redirectUri })).status()).toBe(400);
  expect((await exchange(request, { grant_type: "password" })).status()).toBe(400);
});

test("a wrong client secret gives 401 invalid_client, HTTP Basic works", async ({ request }) => {
  const code = await login(request);
  const bad = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, "wrong");
  expect(bad.status()).toBe(401);
  expect(await bad.json()).toEqual({ error: "invalid_client" });
  const code2 = await login(request);
  const ok = await request.post(`${issuer}/token`, {
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
    form: { grant_type: "authorization_code", code: code2, redirect_uri: redirectUri },
  });
  expect(ok.status()).toBe(200);
});

test("access_type=offline gives a refresh token that renews the access and ID tokens", async ({ request }) => {
  const code = await login(request, { access_type: "offline", nonce: "n1" });
  const first = await (await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri })).json();
  expect(first.refresh_token).toBeTruthy();
  const res = await exchange(request, { grant_type: "refresh_token", refresh_token: first.refresh_token });
  expect(res.status()).toBe(200);
  const renewed = await res.json();
  expect(renewed.access_token).not.toBe(first.access_token);
  expect(renewed.id_token).toBeTruthy();
  const bad = await exchange(request, { grant_type: "refresh_token", refresh_token: "nope" });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid_grant" });
});

test("userinfo answers for its access token only, revoke answers 200", async ({ request }) => {
  const code = await login(request, { access_type: "offline" });
  const body = await (await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri })).json();
  const ok = await request.get(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${body.access_token}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({
    sub: `g-${createHash("sha256").update("bob@test").digest("hex").slice(0, 16)}`,
    email: "bob@test",
    email_verified: true,
  });
  expect((await request.get(`${issuer}/userinfo`, { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
  expect((await request.get(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${body.refresh_token}` } })).status()).toBe(401);
  expect((await request.get(`${issuer}/userinfo`)).status()).toBe(401);
  expect((await request.post(`${issuer}/revoke`, { form: { token: body.refresh_token } })).status()).toBe(200);
});
