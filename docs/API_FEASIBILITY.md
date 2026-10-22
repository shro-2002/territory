# API Feasibility (E1–E6)

Status 2026-10-23: **no Qloo key available yet.** Every experiment has run only against the
contract mock (`src/lib/qloo/mock.ts`). Mock results prove the harness works; they say nothing about Qloo.
The go/no-go decision is **open** until `npm run experiments` runs live.

## What official docs say (checked 2026-10-23)

| Fact | Source |
|---|---|
| Host `https://hackathon.api.qloo.com`, header `X-Api-Key`, GET only | Hackathon developer guide |
| Paths: `/v2/insights`, `/search`, `/v2/tags`; `/recommendations`, `/recs`, `/v2/insights/search` invalid | Developer guide |
| Invalid params are **ignored silently**; empty `entities` can mean a bad parameter | Developer guide |
| 401 wrong host/header, 403 unsupported type, 400 unresolved `signal.location.query` | Developer guide, Insights deep dive |
| `signal.location.query` = fuzzy locality name; `signal.location` = WKT or locality ID | Insights deep dive |
| `filter.results.entities` = return affinity for named IDs | Insights deep dive |
| `take` max 50 | Insights deep dive |
| Heatmap `affinity_rank` is "rank-normalized within the result set" | Heatmaps use case |
| Rate/monthly quotas exist, numbers unpublished | Developer guide |
| Private server-side caching allowed; no Qloo data in public repos | Developer guide, rules |

**Discrepancy that E2 must resolve:** the *Entity Type Parameter Guide* does not list any
`signal.location*` parameter for `urn:entity:movie` / `tv_show`, while the *Location-Based Insights*
use case shows `filter.type=urn:entity:movie&signal.location.query=Lower East Side`. Because invalid
params are silently ignored, a request "working" proves nothing — E2 measures whether results change.

**Affinity scores are treated as normalized per query** (brief + heatmap docs + mock check `perQueryMaxIsOne`).
I could not find a docs page stating the exact formula. Territory therefore never compares raw affinity
across queries.

## Method for cross-market comparability (E3)

One query per market requests the comps **and** a fixed 16-title global reference panel via
`filter.results.entities`. Inside one query all scores share one normalization, so the comps' percentile
among the panel is meaningful; that percentile is compared across markets. Unit test
`market-signal.test.ts › is invariant to the per-query normalization constant` proves scale invariance.
Limits: ordinal, relative to the panel (panel titles have their own local popularity), not audience size.

## Experiments

Run: `npm run experiments` (live if key set) · `-- --mock` · `-- --mock-ignore-location` (negative control).
Outputs: `docs/experiments/results-<mode>.json` (aggregates only).

| ID | Hypothesis | Request | Pass rule | Failure → action | Mock | Neg. control | Live |
|---|---|---|---|---|---|---|---|
| E1 | ≥80% of indie/non-English comps resolve | `/search?query&types=movie,tv_show&take=8` | coverage ≥ 0.8, fake title unresolved | Fallback to user-confirmed IDs; tags | pass (synthetic) | — | **pending key** |
| E2 | country `signal.location.query` changes ordering | `/v2/insights?filter.type=movie&signal.location.query=<c>&filter.results.entities=<ids>` vs no location | mean pairwise Spearman < 0.9 and vs-baseline < 0.95, ≥6 entities | try `signal.location=<locality id>`, heatmap; else pivot to city scale | pass (synthetic) | **fail (ρ=1.0)** | **pending key** |
| E3 | anchor percentile varies across markets, robust to one anchor | reuses E2 queries | range ≥ 0.15, leave-one-out spread ≤ 0.2 | widen panel; report as unsupported | pass (synthetic) | **fail (range 0)** | **pending key** |
| E4 | unreleased film researchable from comps | `/search` + `/v2/insights?signal.interests.entities=<comps>` | all 3 concepts: ≥2 comps + related titles | require ≥4 comps; tags fallback | pass (synthetic) | — | **pending key** |
| E5 | errors documented; p95 < 6 s | error probes + latency of all calls | p95 < 6 s | lower market count, cache showcase | inconclusive (mock latency) | — | **pending key** |
| E6 | Qloo changes the decision vs LLM-only | see EVALUATION.md | — | — | not run | — | not run |

## Decision rule

- E2 **and** E3 pass live → country-level Territory as specified.
- E2 fails → retry with `signal.location` locality IDs and `urn:heatmap`; if still invariant, pivot geography to
  city/metro level (documented supported scale) and re-label the product claim. Record in DECISION_LOG.
- Never ship country rankings that E2/E3 did not validate.
