# Evaluation

## Automated tests (`npm test`) — 39 passing on 2026-10-23
Client: key in header not URL, GET only, retry/backoff on 429, give-up, timeout, no retry on 4xx, cache hit, call budget, concurrency cap, empty result.
Signal: tie handling, **normalization invariance**, insufficient-evidence paths, comp/anchor overlap.
Planner: budget/cap/exclusion/subtitle-first over a grid, insufficient markets never selected, shared language cost, 40% cut downgrades dubs, determinism, tamper detection.
Agent (mock, e2e): disambiguation by year/format, unresolved comp, reproducibility, invalid input, cold start with unknown comps, API 500s → degraded not crash, replan reuse/selective research/invalidation, budget cut without new calls, subtitle-first.

## Planned metrics (not yet measured — no numbers claimed)
| Metric | Definition |
|---|---|
| Grounded claim % | share of report sentences with provenance `qloo`/`external` that cite ≥1 call/source |
| Unsupported claim count | sentences an auditor cannot trace to a call, source or user input |
| Task completion | runs ending `complete`/`degraded` with a valid plan within call budget |
| Correctness under change | after each constraint patch, `validatePlan` = [] and diff matches constraint |
| Qloo contribution | E6: plan overlap (Jaccard of markets) Qloo vs LLM-only; LLM-only unsupported-claim count |
| Reliability | live status distribution, p50/p95 latency across N scripted runs |

## E6 protocol (Qloo vs LLM-only)
Same inputs to (a) Territory and (b) an LLM prompted to produce the same plan without tools. Score both with the
same claim audit. Report market-set differences and unsupported claims. No winner is pre-declared.

## Netflix Top 10 (external, exploratory only)
Retrospective association, never a forecast: restrict to Netflix originals released simultaneously worldwide; note Top-10
censoring (absence ≠ zero), regional catalogue differences, and that Qloo data may postdate the release (leakage).
