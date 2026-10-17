import { expect, test, type APIRequestContext } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const base = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const redirectUri = "http://127.0.0.1:9/cb";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

test.beforeEach(async ({ request }) => {
  await request.post("/ops/reset", { headers: ops });
});

async function registerClient(request: APIRequestContext): Promise<string> {
  const res = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "e2e client" } });
  expect(res.status()).toBe(201);
  return (await res.json()).client_id;
}

const authorize = (request: APIRequestContext, clientId: string, overrides: Record<string, string> = {}) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${base}/mcp`,
    state: "s1",
    ...overrides,
  });
  for (const [key, value] of Object.entries(overrides)) if (value === "") params.delete(key);
  return request.get(`/authorize?${params}`, { maxRedirects: 0 });
};

test("E2E-29: a request without PKCE, with plain PKCE or with a non-exact redirect_uri is refused", async ({ request }) => {
  const clientId = await registerClient(request);

  const noPkce = await authorize(request, clientId, { code_challenge: "", code_challenge_method: "" });
  expect(noPkce.status()).toBe(302);
  expect(new URL(noPkce.headers().location ?? "").searchParams.get("error")).toBe("invalid_request");

  const plain = await authorize(request, clientId, { code_challenge_method: "plain" });
  expect(plain.status()).toBe(302);
  const refusal = new URL(plain.headers().location ?? "");
  expect(refusal.origin + refusal.pathname).toBe(redirectUri);
  expect(refusal.searchParams.get("error")).toBe("invalid_request");
  expect(refusal.searchParams.get("state")).toBe("s1");

  for (const uri of [`${redirectUri}/`, `${redirectUri}?x=1`, "http://127.0.0.1:9/other"]) {
    const res = await authorize(request, clientId, { redirect_uri: uri });
    expect(res.status()).toBe(400);
    expect(res.headers().location).toBeUndefined();
  }

  const ok = await authorize(request, clientId);
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toContain('<button type="submit" name="decision" value="approve">');
});
