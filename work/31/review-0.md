# Review 0

- Reviewed commit: `3625c12a8ecc72e0287a32f181bf35f64b5a18ff`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/crypto.ts:2`) Incorrect Uint8Array type annotation

  The return type is declared as Uint8Array<ArrayBuffer>, but Uint8Array is not generic. This should be Uint8Array. The same issue appears for fromBase64url on line 6. This won't break runtime but defeats strict TS expectations.

- **minor** (`worker/src/crypto.ts:6`) Base64url decoding without padding

  fromBase64url replaces -/_ but does not re-pad with '=' before calling atob. While this works in the current Workers runtime (tests pass), it's not portable and can be brittle for lengths not divisible by 4. Consider adding padding to avoid environment-specific behavior.

- **minor** (`worker/src/oauth.ts:23`) Redirect appends duplicate parameters

  redirect() uses URLSearchParams.append for error/state. If the registered redirect_uri already has those keys, the client will receive duplicates. Using set() for reserved params ('error', 'state', 'code') avoids ambiguity.

- **minor** (`worker/src/oauth.ts:235`) Missing GOOGLE_ISSUER hard-failure handling

  discoverGoogle() builds a URL even when GOOGLE_ISSUER is empty, causing a relative fetch to '/.well-known/openid-configuration'. A clearer 5xx with an operator-facing log when misconfigured would aid operability.

- **minor** (`worker/src/oauth.ts:316`) Encryption key default can crash callback

  If TOKEN_ENC_KEY is unset, encrypt() imports a zero-length key (fromBase64('')), likely throwing and failing the flow when a refresh_token is present. Consider validating presence/length of TOKEN_ENC_KEY at startup or failing consent with a 5xx and a clear error.

- **minor** (`worker/src/http.ts:3`) OAuth JSON responses not explicitly marked no-store

  While HTML pages set Cache-Control: no-store, JSON responses (e.g., discovery and registration errors) do not. OAuth specs recommend no-store on sensitive responses. Not required by the ticket but worth aligning.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Endpoints implemented per 10.1–10.4: discovery (/.well-known/oauth-protected-resource(…); /.well-known/oauth-authorization-server), POST /register, GET /authorize (consent page), POST /authorize/consent, GET /callback in worker/src/oauth.ts. Logging events auth.client.registered, auth.oauth.denied, auth.oauth.completed in worker/src/oauth.ts and worker/src/log.ts. Token endpoint intentionally not implemented (out of scope).

- met: The change is covered by tests that fail without it.

  Comprehensive worker tests in worker/tests/worker/oauth.test.ts cover registration validation and error ordering, authorize error handling and redirect rules, consent flows and logging, Google redirect parameters, callback ID token checks (bad signature, wrong aud/iss/nonce/exp), access control (admin/invited/not-invited), encryption properties, and secrecy in logs. E2E API test e2e/tests/oauth.api.spec.ts validates PKCE and redirect_uri exactness (E2E-29). E2E browser test e2e/tests/login.browser.spec.ts covers the consent UI then fake Google sign-in for invited and non-invited users (E2E-02) and fixes the prior CI flake by serving the client redirect.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lines 61–67 add explicit choices on registration validation and error form, PUBLIC_URL and TTL fallbacks, scope handling, consent form handling and one-time Google binding, denial reasons ordering including email_verified precedence, refresh token retention on re-login, and behavior when Google discovery fails.

## Proposed learnings (not decided)

- When implementing OAuth flows in constrained runtimes (Workers), keep redirects deterministic and avoid duplicating reserved query params.
- Explicitly document and test all spec leeways (error ordering, fallbacks, scope treatment) to prevent regressions.
- For cryptography helpers, prefer robust base64url codecs and strict key validation to avoid environment-specific brittleness.
- Write end-to-end browser tests that control the client redirect target to stabilize CI across environments.
