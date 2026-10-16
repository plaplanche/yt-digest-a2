# Review 0

- Reviewed commit: `4afc3131a19be45eb8e638381c9f240914818299`
- Reviewer model: openai/gpt-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/contracts/node_claim_response.py:12`) Generated inner model name does not match schema title

  The schema titles the items "ClaimedJob", but datamodel-codegen emitted class Job. This is harmless functionally and tests don’t rely on the class name, but it’s a small inconsistency with the schema’s title.

- **minor** (`node/src/yt_digest_node/contracts/node_result_request.py:24`) arbitrary_types_allowed set, likely unnecessary

  The Pydantic config enables arbitrary_types_allowed on NodeResultRequest. Since TranscriptResult is a Pydantic BaseModel, this is probably not needed. It’s harmless but slightly broadens model acceptance.

- **minor** (`worker/tests/node-protocol.test.ts:9`) AJV ref resolution depends on key string matching

  The test registers the transcript-result schema under the key "transcript-result.schema.json" to resolve the $ref. This is fine but a bit brittle if ref strings or schema loading change. Adding $id to schemas would make resolution more robust. Not required by the spec for this ticket.

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

  Added 7 node protocol schemas and error schema with additionalProperties:false, correct enums/patterns and timestamp formats (contracts/*.schema.json); extended log catalogue per spec §12 (contracts/log-event.schema.json). Generation resolves the $ref in node-result-request to the generated transcript-result type in both languages (scripts/contracts.sh, resolve_refs). No worker routes or stack changes (out of scope).

- met: The change is covered by tests that fail without it.

  Node: node/tests/test_node_protocol.py validates accept/reject cases for every new schema, checks missing heartbeat.version, bad outcomes, extra fields, and that NodeResultRequest uses the generated TranscriptResult. Worker: worker/tests/node-protocol.test.ts does the same with Ajv 2020. Logger tests accept a lot 2 event and still reject out-of-catalogue (node/tests/test_log.py, worker/tests/log.test.ts). Contracts check --check pass/fail behavior covered (node/tests/test_contracts.py, worker/tests/contracts.test.ts).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md adds: timestamp validation by pattern not format; how scripts/contracts.sh resolves $ref to generated types (no duplication); adopting ajv (JSON Schema 2020-12) as a dev dependency for Worker tests.

## Proposed learnings (not decided)

- Resolving cross-schema $ref at generation time with json2ts tsType and datamodel-codegen customTypePath cleanly avoids duplicate type definitions across languages.
- Validating timestamps with a single regex pattern across schemas keeps generators and runtime validators consistent and avoids format-version pitfalls.
- Keeping logger event catalogues generated and enforced by compile-time exhaustiveness checks prevents drift when specs add new events.
