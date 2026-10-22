# Upstream attribution

This repository is a community fork of [bobvasic/rughawk](https://github.com/bobvasic/rughawk), originally built by RaptorLabs. Base revision: `f2ad9f2adc7dda5e135536bcc973a431d992010d`.

The original MIT license and copyright remain in LICENSE. Original documentation is preserved in UPSTREAM_README.md. This fork is maintained by Positano777 and is not the official RugHawk service or a RaptorLabs partnership.

Initial changes: evidence-qualified launch finding and timeline copy; top-holder absence no longer described as proof of sale; portable offline launch-evidence JSON export; regression coverage; inherited production workflows disabled on this fork.

Legacy finding IDs, field names, scoring weights, and upstream detection heuristics remain for compatibility. The rest of the inherited product still requires review and may use stronger language. This first release is an evidence-export developer preview, not a validated new trading or detection system.

Second preview changes: exact-slot block reads on all creation paths, explicit provider-response coverage and transaction observation links, redacted diagnostic policy, and secret-scanning configuration. Detector coverage is more explicit; purchase attribution and full outflow coverage still rely on upstream heuristics and need further validation.

Transaction receipt preview: independently authored RPC adapter, exact balance reconciliation, conservative journal, offline viewer and CLI. Pure System instruction decoding and base58 helpers are reused from VTX-Labs/solana-explain at revision `411a5f1aee7a7115f5bf739fcd5455f27a9ce591`, MIT. Included bs58 6.0.0 and base-x 5.0.1 notices, source pin, and bundle hash are in receipt/vendor/. No upstream fetching or effect-correlation layer is used. See receipt/README.md for scope and rebuild instructions.
