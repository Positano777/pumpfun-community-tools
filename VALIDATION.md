# Developer preview validation

Checked 2026-10-21.

- All 83 TypeScript tests passed in an isolated copy of the modified source, using tsx 4.23.12, TypeScript 5.9.3, @solana/web3.js 1.98.4 and Node types 20.19.43. This includes five new evidence/attribution regression cases.
- Strict scoped TypeScript checking passed for lib/scan/launch-evidence.ts and scripts/launch-evidence-cli.ts.
- The standalone Node CLI is built from that same TypeScript evidence module. Its two integration tests check JSON export, invalid input, and destination overwrite protection.
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
