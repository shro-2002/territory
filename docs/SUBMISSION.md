# Devpost submission draft

**Name:** Territory
**Tagline:** An AI distribution war room for independent film — Qloo-grounded market research that re-plans when the plan breaks.

## Inspiration
Independent films commit sales and localization budgets on intuition and big-market box office. Mid-size titles have no data,
and plans change constantly: a buyer passes, a financier trims the localization line, a territory gets pre-sold.

## What it does
See README "What it does". The signature moment: after the plan is built, remove a market or cut the budget and watch Territory
analyse impact, keep valid evidence, research only the replacements it needs (same-language markets first), re-plan, re-verify,
and explain each change as driven by Qloo evidence, cost or your constraint.

## How we built it
Next.js 16 / TypeScript; server-side typed Qloo client (GET only, timeouts, 429 back-off, concurrency 4, call budgets, private
slimmed cache); bounded deterministic agent state machine (validation → resolution → planning → investigation → verification →
strategy → constraint check → report; and impact analysis → selective research → revision → re-verification); taste-portability
signal; exhaustive constrained optimizer with an independent validator; HMAC-sealed stateless sessions; NDJSON streaming; d3-geo
atlas. 49 unit/integration tests, Playwright journey test, CI.

## Qloo usage
`/search` (comp and reference resolution), `/v2/insights` with `filter.type=urn:entity:movie`, `signal.interests.entities`,
`signal.location.query`, `filter.release_year.min`, `take`, `page`. Findings we reported honestly: location-conditioned movie data
is 2018+ only; `filter.results.entities` with a location filters rather than scores; error codes that differ from docs.

## Challenges
Affinity is normalized per query, so raw scores are not comparable across countries; our first anchor-panel design failed live
and was replaced by a set-overlap method. Quota protection on serverless.

## Accomplishments
A controlled Qloo ablation; an honest LLM-only comparison; a War Room that conditions its tool use on what changed.

## What we learned / limits
No outcome validation yet; truncation sensitivity (K=50 vs 100) means close markets are not meaningfully ordered.

## What's next
Usability sessions with filmmakers and sales agents; outcome backtests on released titles; TV series (no 2018 limit); real
localization quotes; festival and buyer data.

---

# Finalist pitch (≈90 s)

**Problem & buyer.** Independent producers and boutique sales agents decide which territories to pitch and which languages to dub
with no data for mid-size titles — and the plan breaks every week. Buyer: indie sales agents, small distributors, producers
preparing AFM/EFM/Marché.

**Why a generic LLM can't do it.** An LLM can repeat regional stereotypes; it cannot tell you how much of *these comps'* taste
neighbourhood survives in Brazil versus Japan. In our test it planned confidently for films that do not exist and got cost totals
wrong 9 times in 12. Remove Qloo from Territory and it recommends the same five markets for every film.

**What the agent does.** Resolves comps, investigates each market with location-conditioned Qloo research, detects thin evidence,
plans under budget, and when reality hits — a buyer passes, the budget drops — works out what is invalidated, reuses what is still
valid, researches only the replacements it needs, and explains every change by its driver.

**Qloo's measurable contribution.** Film-specific market choices (identical plans without it), market-specific local comps for
pitching, every market claim traceable to Qloo requests, and refusal when evidence is absent.

**Limits.** Relative cultural overlap, not a forecast; 2018+ location data for films; no outcome validation yet.

**Path to product.** Validate with sales agents; backtest on released titles; add TV, festival and buyer data; sell per-title
reports to producers and seats to sales agents.
