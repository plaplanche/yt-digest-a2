# Review 0

- Reviewed commit: `2d0eeee2f8bb4af0e88b7e1bcf63474b2eaae3b8`
- Reviewer model: openai/gpt-5
- Verdict: **no-go** (the reviewer answered go)

## Findings

- **minor** (`docs/decisions.md:2`) Decision claims tsc covers 'config files' but includes a JS config not type-checked by tsc

  The decision says tsc covers src/, tests/ and the config files. In worker/tsconfig.json, only TypeScript files are type-checked; eslint.config.js is JavaScript and not covered unless allowJs is enabled. Either clarify the decision to say 'TS config files (e.g. vitest.config.ts)' or include JS via allowJs.

- **minor** (`worker/tsconfig.json:5`) Unrecorded spec choices: moduleResolution and target

  The spec leaves TypeScript compiler details open. The repo chose moduleResolution="Bundler" and target="ES2022" (worker/tsconfig.json:3,5) but docs/decisions.md does not record these choices. Add dated lines documenting these selections.

- **minor** (`worker/package.json:7`) Engines range not documented

  The spec calls for Node 22. The package sets engines.node to ">=22". That’s fine, but it’s a choice vs pinning to 22. Document this in docs/decisions.md to capture the reasoning (e.g., allow newer Node as long as CI uses 22).

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Several choices are documented (ESM package, ESLint policy, shellcheck discovery, Python version pin, contracts check behavior). Missing: TypeScript moduleResolution and target choices (worker/tsconfig.json), and the decision to allow Node ">=22" in engines instead of pinning to 22.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Monorepo skeleton created: node/ (uv project for Python 3.12 with hatchling, src layout, uv.lock, placeholder test), worker/ (Node 22 TS strict, ESLint+Vitest, package-lock.json, placeholder test). Four check scripts implemented per spec 3.1 (scripts/checks/*.sh). ci/jobs.json has one job per check. No extra functionality beyond skeleton.

- met: The change is covered by tests that fail without it.

  node/tests/test_placeholder.py ensures yt_digest_node imports; would fail without the package. worker/tests/placeholder.test.ts ensures module loads and exports name; would fail without worker/src/index.ts and config. These placeholders satisfy lot-1’s scope; pipeline and contracts tests are out of scope.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Several choices are documented (ESM package, ESLint policy, shellcheck discovery, Python version pin, contracts check behavior). Missing: TypeScript moduleResolution and target choices (worker/tsconfig.json), and the decision to allow Node ">=22" in engines instead of pinning to 22.

## Proposed learnings (not decided)

- When adopting TypeScript flat config with typescript-eslint, document compiler strategy (target and moduleResolution) since the spec leaves them open.
- If package.json 'engines' differs from the CI's pinned runtime, record the rationale in decisions.md to avoid ambiguity.
- When stating test coverage in decisions, be precise about which config files are type-checked (TS vs JS) to avoid mismatches.
