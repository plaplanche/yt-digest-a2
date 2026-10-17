import { expect, test, type Page } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const redirectUri = "http://127.0.0.1:9/cb";
const resource = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}/mcp`;

test.beforeEach(async ({ request }) => {
  await request.post("/ops/reset", { headers: ops });
});

// Registers a client and walks the consent page and the fake Google sign-in page as `email`.
async function login(page: Page, email: string, clientName = "Browser client"): Promise<void> {
  const registered = await page.request.post("/register", { data: { redirect_uris: [redirectUri], client_name: clientName } });
  const { client_id: clientId } = await registered.json();
  // Nothing listens at the client's redirect URI: the browser lands on a stub page instead.
  await page.route(`${redirectUri}**`, (route) => route.fulfill({ contentType: "text/plain", body: "client" }));
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource,
    state: "browser-state",
  });
  await page.goto(`/authorize?${query}`);
  await expect(page.getByText(clientName)).toBeVisible();
  await page.locator('button[name="decision"][value="approve"]').click();
  await page.locator('input[name="login_hint"]').fill(email);
  await page.locator('form[action="/google/authorize"] [type="submit"], form[action="/google/authorize"] button').first().click();
}

test("an invited user goes through consent and Google sign-in back to the client with a code", async ({ page, request }) => {
  await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } });
  await login(page, "bob@test");
  await page.waitForURL(`${redirectUri}**`);
  const url = new URL(page.url());
  expect(url.searchParams.get("code")?.length).toBeGreaterThanOrEqual(32);
  expect(url.searchParams.get("state")).toBe("browser-state");
  const users = (await (await request.get("/ops/users", { headers: ops })).json()).users;
  expect(users).toEqual([expect.objectContaining({ email: "bob@test", role: "member" })]);
});

test("E2E-02: a user who is not invited gets the 403 page and no users row", async ({ page, request }) => {
  await login(page, "mallory@test");
  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();
  expect((await (await request.get("/ops/users", { headers: ops })).json()).users).toEqual([]);
});
