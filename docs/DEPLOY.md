# Deploy (Vercel, free Hobby tier)

Not yet deployed — publication requires explicit approval.

1. `vercel link` (new project, framework Next.js, root `territory/`).
2. Environment variables (Production + Preview), **encrypted by Vercel, never in git**:
   - `QLOO_API_KEY` — hackathon key.
   - `SESSION_SECRET` — random 32+ bytes (`openssl rand -hex 32`); seals sessions across instances.
   - Optional, recommended: Upstash Redis via Vercel Marketplace (free tier) → `KV_REST_API_URL`, `KV_REST_API_TOKEN`.
     Enables a durable shared Qloo cache plus global rate limit and daily Qloo-call quota. Without it limits are per instance.
3. Deploy from this machine with `vercel deploy --prod`. The CLI uploads the private `.private/qloo-cache/` seed (allowed by
   `.vercelignore`, excluded from git), which `next.config.ts` traces into `/api/agent`, so the showcase works on a fresh
   instance with zero Qloo calls. A Git-based deploy would lack the seed (still works, cold runs call Qloo live).
4. Smoke test the public URL in a fresh browser: run showcase, remove a market, cut budget, export; check `/api/agent` 429/503 paths.

Runtime: Node 24.x (`package.json` engines). `/api/agent` streams NDJSON, `maxDuration = 120` s (cold run ≈ 40 s).
Verified locally: production build; fresh-instance simulation (`VERCEL=1`, empty temp dir) served the showcase in 73 ms with
0 Qloo calls. **Not yet verified on Vercel itself.**
