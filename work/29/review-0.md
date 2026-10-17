# Review 0

- Reviewed commit: `d51dde306000575c6c64b4f99dbc6cd98a7c4078`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`worker/tests/worker/oauth.test.ts:379`) Second-login refresh-token retention not directly exercised

  The test titled "updates the existing row on a second login and keeps the refresh token when Google sends none" does not configure the stub to omit the refresh_token on the second login. As written, Google always returns a refresh_token, so the 'keep existing when absent' branch is not exercised. Consider stubbing the token endpoint to omit refresh_token on the second exchange and assert the stored value remains unchanged.

- **minor** (`worker/src/secrets.ts:10`) Encryption key misconfiguration can throw at runtime

  encryptSecret imports a raw AES-GCM key from TOKEN_ENC_KEY without validation. If the key is unset or malformed, importKey/encrypt may throw and break the callback flow. The spec provides a default and tests set it correctly, but a guard with a clearer error (or an early boot-time validation) would improve robustness.

- **minor** (`worker/src/oauth.ts:211`) Discovery failure during consent returns HTML 502 (not specified)

  On POST /authorize/consent, a failed Google discovery answers a 502 HTML page. The spec does not mandate behavior for discovery failure at consent (only at callback), so this is acceptable, but documenting this choice in decisions could help clarify behavior.

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

  OAuth endpoints 10.1–10.4 are implemented in worker/src/oauth.ts (discovery, /register, /authorize + consent, /callback). No /token endpoint is added (next ticket per scope). Route wiring in worker/src/index.ts calls handleOAuth. DB schema matches spec 6.3 (worker/migrations/0001_init.sql).

- met: The change is covered by tests that fail without it.

  Worker tests: worker/tests/worker/oauth.test.ts comprehensively cover 10.1–10.4 (discovery, registration errors, authorize error order and consent page, consent approve/deny, callback validations, access control, logging, encryption secrecy). E2E tests: e2e/tests/pkce.api.spec.ts (E2E-29) and e2e/tests/login.browser.spec.ts (E2E-02 + invited flow) added. All checks reported green, including e2e.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lines 61–66 document key choices: hand-written OAuth endpoints; registration validation nuances; exact scope and empty code_challenge handling; consent approval single-bind; callback failure mapping and 403 page messaging; second-login refresh token retention behavior.

## Proposed learnings (not decided)

- Bind upstream IdP state/nonce atomically to the pending authorization to prevent replay and cross-binding issues.
- Keep OAuth error surfaces consistent: only redirect where the spec allows; otherwise serve HTML with clear messaging.
- Encrypt third-party refresh tokens at rest with authenticated encryption and avoid logging any secrets; add tests that assert no plaintext leakage.
- Model discovery-driven upstream endpoints to keep the worker adaptable to issuer changes, but cache or validate inputs where possible.
- Document every spec interpretation or open choice in a short decisions log to make future tickets and reviews faster.
