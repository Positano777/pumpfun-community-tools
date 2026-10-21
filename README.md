# Pumpfun Community Tools

Open-source tools for inspecting Solana launches and sharing reproducible evidence. Maintained by [Positano777](https://x.com/positano777).

**Developer preview.** This is an attributed [RugHawk](https://github.com/bobvasic/rughawk) fork, originally built by RaptorLabs under MIT. Read [upstream attribution and changes](UPSTREAM.md). The inherited application and its branding are preserved; no hosted Positano service is deployed.

## Available now

- Launch findings distinguish observed token gains from unverified purchases, coordination, and bundle membership.
- Top-holder absence is no longer presented as proof of a sale.
- Offline launch-evidence export from a saved token scan, with explicit coverage limits and source transaction links.
- Synthetic fixtures and regression tests. Fixtures are examples, not real launch evidence.

## Try the export

Requires Node.js 22 or later. The standalone command has **zero package dependencies**; no install is needed.

```sh
node evidence/cli.mjs examples/launch-synthetic.json
node evidence/cli.mjs examples/launch-synthetic.json evidence.json
node --test evidence/cli.test.mjs
```

The offline export needs no wallet, API key, or network request. It formats supplied scan data; it does not independently verify the blockchain. It deliberately does not report a token as safe or prove Jito membership. Existing output files are never overwritten.

Read [validation results and limits](VALIDATION.md) before using the inherited full application. All 83 TypeScript tests passed in an isolated engine environment; full web-app installation and build remain unverified. GitHub Actions is disabled for this fork.

## Use a real scan

Follow the RPC setup in [upstream documentation](UPSTREAM_README.md#run-it), then:

```sh
npm run scan -- token <mint> scan.json
npm run evidence -- scan.json evidence.json
```

Archive RPC retention, upstream sampling, fee-payer attribution, and scan errors affect coverage. A located creation transaction does not mean every launch-slot transaction was inspected. The export records that limitation even when no warnings are supplied. Self-hosting infrastructure may cost money.

## Roadmap

1. Explicit block-fetch and sampling completeness in the engine.
2. Transaction-level launch evidence and real replay fixtures.
3. Creator outflow alerts with transport adapters.
4. Paper-trading and execution adapters after compatibility and signing review.

Trading automation is not newly implemented or validated in this preview. See the [community catalog](https://github.com/Positano777/awesome-pumpfun-open-source) for execution candidates and research status.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md). Useful contributions include reproducible false positives, decoder coverage, missing-history fixtures, and upstream-compatible fixes. Never post private keys or credential-bearing RPC URLs.

## License

MIT. Original RugHawk copyright and license are preserved in [LICENSE](LICENSE). New community contributions are made under the same license.
