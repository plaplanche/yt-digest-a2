import { expect, test, type APIRequestContext } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const redirectUri = "http://127.0.0.1:9/cb";
const resource = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}/mcp`;

async function register(request: APIRequestContext): Promise<string> {
  const res = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "E2E client" } });
  expect(res.status()).toBe(201);
  return (await res.json()).client_id;
}

const authorize = (request: APIRequestContext, clientId: string, params: Record<string, string>) => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource,
    state: "s1",
    ...params,
  });
  return request.get(`/authorize?${query}`, { maxRedirects: 0 });
};

test.beforeEach(async ({ request }) => {
  await request.post("/ops/reset", { headers: ops });
});

test("an authorization request without PKCE is refused with invalid_request", async ({ request }) => {
  const clientId = await register(request);
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, resource, state: "s1" });
  const res = await request.get(`/authorize?${query}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const to = new URL(res.headers().location ?? "");
  expect(to.searchParams.get("error")).toBe("invalid_request");
  expect(to.searchParams.get("state")).toBe("s1");
  expect(to.searchParams.has("code")).toBe(false);
});

test("plain PKCE is refused with invalid_request", async ({ request }) => {
  const clientId = await register(request);
  const res = await authorize(request, clientId, { code_challenge_method: "plain" });
  expect(res.status()).toBe(302);
  expect(new URL(res.headers().location ?? "").searchParams.get("error")).toBe("invalid_request");
});

test("a redirect_uri that is not exactly registered gets a 400 page, never a redirect", async ({ request }) => {
  const clientId = await register(request);
  for (const uri of [`${redirectUri}/`, `${redirectUri}?x=1`, "http://127.0.0.1:9/other", "https://evil.example/cb"]) {
    const res = await authorize(request, clientId, { redirect_uri: uri });
    expect(res.status()).toBe(400);
    expect(res.headers().location).toBeUndefined();
    expect(res.headers()["content-type"]).toContain("text/html");
  }
});

test("a valid request shows the consent page", async ({ request }) => {
  const clientId = await register(request);
  const res = await authorize(request, clientId, {});
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('name="decision"');
});
