# Developer preview validation

## Transaction receipt preview, 2026-10-22

- 37 standalone receipt tests pass under Node.js 22.18.0. Cases include failed transaction rollback, sponsored fee payer, no double-counting of priority fees, CPI transfers, strict instruction layout, v0 loaded addresses, large integers, incomplete owner metadata, unknown refunds, RPC limits/signature mismatch, redaction, output overwrite protection, HTML escaping, viewer CSP hash, and vendored bundle hash.
- All three existing standalone launch-evidence integration tests also pass (40 standalone checks total).
- A read-only mainnet getTransaction call succeeded for signature `3DsFpAxFbw8rHXRK6jyT69PZQfnJhV74pBP1JmEV4tjb3caBKMnh6PJw3qgrvmB7f9FFW92f8kMNwWWG1auiF4cr`, wallet `2CRb7yxm69SGkxXkKsyfUir9Cjh8aWNQmpBDNYXDmaFC`, slot 455522726. The reported -20,725,000 lamport wallet change reconciled to a 10,000 lamport network fee and six supported funding/transfer flows, with zero residual. Twelve unsupported instructions keep semantic attribution partial. This is a provider smoke test of an upstream public example, not independent verification, a swap-accuracy benchmark, or a transaction sent by this project.
- The offline viewer bundles successfully. Its exact inline-script CSP hash and lack of external asset tags are checked. After initial browser launch failures, isolated Chrome checks passed using a temporary localhost server: synthetic example values, invalid-address handling, fixture file upload, JSON/HTML downloads, desktop/mobile screenshots, no horizontal overflow at 390px, and no console errors. The automation tool blocks direct `file:` navigation, so double-click opening was not automated. No hosted application was deployed.
- The new receipt runtime needs no npm installation. The inherited full application's dependency/build limitations below still apply. The scan engine source was not changed by this preview.
- Root `npm test` and `npm run typecheck` were attempted again on 2026-10-22; both stop because the incomplete app install has no `tsx`/`tsc` executable. This is separate from the passing standalone checks, not a passing full-app validation.

Reproduce: `node --test receipt/receipt.test.mjs evidence/cli.test.mjs`. Read [receipt coverage](receipt/README.md) before sharing results.

Checked 2026-10-21.

- All 90 TypeScript tests passed in an isolated copy of the modified source, using tsx 4.23.12, TypeScript 5.9.3, @solana/web3.js 1.98.4 and Node types 20.19.43. This includes twelve new evidence/attribution/block-coverage regression cases.
- Strict scoped TypeScript checking passed for lib/scan/launch-evidence.ts and scripts/launch-evidence-cli.ts.
- The standalone Node CLI is built from that same TypeScript evidence module. Its three integration tests check JSON export, invalid input, and destination overwrite protection.
- A read-only mainnet scan of upstream example mint 9U32MnGjepKLPFwGPgJUppiNhFemGa3JSho329qWpump located the creation transaction. Public RPC rate-limited the holder module. This is a smoke test, not independent detection validation or complete archive coverage.
- Full web-app dependency installation failed with network resets and Windows filesystem errors. Full application typecheck was attempted in the isolated environment and was blocked by missing Next/React/application dependencies. No web build or hosted deployment was validated.
- The upstream lockfile was regenerated after npm ci reported missing lock entries. A full clean installation of the resulting app lockfile remains unverified. Use the dependency-free standalone CLI for this preview.
- GitHub Actions is disabled for this fork. Inherited deployment configuration remains upstream material and is not an active Positano service.

Reproduce the standalone checks:

```sh
node --test evidence/cli.test.mjs
node evidence/cli.mjs examples/launch-synthetic.json
```

With full development dependencies available, also run npm test and npm run typecheck. To regenerate the checked-in standalone module, run `node scripts/build-evidence.mjs`; commit generated changes together with the TypeScript source.

## Coverage milestone

The next read-only mainnet smoke test used the same upstream example mint. The creation was located in slot 455522726 and the provider returned a complete relevant launch-block response with zero additional relevant successful transactions. Holder inspection was rate-limited, and the exported warning is sanitized. This does not establish token safety or independently validate the RPC response.

All engine paths now validate a mint-creation instruction and query the exact creation slot; the old small-history shortcut included slot + 1 and did not consistently validate creation. Coverage tests distinguish a complete empty response, a failed fetch, absent metadata, a missing creation transaction, and sample truncation. Changed export fields are explicitly projected and raw diagnostics are omitted.

The latest test set also verifies that unavailable creation transactions produce an unverified finding, raw partial failures do not echo provider errors, and malformed JSON errors do not echo their contents. The standalone CLI has three integration tests.
