# Credential and release review

Reference date: 21 October 2026. Scope: Positano777/awesome-pumpfun-open-source, Positano777/pumpfun-community-tools, and the new IDL Drift Watch preview.

## Result

No confirmed exposed credential was found in the reviewed Git histories. The toolbox baseline scan covered 32 reachable commits, including inherited branches; the catalog baseline covered one commit. Gitleaks 8.30.1 was downloaded from its official GitHub release and checked against the release SHA-256 checksum. Scans used default rules plus contextual Solana signing-key and recovery-phrase rules. GitHub's secret-scanning alert API returned no alerts for the two existing repositories at the time checked. A final scan is run again after the new commits and before publication.

This is not proof that every secret encoding can be detected and not a complete application security audit. The full inherited web app is not deployed by this preview. Its authentication, signing, billing, fetch behavior, and dependencies still need a deployment-specific review.

## Reviewed scanner matches

| Match | Classification | Action |
| --- | --- | --- |
| Inherited AccountView API example | Literal abbreviated key placeholder ending in an ellipsis; not a usable bearer credential | Exact historical fingerprint ignored; no broad file exclusion |
| Inherited STRIPE_PRICE_API value | Public Stripe Price ID, not an API secret | Exact historical fingerprint ignored; no broad rule exclusion |

No live key was exercised to test validity. No credential value is reproduced in this review. No history rewrite or credential rotation was indicated by these two matches.

## Findings and fixes

**SEC-01, medium, fixed: diagnostic forwarding could disclose caller data.** The first exporter spread arbitrary outflow properties into public evidence and copied raw partial-warning strings. Caller extensions or provider error text could contain private diagnostics or credential-bearing URLs. The exporter now projects known observation fields and uses fixed warning summaries. The scan engine also emits a fixed partial-failure message. Syntax errors are summarized without echoing malformed input text. Regression cases use synthetic markers to verify that these values do not appear in output.

Evidence: [explicit outflow projection](https://github.com/Positano777/pumpfun-community-tools/blob/main/lib/scan/launch-evidence.ts#L15), [warning projection](https://github.com/Positano777/pumpfun-community-tools/blob/main/lib/scan/launch-evidence.ts#L27), and [partial scan guard](https://github.com/Positano777/pumpfun-community-tools/blob/main/lib/scan/context.ts#L57).

**SEC-02, release correctness, fixed: uncertain block coverage could resemble no activity.** The inherited small-history path sampled slot + 1 and did not consistently verify mint creation. Every located-creation path now checks the creation instruction and reads the exact slot. The response records unavailable blocks, missing metadata, missing creation, and sample truncation. Transaction-level token gains link to their signatures. Coverage describes the provider response and does not prove transaction economic intent or bundle membership.

Evidence: [creation validation and exact-slot read](https://github.com/Positano777/pumpfun-community-tools/blob/main/lib/scan/launch.ts#L96) and [block response coverage](https://github.com/Positano777/pumpfun-community-tools/blob/main/lib/scan/launch-block.ts#L19).

**SEC-03, limitation: full application build remains unverified.** Full dependency installation failed again with Windows filesystem errors. Scoped strict checking and the isolated engine tests passed. The dependency-free Node exports and IDL utility are independently executable. No complete web build, wallet action, trade, or hosted deployment has been validated.

## Ongoing protection

- Keep .env files, private keypairs, session tokens, and provider credentials out of Git and screenshots.
- Run redacted history scanning before release; review exact matches before suppressing them.
- Review exports before sharing. Explicit fields such as transaction signatures and names are still user-supplied.
- If a real credential is exposed later, revoke/rotate it first; hiding the latest file is not sufficient.
- GitHub Actions remains disabled on the toolbox fork so inherited production deployment cannot run.

See each repository's SECURITY.md for the redacted scan command and the scope of its security claims.

Current-source snapshots were also scanned. They produced the same two reviewed inherited false positives and no additional match. All three added contextual signing-key/recovery-phrase rules detected their deliberately invalid synthetic canaries. Test results: 90 isolated TypeScript tests, three standalone evidence CLI tests, and twelve IDL checker tests passed. Strict scoped TypeScript checking and the 44-record catalog consistency check passed.
