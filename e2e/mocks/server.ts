import { createHash, createSign, generateKeyPairSync, randomBytes, type JsonWebKey } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.MOCKS_PORT ?? "8789");
const clientId = process.env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "local-google-secret";
const issuer = `http://127.0.0.1:${port}/google`;
const CODE_TTL_MS = 60_000;
const TOKEN_TTL_SECONDS = 3600;

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = randomBytes(8).toString("hex");
const jwk = { ...(publicKey.export({ format: "jwk" }) as JsonWebKey), kid, alg: "RS256", use: "sig" };

interface Grant {
  email: string;
  scope: string;
  nonce?: string;
}
const codes = new Map<string, Grant & { redirectUri: string; offline: boolean; expiresAt: number }>();
const accessTokens = new Map<string, string>();
const refreshTokens = new Map<string, Grant>();

const b64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");
const subject = (email: string): string => `g-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;

function idToken(grant: Grant): string {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: clientId,
    sub: subject(grant.email),
    email: grant.email,
    email_verified: true,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
    ...(grant.nonce ? { nonce: grant.nonce } : {}),
  };
  const signingInput = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }))}.${b64url(JSON.stringify(claims))}`;
  return `${signingInput}.${b64url(createSign("RSA-SHA256").update(signingInput).sign(privateKey))}`;
}

function send(res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}
const sendJson = (res: ServerResponse, status: number, body: unknown): void =>
  send(res, status, JSON.stringify(body), "application/json");

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function authorize(res: ServerResponse, query: URLSearchParams): void {
  const redirectUri = query.get("redirect_uri");
  const scopes = (query.get("scope") ?? "").split(" ");
  if (query.get("client_id") !== clientId || !redirectUri || query.get("response_type") !== "code" || !scopes.includes("openid")) {
    send(res, 400, "Bad Request", "text/plain");
    return;
  }
  const hint = query.get("login_hint");
  if (!hint) {
    const hidden = [...query].map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join("\n");
    send(
      res,
      200,
      `<!doctype html><html><body><form method="get" action="/google/authorize">\n${hidden}\n<input type="text" name="login_hint">\n<button type="submit">Sign in</button>\n</form></body></html>`,
      "text/html",
    );
    return;
  }
  const code = randomBytes(24).toString("base64url");
  const email = hint.toLowerCase();
  codes.set(code, {
    email,
    scope: query.get("scope") ?? "",
    nonce: query.get("nonce") ?? undefined,
    redirectUri,
    offline: query.get("access_type") === "offline",
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    send(res, 400, "Bad Request", "text/plain");
    return;
  }
  target.searchParams.set("code", code);
  const state = query.get("state");
  if (state !== null) target.searchParams.set("state", state);
  send(res, 302, "", "text/plain", { location: target.toString() });
}

function clientAuthenticated(req: IncomingMessage, form: URLSearchParams): boolean {
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  const basic = /^Basic (.+)$/i.exec(req.headers.authorization ?? "");
  if (basic?.[1]) {
    const decoded = Buffer.from(basic[1], "base64").toString();
    const colon = decoded.indexOf(":");
    if (colon >= 0) {
      id = decodeURIComponent(decoded.slice(0, colon));
      secret = decodeURIComponent(decoded.slice(colon + 1));
    }
  }
  return id === clientId && secret === clientSecret;
}

function tokenResponse(grant: Grant, refreshToken?: string): Record<string, unknown> {
  const accessToken = `at-${randomBytes(24).toString("base64url")}`;
  accessTokens.set(accessToken, grant.email);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: grant.scope,
    id_token: idToken(grant),
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  };
}

function token(req: IncomingMessage, res: ServerResponse, form: URLSearchParams): void {
  if (!clientAuthenticated(req, form)) {
    sendJson(res, 401, { error: "invalid_client" });
    return;
  }
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const entry = codes.get(code);
    codes.delete(code); // single use, even when the exchange fails
    if (entry && entry.expiresAt > Date.now() && entry.redirectUri === form.get("redirect_uri")) {
      const refreshToken = entry.offline ? `rt-${randomBytes(24).toString("base64url")}` : undefined;
      if (refreshToken) refreshTokens.set(refreshToken, entry);
      sendJson(res, 200, tokenResponse(entry, refreshToken));
      return;
    }
  } else if (grantType === "refresh_token") {
    const grant = refreshTokens.get(form.get("refresh_token") ?? "");
    if (grant) {
      sendJson(res, 200, tokenResponse({ ...grant, nonce: undefined }));
      return;
    }
  }
  sendJson(res, 400, { error: "invalid_grant" });
}

function userinfo(req: IncomingMessage, res: ServerResponse): void {
  const email = accessTokens.get(/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "");
  if (!email) send(res, 401, "Unauthorized", "text/plain");
  else sendJson(res, 200, { sub: subject(email), email, email_verified: true });
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const { pathname } = url;
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { status: "ok" });
    } else if (req.method === "GET" && pathname === "/google/.well-known/openid-configuration") {
      sendJson(res, 200, {
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
    } else if (req.method === "GET" && pathname === "/google/authorize") {
      authorize(res, url.searchParams);
    } else if (req.method === "POST" && pathname === "/google/token") {
      token(req, res, await readForm(req));
    } else if (req.method === "GET" && pathname === "/google/userinfo") {
      userinfo(req, res);
    } else if (req.method === "GET" && pathname === "/google/jwks") {
      sendJson(res, 200, { keys: [jwk] });
    } else if (req.method === "POST" && pathname === "/google/revoke") {
      send(res, 200, "", "text/plain");
    } else {
      send(res, 404, "Not Found", "text/plain");
    }
  })();
});

server.listen(port, "127.0.0.1", () => console.log(`mocks: listening on http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
