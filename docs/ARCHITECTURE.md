# Architecture

```
src/lib/qloo/      client.ts (GET-only, X-Api-Key server-side, timeout, 429/5xx backoff w/ Retry-After,
                   concurrency cap 4, call budget, sha256 cache key, CallRecord trace)
                   mock.ts (documented contract, "[MOCK]" names) · factory.ts (live iff QLOO_API_KEY; private FileCache in .private/)
src/lib/territory/ market-signal.ts (taste portability, Spearman, Jaccard) · markets.ts (markets, reference genre sets)
                   planner.ts (deterministic optimizer + independent validatePlan)
src/lib/agent/     agent.ts (state machine, runAgent, replan, diffPlans) · research.ts (neighbourhoods, market research, fallback) · resolve.ts (disambiguation) · claims.ts (ledger)
scripts/           experiments.ts (E1–E6) · showcase.ts (vertical slice)
```

## States
Initial: `INPUT_VALIDATION → ENTITY_RESOLUTION → RESEARCH_PLANNING → QLOO_INVESTIGATION → EVIDENCE_VERIFICATION → STRATEGY_CONSTRUCTION → CONSTRAINT_VALIDATION → FINAL_REPORT`.
Replan: `IMPACT_ANALYSIS → SELECTIVE_RESEARCH → STRATEGY_REVISION → VERIFICATION → FINAL_REPORT`.
Each transition emits a `TraceEvent` with the Qloo call ids made during that state.

## Division of labour
- Deterministic code: validation, scoring, budget arithmetic, constraint checks, diffing, claim provenance.
- LLM (planned, optional, free tier): explain the plan in prose **using only ledger claims**; suggest comps. It never produces numbers.
- Research policy today is deterministic (fallback and reserve rules); this is stated, not dressed up as LLM autonomy.

## Bounds
Client call budget (default 120, agent/showcase 160; a cold 9-market run uses ~100 calls, ~40 s; reference baselines are cached after the first run), retries 3, timeout 12 s, concurrency 4, ≤4 fallback markets, ≤3 reserve markets per replan, planner ≤14 candidates.

## Security
Key only in server env; never in URL, logs, CallRecord or client bundle. `.private/` and `.env*` gitignored.
