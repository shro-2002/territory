# Deployment

Status: **prepared, not deployed.** Publishing needs explicit approval and your own host login.

## Host decision (checked against official docs, 2026-10-23)

| | Vercel Hobby | Netlify Free (credit plan) |
|---|---|---|
| Commercial use | "restricted to non-commercial personal use only"; commercial = deployment "used for the purpose of financial gain of **anyone** involved in any part of the production". A cash-prize/investment entry is **not clearly excluded**; Vercel says to contact support if unsure. | No personal/non-commercial clause found in Terms of Use or Self-Serve Subscription Agreement. Free projects may be removed "without notice for any reason". |
| Function duration | 300 s default and max (Fluid compute) | **60 s synchronous, not configurable** |
| Payload | 4.5 MB request/response | 6 MB buffered, 20 MB streamed |
| Memory | 2 GB | 1 GB |
| Cost model | Free monthly allotments; over limit → paused up to 30 days | 300 credits/month **hard limit → all projects paused** ("Site not available"). Production deploy 15 credits; compute 10/GB-h; bandwidth 20/GB; 2 per 10k requests |

**Recommendation: Netlify Free** — the only one of the two whose terms we found no conflict with. Mitigations: research stops at
`RESEARCH_DEADLINE_MS` (default 50 s) so runs fit the 60 s limit, keeping already-researched markets; limit production deploys
(≤ 6 = 90 credits); watch credit usage daily during judging. If you prefer Vercel, ask Vercel support first and keep the answer.
Estimated judging load (assumption, not measured): ~0.5 MB per visit → 1,000 visits ≈ 0.5 GB ≈ 10 credits + ~6 credits requests;
a live 40 s run at 1 GB ≈ 0.11 credits.

## Netlify steps (after approval)
1. `npx netlify-cli login` (you, in your own terminal), then `npx netlify-cli init` in `territory/` (new site, no Git CI needed).
2. Runtime env vars (`npx netlify-cli env:set …` or UI; stored encrypted by Netlify, never in git):
   `QLOO_API_KEY`, `SESSION_SECRET` (`openssl rand -hex 32`), `TERRITORY_HOSTED=1`.
   Optional for **live custom research**: Upstash Redis free (500K commands/month, 250 MB) → `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN`. Without it the hosted site is **cache-only** (showcase + War Room work; uncached briefs show a notice).
3. `npx netlify-cli deploy --build --prod` from this machine. The local build includes the private `.private/qloo-cache/`
   seed in the server function (`netlify.toml` `included_files`, `next.config.ts` tracing). It is not in the publish directory or git.
4. External browser test (see `docs/JUDGE_DEMO.md` checklist); record latency; probe `/.private/...` → must be 404.

## Data protection & integrity (audited)
- Key: server env only; absent from every response and client bundle (tested).
- Browser session: HMAC-SHA256 **signed, not encrypted** — the browser can read it, so it contains only what the UI displays
  (plan, scores, displayed local comps, claims, comp ids). Measured 23 KB, 6 entity ids (comps + shown alternatives).
- Research context (raw neighbourhood id lists, reference lists): **AES-256-GCM encrypted**, authenticated; tampering → 400.
- `SESSION_SECRET` (≥ 32 chars) is mandatory on hosted live deployments; the server refuses to seal otherwise.
- Seed cache: server function only; 404 on `/.private/...`, `/qloo-cache/...`, and traversal probes (tested on a production build).

## Quota (fail-closed)
Before each run the server **reserves** up to 220 live Qloo calls with an atomic Redis `INCRBY` against a 5,000/day cap and
returns unused calls afterwards. Redis unreachable, or hosted without Redis → **0 live calls granted**; cached evidence still
serves. Locally (not hosted) an in-memory pool is used. Per-IP rate limit: 12 runs / 10 min.
