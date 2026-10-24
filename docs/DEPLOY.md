# Deployment

Status: **live** at https://territory-qloo.netlify.app (Netlify, production deployed 2026-10-23 with `scripts/deploy-draft.sh --prod`).

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

## Netlify steps (as actually done, 2026-10-23)
1. Project `territory-qloo` created via the Netlify MCP; CLI linked (`netlify link --id …`).
2. Secrets entered by the owner in the dashboard (Project configuration → Environment variables, "Contains secret
   values", scopes Builds/Functions/Runtime): `QLOO_API_KEY`, `SESSION_SECRET`, `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN`. (CLI `env:set` and the env API returned success/403 without storing on this account.)
   `TERRITORY_HOSTED` is optional: the Netlify/Lambda runtime is detected.
3. Deploy with `scripts/deploy-draft.sh` (draft) or `scripts/deploy-draft.sh --prod` (production, approval required).
   It builds from a clean staging copy with **no `.env` files** — Netlify's Next.js runtime otherwise copies `.env.local`
   into the server function — keeps the private seed in the function, and aborts if an env file reaches the bundle.

## Measured on the draft deploy (2026-10-23)
Page 200 in 1.1–1.4 s (182 KB HTML). Showcase 1.4–1.9 s (0 live, 120 cached). Germany removal 0.9 s. Budget cut 0.6 s
(Germany stays excluded). 3 concurrent users 1.0–4.6 s. New 3-comp film 4.4 s (14 live calls). Cold 12-market brief with
new comps 11.8 s (44 live), well under the 60 s limit. Upstash counter rose by exactly the live calls; shared cache grew.
Browser journey (showcase → Germany → cut → export): 5.7 s, 0 page errors. Tampered session 400; `/.private/…`,
`/qloo-cache/…`, `/.env.local`, function paths 404. Not tested on the host: Redis outage (unit-tested), deadline cutoff
(unit-tested), Netlify usage/credit numbers.

## Response headers and CSP
Every route sends `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin` (plus HSTS and `nosniff` from
the host). A Content-Security-Policy is **opt-in at build time**: `TERRITORY_CSP=report-only` or `TERRITORY_CSP=enforce`
(next.config.ts evaluates it during the build, so set it for the build, not only the runtime). The policy allows `'self'`,
inline scripts/styles (Next's bootstrap and streaming scripts and motion/WebGL inline styles need them; nonces would force
fully dynamic rendering), `data:` images (film-grain SVG) and `blob:` (export download); it forbids framing, plugins and
off-site connections. Local test (production build, full journey incl. WebGL globe, NDJSON streaming, dialog, blob export):
zero blocked resources and zero console errors in both modes. The single violation reported, an `eval` probe inside Zod
(`Function("")` wrapped in try/catch, falls back to the non-eval path), is benign. `e2e/csp-check.mts` repeats this check.

## Data protection & integrity (audited)
- Key: server env only; absent from every response and client bundle (tested).
- Browser session: HMAC-SHA256 **signed, not encrypted** — the browser can read it, so it contains only what the UI displays
  (plan, scores, displayed nearby-title examples (≤5 per group), claims, comp ids). Measured 23 KB, 6 entity ids (comps + shown alternatives).
- Research context (raw neighbourhood id lists, reference lists): **AES-256-GCM encrypted**, authenticated; tampering → 400.
- `SESSION_SECRET` (≥ 32 chars) is mandatory on hosted live deployments; the server refuses to seal otherwise.
- Seed cache: server function only; 404 on `/.private/...`, `/qloo-cache/...`, and traversal probes (tested on a production build).

## Quota (fail-closed)
Before each run the server **reserves** up to 220 live Qloo calls with an atomic Redis `INCRBY` against a 5,000/day cap and
returns unused calls afterwards. Redis unreachable, or hosted without Redis → **0 live calls granted**; cached evidence still
serves. Locally (not hosted) an in-memory pool is used. Per-IP rate limit: 12 runs / 10 min.

**Isolation (incident 2026-10-23).** Mock-backend test runs reserved against, and were never refunded from, the
production counter: the route reserved before knowing the source, and the mock client's calls were released as if they
were live. Now: (1) the mock source never reserves, meters or touches shared counters; (2) Redis credentials are honoured
only on a hosted deployment, or when `TERRITORY_REDIS_NAMESPACE` names an isolated keyspace (every key is prefixed with
it); `next dev`, local `next start`, Playwright, CI and vitest otherwise fall back to in-memory limits and log one warning;
(3) `TERRITORY_TEST=1` blocks the production keyspace even if hosting looks detected; (4) the header badge reads
`/api/status` at runtime and each run's own call sources, not the build environment. The counter key rolls at 00:00 UTC.
