# Review 0

- Reviewed commit: `930fcd2f1e39bda156129c425c441f141b5ea797`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/log.py:12`) emit() raises ValidationError for unknown fields instead of ValueError as required

  Spec 4.4 mandates that the Python logger raises ValueError for an unknown event, level or field. In emit(), extra fields are only rejected by Pydantic's model_validate with extra='forbid', which raises pydantic.ValidationError, not ValueError. The test expects ValueError (node/tests/test_contracts.py: service.started with {'bogus': 1}). This will not satisfy the spec nor the test intent. Consider pre-validating allowed kwargs or catching ValidationError and re-raising ValueError.

- **minor** (`scripts/contracts.sh:31`) Conflicting datamodel-codegen flags (--use-specialized-enum and --no-use-specialized-enum)

  Both --use-specialized-enum and --no-use-specialized-enum are passed (lines 31–33). The latter will override the former, but the duplication is confusing and could mask intent. Since enums are post-processed to StrEnum via sed, remove the redundant/contradictory flag to make the generator behavior clear.

- **minor** (`contracts/log-event.schema.json:13`) Log attrs unconstrained vs. per-event attributes listed in spec

  The schema sets attrs as a free object with additionalProperties: true and does not encode per-event attribute shapes. This is documented as a decision in docs/decisions.md (2026-10-16: Log schema attrs is a free object...), which is acceptable if treated as an explicit design choice. Calling this out to ensure the relaxation is intentional and understood.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Spec 4.4 requires Python logger to raise ValueError for unknown fields; emit() currently surfaces pydantic.ValidationError for extra fields (node/src/yt_digest_node/log.py:12–22). The Python test expects ValueError for an unknown field in emit().

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Spec 4.4 requires Python logger to raise ValueError for unknown fields; emit() currently surfaces pydantic.ValidationError for extra fields (node/src/yt_digest_node/log.py:12–22). The Python test expects ValueError for an unknown field in emit().

- met: The change is covered by tests that fail without it.

  Python tests validate transcript/log schema acceptance and rejection and exercise the logger, including stale-generation checks invoking scripts/contracts.sh --check (node/tests/test_contracts.py). TypeScript tests validate the same via Ajv and the runtime logger checks (worker/tests/contracts.test.ts). Altering schemas or generated files causes the --check tests to fail and name files.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md entries on 2026-10-16 document tool choices (generators, dependencies), tsconfig resolveJsonModule, generation behavior (directories rewritten, StrEnum postprocessing, log-events.ts), and the decision to keep log attrs as a free object and TS logger to console.log with service=worker.

## Proposed learnings (not decided)

- When specs prescribe exception types, validate inputs before schema/model validation or normalize exceptions to match the contract.
- Keep generator flags minimal and non-contradictory; post-processing steps (like StrEnum rewrites) should be reflected in generator options to reduce surprises.
- Documented deviations or simplifications (like free-form attrs) are acceptable if explicitly recorded and tested; ensure tests align with the documented behavior.
