# Evaluation

> **Status, 2026-10-24.** Territory no longer ranks or selects countries with Qloo. The taste-portability score was retired after
> the catalogue audit below. Sections marked *(historical — retired metric)* record how that score was tested; they do not
> describe the current product. Current verification: "Current product (2026-10-24)" at the end of this file.

## Automated tests — `npm test` 44 passing, `npm run e2e` 1 passing (2026-10-23)
Client: key in header not URL, GET only, retry/backoff on 429, give-up, timeout, no retry on 4xx, cache hit, call budget, concurrency cap, empty result.
Signal: top-K overlap, membership-only (scale-free), lift vs baseline, zero baselines ignored, thin/empty/no-baseline paths.
Planner: budget/cap/exclusion/subtitle-first over a grid, insufficient markets never selected, shared language cost, 40% cut downgrades dubs, determinism, tamper detection.
API route: NDJSON stream + sealed replan, tampered session rejected (400), malformed bodies, rate limit.
Browser (Playwright, mock backend, production build): run → remove market → v2 with reason → cut budget → v3 → export.
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

## E6 — Territory vs LLM-only *(historical — retired metric for market choice; grounding results still apply)* (run 2026-10-23, 14:12–14:46 IST, within a 2 h time box)

**Setup.** `npm run e6` (`scripts/eval/e6.ts`). Four briefs (`src/lib/territory/scenarios.ts`): Korean-American arthouse
drama, neo-western crime thriller, Spanish-language coming-of-age, and a cold start whose three comps are fictional.
Same 9 candidate markets, cost table and constraints ($80k, ≤5 markets) for both conditions, then the same two revisions:
remove the top localized market in Territory's plan, then cut the budget 40%.
- **Territory:** live Qloo, taste portability, deterministic planner (104 network calls, rest cached).
- **LLM-only:** local `qwen3:14b` via Ollama, no tools, temperature 0, seed 42, JSON output, one run per prompt, given the
  same rules (shared language costs, budget, exclusions). The same independent `validatePlan` checker, using a cost total
  recomputed from the shared cost table, scores both.
Aggregates: `docs/experiments/e6-live.json`. Full outputs: `.private/` only.

**Results.**

| Measure | Territory | LLM-only |
|---|---|---|
| Plans passing rule checks (cap, exclusions, budget on recomputed cost) | 9/9 (+cold start declined) | 12/12 |
| Reported cost total correct | 9/9 (computed) | **3/12** (wrong in crime, Spanish, cold-start scenarios) |
| Cold start (fictional comps) | **Declined**: no comp resolved; explains why, no plan | Confident 5-market plan in 3/3 prompts; never abstained |
| Local comps named per market that exist in Qloo | 100% by construction (taken from Qloo) | 10/12, 7/12, 11/12; **0/10** for fictional comps |
| Claims with a checkable source | 21–22 per plan cite Qloo call ids; 0 untraceable | 0 of 2–5 per plan |
| Numeric demand/box-office claims | 0 | 0 (the model did not invent numbers) |
| Top-5 market overlap between scenarios (Jaccard) | 0.25–0.67 | 0.25–0.43 |
| Agreement with the other condition (top-5 Jaccard) | arthouse 0.11 · thriller 0.43 · Spanish 1.00 | — |

**What this does and does not show.**
- Shows: Qloo grounding + deterministic planning removes arithmetic errors, attaches evidence to every market claim,
  and refuses to plan on no evidence — the LLM fabricated a plan (and local comps) for films that do not exist.
- Shows: the two methods can disagree sharply. For the Korean-American drama the LLM chose KR/JP/FR/MX/BR (synopsis
  cues); Territory's Qloo evidence put Korea at 0.69× and chose US/DE/ES/GB/MX. **We cannot say which is better**: there is
  no outcome ground truth in this experiment.
- Does not show: higher scenario sensitivity — both conditions' picks vary across scenarios similarly.
- Does not show accuracy. Taste portability is relative taste alignment, not a box-office forecast.
- Territory bias to flag: zero-cost original-language markets (US/GB for English films) are favoured by the planner's
  value function; the reach weighting (subtitle = 0.7× dub) is a stated hypothesis.
- Limits: one small local model, one run per prompt, no human raters, 3+1 scenarios. A frontier model may do arithmetic
  better; the cold-start behaviour is the more structural finding.

