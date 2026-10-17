import { expect, test, type Page } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const base = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const redirectUri = "http://127.0.0.1:9/cb";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

test.beforeEach(async ({ request }) => {
  await request.post("/ops/reset", { headers: ops });
});

// Nothing listens at the client's redirect URI: the browser lands on a page we serve ourselves.
async function serveClient(page: Page): Promise<void> {
  await page.route(`${redirectUri}**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>client</p>" }));
}

// Registers a client, opens the consent page, approves, and signs in at the fake Google as `email`.
async function signIn(page: Page, email: string): Promise<void> {
  const res = await page.request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "Browser client" } });
  const { client_id: clientId } = await res.json();
  await serveClient(page);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${base}/mcp`,
    state: "browser-state",
  });
  await page.goto(`/authorize?${params}`);
  await expect(page.getByText("Browser client")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL(/\/google\/authorize/);
  await page.locator('input[name="login_hint"]').fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an invited user goes through consent and Google sign-in back to the client with a code", async ({ page, request }) => {
  await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } });
  await signIn(page, "bob@test");
  await page.waitForURL(`${redirectUri}**`);
  const url = new URL(page.url());
  expect(url.searchParams.get("code")?.length).toBeGreaterThanOrEqual(32);
  expect(url.searchParams.get("state")).toBe("browser-state");
  const users = (await (await request.get("/ops/users", { headers: ops })).json()).users;
  expect(users).toEqual([expect.objectContaining({ email: "bob@test", role: "member" })]);
});

test("E2E-02: a non-invited user gets the 403 page and no users row", async ({ page, request }) => {
  await signIn(page, "mallory@test");
  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();
  expect(page.url()).toContain("/callback");
  const users = (await (await request.get("/ops/users", { headers: ops })).json()).users;
  expect(users).toEqual([]);
});
