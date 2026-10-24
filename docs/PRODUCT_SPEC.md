# Territory — Product Spec

**One line:** an AI distribution war room that tells an independent filmmaker which international markets
their unreleased film's taste-neighbours over-index in, how to localize under a fixed budget, and how the
plan changes when constraints change — with every claim labelled by source.

## User and decision
Indie filmmaker or small distributor before festival/market sales (AFM, EFM, Marché). Decision: which
3–6 territories to prioritise and which languages to subtitle vs dub with a fixed localization budget.

## Inputs
Title/working title, synopsis, genre, original language, 3–6 comps (+ optional year), candidate markets,
per-language subtitle/dub cost assumptions, constraints (budget, max markets, excluded markets/languages, subtitle-first).

## Modules
1. **Cultural Intelligence Atlas** — resolve comps (disambiguate), research each market with location-conditioned
   Qloo neighbourhoods; associations checked against same-country genre controls (catalogue vs distinctive, local origin only when Qloo records it), thin-evidence fallback to Qloo-suggested substitute comps.
2. **Localization planner + War Room** — the filmmaker's candidates in priority order, fitted to budget and constraints (no Qloo input); constraint changes trigger impact analysis → selective research only when the candidate list runs out → deterministic re-plan → independent verification → plain-language diff.
3. **Evidence Lab** — every Qloo call (params, status, latency, cache hit), claim ledger with provenance, experiment results, Qloo vs LLM-only comparison.

## Claim provenance (every report sentence carries one)
`qloo` (cites call ids) · `external` (cited source) · `user` (input/assumption) · `hypothesis` (model assumption or guess) · `insufficient`.

## Non-goals / hard rules
No audience-size, box-office or revenue numbers. No Qloo-derived ranking or selection of countries (taste-portability score retired 2026-10-24). No raw cross-query affinity comparison. No raw Qloo data in the repo.
No copyrighted artwork. Mock data always labelled.

## Works today (live-verified 2026-10-23)
Typed client, agent state machine, planner + independent validator, replan with reuse, claim ledger, experiment harness.
**Not yet:** UI, LLM narration, LLM-only baseline, deployment.