## Qloo ablation *(historical — retired metric; script removed)* (2026-10-23)

Same four briefs, same deterministic planner, cost table, constraints and validator. **Only** Qloo cultural evidence differs:
the disabled condition gives every market the same uninformative score, so only cost and constraints remain.
Constraint validity and arithmetic are identical by construction (both 9/9 valid) and are **not** credited to Qloo.

| Brief | Qloo-enabled plan | Qloo-disabled plan | Markets changed by evidence (initial / after removal / after cut) |
|---|---|---|---|
| Arthouse drama | US DE ES GB MX | US GB ES MX BR | 2 / 2 / 2 |
| Crime thriller | US BR GB ES MX | US GB ES MX BR | 0 / 6 / 4 |
| Spanish coming-of-age | ES MX GB US FR | US GB ES MX BR | 2 / 4 / 4 |
| Fictional comps | declined (no evidence) | US GB ES MX BR | — |

- Without Qloo the planner returns **the same plan for every film** — it cannot tell a Korean-American drama from a
  Texas thriller. With Qloo the plans and the replacements chosen after a market is removed depend on the film.
- Cultural specificity (**superseded**, see the catalogue audit below): the 45 "market-specific nearby titles" per film were
  mostly market catalogue. 18 market claims backed by Qloo call ids; 0 unbacked
  market claims. Disabled: none.
- Reliability: the Qloo condition degraded honestly once (ambiguous comp) and declined once (no resolvable comps).
- Not shown: that the Qloo-driven choices lead to better releases. No outcome data.

## Scoring audit *(historical — retired metric; script removed)* (cached data, 0 new calls)

| Check | Result | Product consequence |
|---|---|---|
| Leave one reference genre out | ranking Spearman vs full 0.78–1.00; mean |Δ| 0.03–0.24 | Show a lift range per market; ranking stable, magnitudes approximate |
| Truncation K=50 vs K=100 | ranking Spearman 0.47–0.82 | Order among close markets is not meaningful; UI/brief say "overlapping ranges are not meaningfully different" |
| Missing data | 0 insufficient markets and 0 zero-portability baselines in these briefs; ≥2 baselines now required | Insufficient markets are never scored or planned |
| Cost bias | original-language share in plan 0.4 = share in top-5 by score 0.4; flat costs change 1–2 picks in 2/3 briefs | Planner value mixes lift and cost; War Room tags each change as evidence, cost or constraint |
| Candidate sampling | 9 fixed candidates + up to 3 reserves per revision | Results are relative to the candidate set chosen |
| Reproducibility | uncached re-query drift 0 titles (E3) | — |
Confidence labels are **low** (overlap < 8 or range width > 0.35) or **moderate**; never high, because the signal is untested
against outcomes.

## Catalogue audit (`npm run audit-catalogue`, cached data, 0 new calls, 2026-10-24)

Question: does the score account for the finding that Qloo returns largely the same titles in a country whatever
the seed? Controls = each market's neighbourhoods for the four reference genre sets (already fetched for the score).
"Catalogue" = a title near the comps that the same market also returns for at least one unrelated reference genre.

| | Arthouse drama | Crime thriller | Spanish coming-of-age |
|---|---|---|---|
| Comp neighbourhood that is catalogue (per market) | 56–81% | 87–93% | 64–86% |
| Score overlap that is catalogue (mean) | 42% | 80% | 59% |
| Showcase portability vs reference baseline, Pearson across markets | 0.52 | 0.54 | 0.85 |
| Rank agreement, score vs catalogue-removed "residual" ratio (Spearman) | 0.25 | −0.08 | 0.66 |
| Markets whose whole leave-one-out range is above 1× | none | US | none |
| Markets whose whole range is below 1× | FR MX KR JP BR | none | 8 of 9, incl. MX (ES 0.61–1.00) |

Cross-brief rank agreement of raw portability is 0.45–0.60, falling to −0.12–0.57 after normalisation.

- **The normalisation does real work, but on the wrong factor.** It removes some of the shared market level
  (cross-brief agreement drops), but it divides by how much of each *reference genre's* global list survives. It does
  not remove catalogue titles from the film's own overlap, which make up 42–80% of that overlap.
