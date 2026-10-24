# API Feasibility (E1–E6)

Status 2026-10-23 13:40 IST: **live key active. E1–E5 pass on the live hackathon API; E6 run (mixed, honest results in EVALUATION.md).**
Country-level Territory is **GO**, with the method change and the 2018+ release-window limit below.
Aggregates: `docs/experiments/results-live.json`. Raw responses: `.private/` only.

## Live findings that changed the design

1. **Country location works.** `signal.location.query=<country>` with `signal.interests.entities=<comps>` returns a clearly
   different neighbourhood per country (mean Jaccard vs no-location 0.077; between markets 0.121), with locally
   produced titles prominent in each market (titles omitted here: no Qloo response data in the repo).
2. **`filter.results.entities` + location is a filter, not a scorer.** Asking for 19 specific titles under a location
   returned only the 2 already in that market's pool; without location it returned 19 with no affinity. The planned
   fixed-anchor-panel method was therefore **abandoned**.
3. **Affinity max per query is not 1** (0.86–0.99), but values are still query-relative; we use none of them across queries.
4. **Location-conditioned movie results only contain titles released 2018 or later** — confirmed as an API coverage limit
   (explicit ≤2017 filter with location → 0 results; TV shows unaffected; see EVALUATION.md).
   Global neighbourhoods of older comps (median 2013) overlapped 0. All neighbourhoods now use `filter.release_year.min=2018`.
   Product implication: evidence reflects post-2018 taste; comps may be older.
5. **Schema:** live entities carry `popularity: null` and `tags: null`; schema made nullish (first live run failed on this).
6. **Error contract differs from docs:** unsupported `filter.type` → **400** (docs: 403); unresolvable
   `signal.location.query` ("Atlantis…") → **200 with results** (docs: 400); free-text tag → 200 with results.
   Heatmap needs `output.heatmap.boundary` = `urn:geohash` or `urn:entity:locality` (we sent `city`).
7. **Blockbuster comps (Titanic, Inception…) overlap 0 in every market** even before the year filter → excluded from baselines.

## Method: taste portability (replaces anchor panel)

`N0` = comps' top-100 neighbourhood (no location, 2018+). `Qm` = same query conditioned on market m.
`portability(m) = |Qm ∩ N0| / 100` — set-based, so per-query normalization is irrelevant.
`score(m) = portability(m) / mean portability of 4 reference genre comp sets (horror, comedy, animation, action) in m`,
which removes market-wide effects (data density, catalogue). Nearby titles are checked against the same
market's reference-genre neighbourhoods: 56–93% also appear for unrelated genres (market catalogue), so only titles
absent from those lists are shown as distinctive, and only relative to the genres tested (see EVALUATION.md). Ordinal, relative; not audience size.

## Live results (2026-10-23)

| ID | Result | Key numbers |
|---|---|---|
| E1 coverage | **pass** | 19/19 real titles resolved (2 ambiguous: *Oldboy*, *Aftersun* duplicates); fake title unresolved |
| E2 location | **pass** | Jaccard vs global 0.026 (IN) – 0.111 (US/DE); negative-control mock = 1.0 |
| E3 comparability | **pass** | arthouse lift range 0.54 (BR 0.57 – US 1.11); Spearman arthouse vs thriller across 8 markets **0.07** (genre-specific); uncached re-query drift **0 titles** |
| E4 cold start | **pass** | 3/3 comp-only concepts: all comps resolved, 10 related titles each |
| E5 reliability | **pass** | 111 network calls: 108×200, 3×400 (intentional probes); p50 499 ms, p95 846 ms; one 429 earlier run, retried OK |
| E6 Qloo vs LLM | **run** (see EVALUATION.md) | LLM-only: 9/12 wrong cost totals, planned confidently for fictional comps 3/3; Territory declined. No accuracy claim |

Not yet tested: stability across days, more than 2 genre sets, TV (`urn:entity:tv_show`) neighbourhoods, markets outside the 18 listed.

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

**Discrepancy (resolved live — location works for movies):** the *Entity Type Parameter Guide* does not list any
`signal.location*` parameter for `urn:entity:movie` / `tv_show`, while the *Location-Based Insights*
use case shows `filter.type=urn:entity:movie&signal.location.query=Lower East Side`. Because invalid
params are silently ignored, a request "working" proves nothing — E2 measures whether results change.

