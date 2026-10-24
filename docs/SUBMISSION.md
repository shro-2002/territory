# Devpost submission draft

**Name:** Territory
**Tagline:** Qloo-grounded cultural research and localization planning for independent film — and a war room for when the plan breaks.

## Inspiration
Independent films commit sales and localization budgets on intuition and big-market box office. Mid-size titles have no data,
and plans change constantly: a buyer passes, a financier trims the localization line, a territory gets pre-sold.

## What it does
See README "What it does". For each country the filmmaker is considering, Territory shows what Qloo associates with the film's
comparable titles there, then runs a claim check: titles Qloo also returns there for four unrelated genres are the country's
general catalogue (56–93% in live data); the rest must also survive two unrelated-film controls and be absent from the other
researched markets' lists. Survivors are candidates to verify, never established local matches; origin comes only from Qloo's
record and release format is always unverified. Each market gets one decision and a next research action, with the Qloo
request ids behind it. Separately, a deterministic planner fits the
filmmaker's own market priorities to the localization budget. When a market falls through or the budget is cut, it re-plans,
re-verifies and explains each change as driven by priority, cost or constraint.

## How we built it
Next.js 16 / TypeScript; server-side typed Qloo client (GET only, timeouts, 429 back-off, concurrency 4, call budgets, private
slimmed cache, Redis quota isolation); bounded deterministic agent state machine (validation → resolution → planning →
investigation → verification → plan → constraint check → report; and impact analysis → selective research → revision →
re-verification); a claim checker (same-country genre controls, fixed-rule unrelated-film controls, cross-market check); exhaustive constrained optimizer with an independent
validator; HMAC-sealed stateless sessions; NDJSON streaming; d3-geo atlas; three.js globe. 112 unit/integration tests,
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
scrambles every Qloo field and requires the same plan); a claim checker that rejects most of what a genre-only filter called
distinctive (Japan 31 → 4 candidates, Germany 33 → 1 format-unverified listing) with request-level provenance; a War Room that
conditions its tool use on what changed.

## What we learned / limits
Four genre and two unrelated-film controls, one day of data, no outcome validation. A candidate only survived those controls;
that is not proof it is specific to the film, and "no local comparable established" is not proof none exists. Origin is
unknown for results cached before Territory kept Qloo's release-country field, and Qloo records no release format (a concert
premiere appears as a movie), so every candidate needs human review.

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
a claim check (genre, unrelated-film and cross-market controls); detects thin evidence; plans localization under budget from the filmmaker's priorities; and when reality hits,
works out what is invalidated, reuses what is still valid, researches only when the candidate list runs out, and explains every
change.

**Qloo's measurable contribution.** The cultural research layer: associations per country, the share that is general catalogue,
candidates that survive every control (to verify, not proven), recorded origin, every decision traceable to Qloo requests, and refusal when evidence is
absent. Qloo does **not** choose markets — we tested that it can't.

**Limits.** Associations are not demand; six controls; origin often unrecorded and format never recorded; 2018+ location data for films; no outcome validation yet.

**Path to product.** Validate with sales agents; add better controls and TV/festival/buyer data; sell per-title research reports
to producers and seats to sales agents.

---

# 90-second demo video plan (screen recording; captions on screen)

| Time | Screen | Caption |
|---|---|---|
| 0–8 s | Landing; film card; globe | "An unreleased indie film. Nine countries on the filmmaker's list. What does Qloo say about each?" |
| 8–18 s | Click **Reveal the strategy**; trace streams | "Territory reads each country in Qloo's taste graph, then checks its own claims" |
| 18–36 s | Atlas → **Japan**: funnel 100 → 31 → 14 → 4; *The Asadas* under "failed the stronger check"; 4 candidates, origin not recorded | "A genre-only filter said 31 leads. Unrelated films and other markets cut it to 4 — candidates to verify, not local matches" |
| 36–44 s | Atlas → **Germany**: one survivor, a concert premiere, format-unverified | "Qloo can't tell a film from an event screening. Territory says so and asks a human" |
| 44–52 s | Plan cards, budget meter, ✓ independent check | "The budget follows your priorities, not a cultural score" |
| 52–66 s | **Germany's distributor pulls out** → next candidate promoted, no new Qloo calls | "Next candidate on your list. No research needed, and it says why" |
| 66–76 s | **Budget cut 40%** → dub becomes subtitles | "Every change tagged: priority, cost or constraint" |
| 76–90 s | Export brief: Japan decision + Qloo request ids | "Every claim decision traced to the Qloo requests behind it" |
Record on the deployed URL; keep the evidence-source line visible (honesty).