- **The market ranking does not survive removing catalogue titles.** For the arthouse brief the score ranks the US first
  and Korea 8th of 9. The catalogue-removed ratio ranks Korea first and the US 6th. Residual counts are small (6–13
  titles), so neither ordering is reliable.
- **A face-validity failure.** A Spanish-language coming-of-age film scores below a typical genre in Mexico and Spain.
  Portability penalises a market where the comps' neighbourhood is *more local*, which is the opposite of cultural fit.
- **Still defensible:** each market's catalogue share; nearby titles absent from all four controls, as candidates for
  human review only; insufficient-evidence refusals; the provenance ledger; and the planner's constraint maths.
- **No longer defensible:** "the comps travel better / worse here" as a ranking signal for choosing markets; "Korea at
  0.69×" as a finding about Korea; "market-specific local comps"; and the ablation's "film-specific market choices".
  The ablation shows the plan *depends on* the comps, not that the dependence carries cultural meaning.

## 2018+ window (investigated live, `npm run year-window`)
Location-conditioned **movie** results contained no pre-2018 titles in any variant: country or city location, `bias.trends=off`,
`signal.location.weight=low`, classic comps (1931–1980). An explicit `filter.release_year.max=2017` with a location returned
**0 results**, while the same comps without location returned 1931–2017 titles. **TV shows are not limited** (Japan min 2005).
Conclusion: an API-side coverage limit of location-conditioned movie data on the hackathon key, not a parameter artifact or
sample effect. Aggregates: `docs/experiments/year-window-live.json`.

## Netflix Top 10 (external, exploratory only)
Retrospective association, never a forecast: restrict to Netflix originals released simultaneously worldwide; note Top-10
censoring (absence ≠ zero), regional catalogue differences, and that Qloo data may postdate the release (leakage).

## Current product (2026-10-24)
- **Selection is independent of Qloo.** The planner takes the filmmaker's candidates in their priority order and optimises only
  stated costs, budget and constraints. `tests/retired-score.test.ts` (mutation-checked: the test fails when an evidence gap or a
  local-origin count is allowed to change a market's priority) scrambles every Qloo-derived field, then re-plans and replays War
  Room revisions, requiring identical plans. It also checks that sessions carry no score fields and that only evaluation scripts
  can reach the retired signal.
- **Consequence for the old ablation:** with or without Qloo, the plan is now identical *by design*. Qloo's contribution is the
  research layer, not the choice of countries.
- **Research layer on real cached data (showcase, 9 countries, 0 network calls):** 56–81% of each country's associations are general
  catalogue; 19–44 titles per country are distinctive under four genre controls; local origin is unverified for cached results
  (Qloo's release-country field was not stored before 2026-10-24). `npx tsx e2e/local-comps-check.mts` asserts Germany and Mexico
  have no qualifying local-origin comparables.
- **War Room on real cached data:** Germany withdrawal promotes Mexico, the next candidate on the list, with no new Qloo calls; a
  40% budget cut turns France's dub into subtitles. Zero constraint violations.

## Claim-checker sensitivity (cached data, 0 new calls, 2026-10-25)
Showcase brief, same 9 markets, private cache only (call budget 0). Candidates surviving every control:

| Variant | Germany | Japan | Mexico | South Korea | France |
|---|---|---|---|---|---|
| Shipped (top-100, crime-thriller + Spanish coming-of-age controls, 8 other markets) | 1 | 4 | 2 | 1 | 0 |
| Top-50 instead of top-100 | 0 | 0 | 2 | 2 | 0 |
| Crime-thriller film control only | 2 | 11 | 3 | 4 | 1 |
| Cross-market check without South Korea | 1 | 9 | 2 | 1 | 0 |
| Cross-market check against US, GB, FR only | 2 | 10 | 4 | 5 | 3 |

- The Spanish coming-of-age control shares 48–71% of the arthouse brief's own neighbourhood in Japan, Germany and Mexico, so
  it is not independent of this brief; it removes Japanese family dramas such as *The Asadas* and *A Hundred Flowers*.
- The cross-market check makes one market's result depend on which other markets the filmmaker listed.
- None of the 584 cached responses carries Qloo's `release_country`, so no showcase candidate has a verified origin.
- Consequence: candidates are leads for human review only; counts are not stable findings and are not presented as better
  than a genre-only filter.
