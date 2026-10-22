# Where did my SOL go?

A small, read-only **transaction receipt preview**, maintained by [Positano777](https://github.com/Positano777). Inspect a public wallet's SOL change, network fee, supported native transfers, account funding, owner-attributed token changes, and unexplained balance change.

This is a transaction receipt, not complete trading PnL. The first release supports exact System transfer/create-account instruction layouts, including supplied inner instructions and v0 loaded addresses. Wrapped SOL operations, account-close refunds, seeded transfers, and protocol-specific attribution are not modeled. They can leave a residual. A zero residual does not establish complete attribution: offsetting unsupported movements can cancel.

## Open the viewer

Download [viewer.html](viewer.html) and open it locally in a current browser. Click **Try synthetic example**, or provide your public wallet address and a saved RPC getTransaction JSON response. The single file includes its code; no server, install, network request, wallet extension, signing, or analytics is required. It supports JSON and scriptless HTML downloads. Input stays in the tab; downloaded reports contain public wallet activity, so review before sharing.

The example is invented and prominently marked synthetic. Chrome smoke checks passed for desktop/mobile layout, file upload, invalid-address handling, and both downloads, using an isolated temporary localhost server. Direct `file:` navigation is blocked by the automation tool, so double-click opening was not automated. See [validation](../VALIDATION.md).

## Command line

Requires Node.js 22 or later. All runtime dependencies are included as attributed source in `vendor/`; no npm install is required.

```sh
node receipt/cli.mjs --file examples/receipt-synthetic-rpc.json --wallet 8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR
node receipt/cli.mjs --file examples/receipt-synthetic-rpc.json --wallet 8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR --out my-new-receipt
node receipt/cli.mjs --signature PUBLIC_TRANSACTION_SIGNATURE --wallet PUBLIC_WALLET_ADDRESS --out my-live-receipt
node --test receipt/receipt.test.mjs
```

`--out` writes `.json` and `.html`; existing files are refused. Without it, JSON goes to stdout. With `--signature`, the command requests `getTransaction` using `encoding: json`, `commitment: confirmed`, and `maxSupportedTransactionVersion: 0`. Default endpoint is public Solana mainnet RPC. Set `SOLANA_RPC_URL` in the environment for another provider. Never put an API key in source or an issue. Provider rate limits and retention apply. The CLI makes only a read request; it neither independently verifies the provider nor proves network identity. Custom RPC endpoints must use HTTPS or local loopback HTTP. Redirects are refused, request timeout is 20 seconds, and input is capped at 5 MB.

Saved snapshots may be the raw result or a JSON-RPC envelope. Use compiled `json`, not `jsonParsed` or serialized `base64`. Missing metadata, unsafe rounded integers, unresolved addresses, and malformed layouts are rejected or left unsupported. The parser preserves large JSON integer tokens as decimal strings; monetary calculations use BigInt. JSON numeric values that were already rounded before reaching this tool cannot be recovered.

## Read the output

- `native.deltaLamports`: supplied post minus pre SOL balance for this wallet, in integer lamports.
- `walletFeeLamports`: `meta.fee` only if this wallet is fee payer. It includes priority fee; compute settings are not added again.
- `journal`: fee plus supported System transfers/account funding that touch this wallet. A native transfer is not automatically a tip, trade principal, or protocol fee.
- `unexplainedLamports`: observed wallet delta minus supported journal entries, with its sign preserved. No invented fee fills the gap.
- `tokens`: changes in balances attributed to this owner by supplied token metadata. Ownership transfers can change attribution without a token transfer. Missing owner/side metadata yields unknown deltas. Amounts remain raw integers with decimals separately supplied; no valuation is inferred.
- `coverage`: instruction and metadata limits, separate from numerical balance reconciliation.

Failed transactions produce no attempted instruction effects, only the charged network fee. Account funding is not labeled entirely as rent expense: a reserve may be recoverable. No Jito bundle or tip attribution is attempted. Separate tip transactions are outside this receipt.

## Reuse and attribution

Reuses the pure System instruction decoder and base58 helpers from [VTX-Labs/solana-explain](https://github.com/VTX-Labs/solana-explain/tree/411a5f1aee7a7115f5bf739fcd5455f27a9ce591), pinned at `411a5f1aee7a7115f5bf739fcd5455f27a9ce591`, under MIT. Included dependencies: bs58 6.0.0 and base-x 5.0.1, MIT. Licenses and bundle SHA-256 are in [vendor](vendor/). We add strict instruction-length guards, an adapter for official RPC JSON, failed-transaction handling, exact arithmetic, conservative reconciliation, CLI, tests, and presentation.

The pinned upstream transaction acquisition assumes a response shape different from official base64 RPC responses; its correlation layer can represent attempted effects in a failed transaction. This preview uses only the pure decoder exports. These are observations about the inspected commit, not a claim about every upstream version or a security audit.

## Rebuild

The checked-in standalone viewer and decoder work without development dependencies. To regenerate, use **esbuild 0.28.2** in your build environment:

```sh
git clone https://github.com/VTX-Labs/solana-explain ../solana-explain
git -C ../solana-explain checkout 411a5f1aee7a7115f5bf739fcd5455f27a9ce591
# In that checkout, install only the pinned runtime packages, without scripts:
# npm install --ignore-scripts --omit=dev --legacy-peer-deps --save-exact bs58@6.0.0 base-x@5.0.1
node scripts/build-receipt-vendor.mjs ../solana-explain
node scripts/build-receipt-viewer.mjs
```

Both build scripts also accept the path to an isolated esbuild ESM entry: the vendor builder's third command argument and viewer builder's first. Build tooling is not shipped into the runtime. Commit source, generated files, and updated hashes together. The viewer's script has an exact SHA-256 Content Security Policy; the exported static report permits no scripts.

## Next contributions

Sanitized fixtures for unsupported movements are most useful. Next: reliable wrapped SOL lifecycle/refund attribution, semantic protocol decoders, and separately verified tip registries. Each needs explicit evidence and regression cases. Do not add profit labels before cost-basis and multi-transaction accounting exist.

MIT. Retain original and vendored copyright notices.
