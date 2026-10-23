# Evaluation

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

## E6 — Territory vs LLM-only (run 2026-10-23, 14:12–14:46 IST, within a 2 h time box)

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

## Qloo ablation — the primary necessity test (`npm run ablation`, 2026-10-23)

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
- Cultural specificity: per film, 45 market-specific nearby titles and 18 market claims backed by Qloo call ids; 0 unbacked
  market claims. Disabled: none.
- Reliability: the Qloo condition degraded honestly once (ambiguous comp) and declined once (no resolvable comps).
- Not shown: that the Qloo-driven choices lead to better releases. No outcome data.

## Scoring audit (`npm run audit-scoring`, cached data, 0 new calls)

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

## 2018+ window (investigated live, `npm run year-window`)
Location-conditioned **movie** results contained no pre-2018 titles in any variant: country or city location, `bias.trends=off`,
`signal.location.weight=low`, classic comps (1931–1980). An explicit `filter.release_year.max=2017` with a location returned
**0 results**, while the same comps without location returned 1931–2017 titles. **TV shows are not limited** (Japan min 2005).
Conclusion: an API-side coverage limit of location-conditioned movie data on the hackathon key, not a parameter artifact or
sample effect. Aggregates: `docs/experiments/year-window-live.json`.

## Netflix Top 10 (external, exploratory only)
Retrospective association, never a forecast: restrict to Netflix originals released simultaneously worldwide; note Top-10
censoring (absence ≠ zero), regional catalogue differences, and that Qloo data may postdate the release (leakage).
