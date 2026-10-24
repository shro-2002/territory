# Architecture

```
src/lib/qloo/      client.ts (GET-only, X-Api-Key server-side, timeout, 429/5xx backoff w/ Retry-After,
                   concurrency cap 4, call budget, sha256 cache key, CallRecord trace)
                   mock.ts (documented contract, "[MOCK]" names) · factory.ts (live iff QLOO_API_KEY; private FileCache in .private/)
src/lib/territory/ claim-check.ts (per-market claim decision: genre, unrelated-film and cross-market controls, provenance) · nearby-titles.ts (catalogue vs genre-control stage) · market-signal.ts (retired taste portability, kept for evaluation scripts; Spearman, Jaccard) · markets.ts (markets, reference genre sets)
                   planner.ts (deterministic optimizer + independent validatePlan)
src/lib/agent/     agent.ts (state machine, runAgent, replan, diffPlans) · research.ts (neighbourhoods, market research, fallback) · resolve.ts (disambiguation) · claims.ts (ledger)
scripts/           experiments.ts (E1–E6) · showcase.ts (vertical slice)
```

## States
Initial: `INPUT_VALIDATION → ENTITY_RESOLUTION → RESEARCH_PLANNING → QLOO_INVESTIGATION → EVIDENCE_VERIFICATION → STRATEGY_CONSTRUCTION → CONSTRAINT_VALIDATION → FINAL_REPORT`.
Replan: `IMPACT_ANALYSIS → SELECTIVE_RESEARCH → STRATEGY_REVISION → VERIFICATION → FINAL_REPORT`.
Each transition emits a `TraceEvent` with the Qloo call ids made during that state.

## Division of labour
- Deterministic code: validation, claim check, budget arithmetic, constraint checks, diffing, claim provenance.
- No LLM in the deployed product. All report text comes from the provenance-tagged claim ledger.
- Research policy is deterministic (fallback and reserve rules); this is stated, not dressed up as LLM autonomy.

## Bounds
Per-request Qloo reservation 220 (every HTTP attempt, retries included, is metered; a cold 9-market run uses ~170 calls, ~40 s; the showcase is answered from cache), retries 3, timeout 12 s, concurrency 4, research deadline 50 s, ≤4 fallback markets, ≤3 reserve markets per replan, planner ≤14 candidates.

## Security
Key only in server env; never in URL, logs, CallRecord or client bundle. `.private/` and `.env*` gitignored.

## Web app (Phase C)

```
src/app/page.tsx              server: loads aggregate experiment JSON ("use cache"), renders TerritoryApp
src/app/api/agent/route.ts    POST {action:"run",input} | {action:"replan",session,token,patch} -> NDJSON stream
                              messages: trace (incl. per-market progress) · result (session, HMAC token, calls) · error
src/components/               TerritoryApp (container) · Atlas (d3-geo + world-atlas) · TracePanel · MarketPanel
                              WarRoom (plan, controls, revision compare) · EvidenceLab · BriefForm · ProvenanceTag
src/lib/server/               seal.ts (HMAC over the session) · rate-limit.ts (per-IP + per-instance Qloo cap)
src/lib/client/               stream.ts (NDJSON reader) · brief.ts (Markdown export)
```
Stateless by design: the session travels with the browser, sealed so the server only replans evidence it produced.
Cache: `.private/qloo-cache` locally; hosted: Upstash Redis (shared) → `os.tmpdir()` → read-only deployed seed.
Limits: 12 runs / 10 min / IP; 5,000 Qloo calls / day shared across instances (Redis counter), 3,000 / instance / day fallback; 220 calls reserved per run.
Dependencies: production `npm audit` clean; 5 high advisories are in the dev-only lint chain (eslint-config-next → braces).
