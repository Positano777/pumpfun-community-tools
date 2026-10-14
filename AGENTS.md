<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# RugHawk working rules

- Cloudflare-first: every runtime feature is a Worker binding (see `wrangler.jsonc`). OpenNext builds Next.js into the Worker; `worker/index.js` wraps it (rate limits, cron).
- The engine decides, the LLM explains: never let AI output change a score or a finding.
- Every program id or mint in `lib/solana/known.ts` must be verified on mainnet before it is added.
- Secrets live only as Worker secrets or in the gitignored `.dev.vars`.
- Test the engine against mainnet with `npm run scan -- token <mint>` before shipping detection changes; run `npm test` and `npm run typecheck`.
- Copy and docs: no em dash characters.
