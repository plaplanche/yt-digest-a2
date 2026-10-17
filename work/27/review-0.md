# Review 0

- Reviewed commit: `fb778dcd39c45ce54af8b0e93bf9d7139c735da5`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`e2e/mocks/server.ts:102`) Basic auth parsing decodes percent-escapes unnecessarily

  In clientAuthenticated(), the decoded Basic credentials are passed through decodeURIComponent for both id and secret. Basic credentials are not URI-encoded; applying decodeURIComponent could mis-handle values containing stray '%' characters. Tests pass with simple ASCII, but this is a mild robustness issue.

- **minor** (`e2e/mocks/server.ts:189`) SponsorBlock 404 is implicit, not explicit

  Spec 5.3 lists GET /sponsorblock/api/skipSegments returning 404. The server relies on the catch-all 404 rather than handling this path explicitly. Functionally equivalent today, but an explicit route would guard against future changes to default handling.

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

  Mocks server implements OIDC discovery, authorize with sign-in form and login_hint, token (auth code and refresh), RS256 ID tokens with kid/JWKS, userinfo, revoke, and subject rule (e2e/mocks/server.ts lines 125–188). Operator endpoints added: POST /ops/invites, POST /ops/invites/revoke, GET /ops/users (worker/src/ops.ts lines 155–185, 194–196). No unrelated endpoints added.

- met: The change is covered by tests that fail without it.

  E2E tests validate discovery, authorize validation and form, redirect with state, single-use code, RS256 signature and claims, invalid_client, userinfo scoping, and refresh (e2e/tests/google.api.spec.ts lines 25–139). Worker tests cover invites lowercasing, re-activating revoked invites, 404 on unknown revoke, and /ops/users sorted and bearer requirement (worker/tests/worker/nodes.test.ts lines 210–247).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md adds entries clarifying mocks server issuer derivation and behaviors (code spending, redirect_uri parse error, refresh nonce omission) and invite validation/lowercasing (docs/decisions.md lines 59–60).

## Proposed learnings (not decided)

- Documenting precise mock-OIDC edge behaviors (code consumption on failed exchange, refresh nonce handling) prevents ambiguity in later OAuth flows.
- Keeping invite validation minimal and recording the design choice in decisions.md simplifies early iterations while allowing future tightening.
- End-to-end tests that verify JWT signatures against JWKS are valuable regression guards for identity flows, even in mocks.
