# Territory — Product Spec

**One line:** cultural research and localization planning for an independent filmmaker: what Qloo associates with the
film's comps in each candidate country, which of those associations survive a claim check as candidates to verify, how to
localize the filmmaker's own priority markets under a fixed budget, and how that plan changes when constraints change, with
every claim labelled by source. It does not rank countries, predict success or recommend the best markets.

## User and decision
Indie filmmaker or small distributor before festival/market sales (AFM, EFM, Marché). Decision: which
3–6 territories to prioritise and which languages to subtitle vs dub with a fixed localization budget.

## Inputs
Title/working title, synopsis, genre, original language, 3–6 comps (+ optional year), candidate markets,
per-language subtitle/dub cost assumptions, constraints (budget, max markets, excluded markets/languages, subtitle-first).

## Modules
1. **Cultural Intelligence Atlas** — resolve comps (disambiguate), research each market with location-conditioned
   Qloo neighbourhoods; claim check per market (same-country genre controls, fixed-rule unrelated-film controls, cross-market check; survivors are candidates to verify; origin only when Qloo records it, format always unverified), thin-evidence fallback to Qloo-suggested substitute comps.
2. **Localization planner + War Room** — the filmmaker's candidates in priority order, fitted to budget and constraints (no Qloo input); constraint changes trigger impact analysis → selective research only when the candidate list runs out → deterministic re-plan → independent verification → plain-language diff.
3. **Evidence Lab** — every Qloo call (params, status, latency, cache hit), claim ledger with provenance, experiment results, Qloo vs LLM-only comparison.

## Claim provenance (every report sentence carries one)
`qloo` (cites call ids) · `external` (cited source) · `user` (input/assumption) · `hypothesis` (model assumption or guess) · `insufficient`.

## Non-goals / hard rules
No audience-size, box-office or revenue numbers. No Qloo-derived ranking or selection of countries (taste-portability score retired 2026-10-24). No raw cross-query affinity comparison. No raw Qloo data in the repo.
No copyrighted artwork. Mock data always labelled.

## Works today (2026-10-25)
Typed Qloo client with metered quota, deterministic agent state machine (no LLM), claim checker, planner + independent
validator, War Room replan with evidence reuse, provenance ledger, web UI, Markdown export, Netlify deployment.
**Not done:** validation with filmmakers or sales agents; real localization quotes; outcome validation of any kind.
