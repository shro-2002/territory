# Devpost submission

**Name:** Territory
**Tagline:** Cultural research and localization planning for independent film, with every claim traced to its source.
**Demo:** https://territory-qloo.netlify.app (no login) · **Code:** https://github.com/shro-2002/territory (MIT)

## What it does
An independent filmmaker enters an unreleased film, 3–6 comparable titles, the countries they are considering (in priority
order) and a localization budget. Territory:

1. **Researches each country in Qloo.** It resolves the comps and asks Qloo which films are associated with them in each
   country (`signal.location.query`).
2. **Checks its own claims.** Most of those associations are the country's general catalogue: 56–81% of each list in the
   showcase also comes back for four unrelated genres there. The rest must also survive two unrelated-film controls and
   be absent from the other researched countries' lists. Each country gets one decision: *candidates to verify*, *no local
   comparable established*, or *insufficient evidence*, with the Qloo request ids behind it. Survivors are leads for a human
   to check, never established matches: Qloo's production origin is shown only when recorded, and release format is always
   unverified (one German survivor is a concert screening, and Territory says so).
3. **Plans localization from the filmmaker's own priorities.** A deterministic planner fits the filmmaker's priority list to
   the budget and market cap, choosing subtitles or dubbing per language, and an independent validator re-checks every plan.
   Qloo evidence does not enter the planner.
4. **Re-plans when something breaks (War Room).** Remove a country, cut the budget or require subtitles. Territory works out
   which decisions are invalidated, reuses the evidence that still holds, researches only when the candidate list runs out,
   and tags every change as driven by priority, cost or constraint.
5. **Exports a research brief** (Markdown) with the claim ledger, open questions and Qloo request ids.

## What Territory does not do
It does not predict box office, demand or market success, does not rank countries or say which markets are best, and has not
been shown to give better commercial outcomes than an experienced sales agent or ordinary desk research. Without Qloo, the
plan, budget and War Room are identical; Qloo contributes the research layer only. Localization costs are illustrative
inputs. No filmmaker or sales agent has tested it yet.

## How we built it
Next.js 16 / TypeScript on Netlify. Server-side Qloo client: GET only, timeouts, 429 back-off, concurrency 4, every HTTP
attempt metered against a per-request reservation and a shared daily quota in Upstash Redis, private slimmed cache.
Deterministic agent state machine (no LLM): validation → resolution → research → evidence verification with thin-evidence
fallback → plan → constraint check → report; and impact analysis → selective research → revision → re-verification.
Request-level provenance on every claim. HMAC-sealed public session; AES-256-GCM-encrypted research context. 115
unit/integration tests, a Playwright journey test and CI.

## Qloo usage
`/search` to resolve comps and controls; `/v2/insights` with `filter.type=urn:entity:movie`, `signal.interests.entities`,
`signal.location.query`, `filter.release_year.min`, `take` and `page`. About 170 requests for a fresh 9-country brief; the
showcase is answered from cached live responses.

## What we learned
- Affinity is normalised per query, so raw scores cannot be compared across countries; our first design failed live.
- Location-conditioned movie results on the hackathon key contained only 2018+ releases (TV was not limited).
- Most location-conditioned results are the country's general catalogue whatever the seed. Our second design, a
  "taste portability" ranking of countries, mostly measured that catalogue (42–80% of its overlap), and a Spanish-language
  film scored below a typical genre in Spain and Mexico. We retired it and stopped ranking countries with Qloo.
- The claim checker's counts are sensitive to its settings: top-50 instead of top-100, a different control set or a
  different list of researched countries moved Japan from 4 candidates to anywhere between 0 and 11. So we present
  survivors as leads, not findings.

## Accomplishments
A working, deployed tool whose every Qloo-backed sentence cites the requests behind it; a planner provably independent of
unvalidated cultural scores (a test scrambles every Qloo-derived field and requires the same plan); honest refusals when
evidence is missing; and a War Room that only spends Qloo quota when a revision actually needs new research.

## Limits and next steps
Six controls, one candidate brief tested in depth, no outcome or user validation. Next would be sessions with sales agents,
real localization quotes, and controls that are independent of the brief.
