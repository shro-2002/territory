# Devpost submission draft

**Name:** Territory
**Tagline:** Qloo-grounded cultural research and localization planning for independent film — and a war room for when the plan breaks.

## Inspiration
Independent films commit sales and localization budgets on intuition and big-market box office. Mid-size titles have no data,
and plans change constantly: a buyer passes, a financier trims the localization line, a territory gets pre-sold.

## What it does
See README "What it does". For each country the filmmaker is considering, Territory shows what Qloo associates with the film's
comparable titles there. It separates the country's general catalogue (titles Qloo also returns there for four unrelated
genres, 56–93% in live data) from associations distinctive under those controls, and flags local production origin only when
Qloo records it. Then it turns that evidence into questions to investigate. Separately, a deterministic planner fits the
filmmaker's own market priorities to the localization budget. When a market falls through or the budget is cut, it re-plans,
re-verifies and explains each change as driven by priority, cost or constraint.

## How we built it
Next.js 16 / TypeScript; server-side typed Qloo client (GET only, timeouts, 429 back-off, concurrency 4, call budgets, private
slimmed cache, Redis quota isolation); bounded deterministic agent state machine (validation → resolution → planning →
investigation → verification → plan → constraint check → report; and impact analysis → selective research → revision →
re-verification); same-country genre controls for every association; exhaustive constrained optimizer with an independent
validator; HMAC-sealed stateless sessions; NDJSON streaming; d3-geo atlas; three.js globe. 94 unit/integration tests,
Playwright journey test, CI.

## Qloo usage
`/search` (comp and reference resolution), `/v2/insights` with `filter.type=urn:entity:movie`, `signal.interests.entities`,
`signal.location.query`, `filter.release_year.min`, `take`, `page`; `release_country` for origin. Findings we reported honestly:
location-conditioned movie data is 2018+ only; `filter.results.entities` with a location filters rather than scores; most
location-conditioned results are the country's general catalogue whatever the seed.

## Challenges
Affinity is normalized per query, so raw scores are not comparable across countries. Our first anchor-panel design failed live.
Our second, a "taste portability" ranking, failed our own audit: 42–80% of what it measured was the country's catalogue, and a
Spanish-language film scored below a typical genre in Spain and Mexico. We retired it and stopped ranking countries by Qloo.

## Accomplishments
An honest audit that killed our own headline metric; a planner provably independent of unvalidated cultural scores (a test
scrambles every Qloo field and requires the same plan); catalogue-vs-distinctive evidence with exact counts; a War Room that
conditions its tool use on what changed.

## What we learned / limits
Only four genre controls, one day of data, no outcome validation. "Distinctive" means only "not returned for those four genres".
Origin is unverified for results cached before Territory kept Qloo's release-country field.

## What's next
More and better-matched controls; TV and music associations (each needs its own controls); usability sessions with sales agents;
real localization quotes; festival and buyer data.

---

# Finalist pitch (≈90 s)

**Problem & buyer.** Independent producers and boutique sales agents decide which territories to pitch and which languages to dub
with no data for mid-size titles — and the plan breaks every week. Buyer: indie sales agents, small distributors, producers
preparing AFM/EFM/Marché.

**Why a generic LLM can't do it.** An LLM can repeat regional stereotypes; it cannot tell you which titles are associated with
*these comps* in Germany, or which of those are just Germany's catalogue. In our test it named local comparables for films that do
not exist and got cost totals wrong 9 times in 12.

**What the agent does.** Resolves comps; researches each candidate country in Qloo and qualifies every association against
four genre controls; detects thin evidence; plans localization under budget from the filmmaker's priorities; and when reality hits,
works out what is invalidated, reuses what is still valid, researches only when the candidate list runs out, and explains every
change.

**Qloo's measurable contribution.** The cultural research layer: associations per country, the share that is general catalogue,
distinctive candidates under controls, recorded origin, every claim traceable to Qloo requests, and refusal when evidence is
absent. Qloo does **not** choose markets — we tested that it can't.

**Limits.** Associations are not demand; four controls; 2018+ location data for films; no outcome validation yet.

**Path to product.** Validate with sales agents; add better controls and TV/festival/buyer data; sell per-title research reports
to producers and seats to sales agents.

---

# 90-second demo video plan (screen recording; captions on screen)

| Time | Screen | Caption |
|---|---|---|
| 0–8 s | Landing; film card; globe | "An unreleased indie film. Nine countries on the filmmaker's list. What does Qloo say about each?" |
| 8–20 s | Click **Reveal the strategy**; trace streams | "Territory researches each country in Qloo's taste graph, with four genre controls" |
| 20–34 s | Click Germany on the atlas: catalogue count, distinctive titles, origin line | "67 of 100 associations are Germany's general catalogue. Territory says so" |
| 34–42 s | Plan cards: "Your #1 candidate…", budget meter, ✓ independent check | "The budget follows your priorities, not a cultural score" |
| 42–58 s | **Germany's distributor pulls out** → Mexico promoted, no new Qloo calls | "Next candidate on your list. No research needed, and it says why" |
| 58–70 s | **Budget cut 40%** → dub becomes subtitles | "Every change tagged: priority, cost or constraint" |
| 70–82 s | Strategy panel: questions to investigate; Evidence Lab retired-metric note | "What to check next, and the metric we retired after auditing it" |
| 82–90 s | Export brief | "A research brief you can send, with every claim traced to Qloo" |
Record on the deployed URL; keep the evidence-source line visible (honesty).
