# Security and credentials

Never commit signing keys, wallet recovery phrases, API credentials, session cookies, credential-bearing RPC URLs, or private .env files. Public mint/wallet addresses, Stripe Price IDs, and deployment resource IDs are not signing credentials.

The launch-evidence CLI is read-only and has no package dependencies. It does not need a wallet or API key. It deliberately omits raw warning diagnostics and unknown outflow properties. Review every export before publishing it; explicit transaction/address fields are still user-supplied data.

Use Gitleaks with the checked-in default-extended rules for a redacted history check:

```sh
gitleaks git --redact=100 --log-opts="--all" .
```

The .gitleaksignore entries refer only to two reviewed historical false-positive fingerprints, not broad file exclusions. Secret detection cannot prove there are no secrets, detect every encoding, or establish a full application security audit.

If a real credential is exposed, revoke/rotate it with its provider before considering history cleanup. Do not post the value in an issue, PR, or screenshot. For private reporting, use GitHub private vulnerability reporting if enabled; otherwise contact the maintainer through a privately agreed channel without including the credential in a public message.

The inherited full RugHawk web application is not deployed by this community preview and has not received a complete application security audit. Its authentication, billing, wallet actions, external requests, and dependencies need separate review before deployment.
