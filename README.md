# Territory — cultural research and localization planning for independent film

Territory helps an independent filmmaker or small distributor **research the countries they are considering for an unreleased
film and plan localization under a fixed budget**. Qloo shows what is culturally associated with the film's comparable titles
in each country, and Territory's claim checker separates the country's general catalogue from the few titles that survive its controls, as candidates for a human to verify. A
deterministic planner fits the filmmaker's own market priorities to the budget, and re-plans when a market falls through or
the budget is cut.

Built for the Qloo Agentic Hackathon 2026. Cultural evidence comes from the Qloo Taste AI™ hackathon API.

**Live demo:** https://territory-qloo.netlify.app (no login) · **Source:** https://github.com/shro-2002/territory · **Judge walkthrough:** [docs/JUDGE_DEMO.md](docs/JUDGE_DEMO.md)

## What it does
1. **Brief** — title, synopsis, original language, 3–6 comparable titles, candidate markets **in your priority order**, budget.
2. **Cultural investigation** — resolves comps in Qloo, then for each candidate country asks which titles Qloo associates with
   the comps there, then runs a **claim check**: titles Qloo also returns there for four unrelated genres are the country's
   **general catalogue**; the rest must also survive two unrelated-film controls and be absent from the other researched
   markets' top-100 lists. Survivors are **candidates to verify**, never established local matches; production origin comes
   only from Qloo's record (otherwise "unknown") and release format is always unverified. Each market gets one decision —
   candidates to verify, no local comparable established, or insufficient evidence — with its Qloo request ids. Thin evidence
   triggers a fallback; gaps are shown as missing evidence, not as rejections.
3. **Localization plan** — a deterministic optimizer takes your candidates in priority order and chooses subtitle or dub per
   language under budget and market cap; an independent validator re-checks every plan. **Qloo evidence never enters the
   optimizer.**
4. **War Room** — remove a market, cut the budget, cap markets, require subtitles, exclude a language. The agent analyses the
   impact, reuses valid evidence, promotes the next candidate on your list, researches suggested reserves only when your list
   runs out, re-plans, re-verifies, and tags every change as driven by **your priority**, **cost** or **your constraint**.
5. **Evidence Lab + export** — provenance-tagged claim ledger, every Qloo request (live vs cache), questions to investigate next,
   and a Markdown research brief.

## What the evidence means — and doesn't
Qloo associations are titles related to the comps in a country. Territory reports how many are general catalogue (56–93% in
live data) and names only the titles that survive every control as candidates for a human to check. Surviving the controls is
not proof a title is specific to the film, and "no local comparable established" is not proof none exists. They are **not**
audience preferences, demand, box-office or
buyer-interest evidence, and they do not choose markets. An earlier taste-portability score that ranked countries was
**retired** after a cached-data audit showed it mostly measured each country's catalogue (see
[docs/EVALUATION.md](docs/EVALUATION.md#catalogue-audit-npm-run-audit-catalogue-cached-data-0-new-calls-2026-10-24)).
Location-conditioned Qloo movie data covers 2018+ releases.

## What depends on Qloo
Market selection does **not**: `tests/retired-score.test.ts` scrambles every Qloo-derived field and requires an identical plan.
The cultural research does: which titles are associated with your comps in each country, which of them are catalogue, which
survive the genre, unrelated-film and cross-market controls, and which have a recorded origin. In the cached showcase the
checker cuts Japan's 31 genre-only "distinctive" titles to 4 candidates and Germany's 33 to 1 listing (a concert screening,
flagged format-unverified). These counts depend on the settings: in a cached sensitivity check, top-50 instead of top-100,
a different control set, or a different list of researched markets changed Japan's count from 4 to anywhere between 0 and 11
([docs/EVALUATION.md](docs/EVALUATION.md#claim-checker-sensitivity-cached-data-0-new-calls-2026-10-25)). Treat candidates as leads, not findings.

**Without Qloo,** the plan, budget, War Room and change reasons are identical; only the research layer disappears. Territory
does not predict market success, identify the best markets, or claim better commercial outcomes, and it has not been
validated with filmmakers or sales agents. In a small earlier test, a local 14B model with no tools invented local
comparables for fictional comps, where Territory declined; that is not a comparison with a frontier model or desk research.

## Run locally
Requires Node 24+ (tested on 26.12.1).
```bash
npm install
cp .env.example .env.local      # add QLOO_API_KEY (server-side only); leave empty for labelled mock data
npm run dev                     # http://localhost:3000
```
Checks: `npm test` (115 unit/integration) · `npx tsx e2e/local-comps-check.mts` (cached real data, needs the private cache) · `npm run e2e` (Playwright, mock backend) · `npm run typecheck` · `npm run lint` · `npm run build`.
Local runs ignore any Upstash credentials unless `TERRITORY_REDIS_NAMESPACE` names an isolated keyspace, so tests and dev servers can never spend a deployment's shared quota (see `docs/DEPLOY.md`).
Experiments (need a key): `npm run experiments` (E1–E5, retired metric) · `npm run year-window` · `npm run audit-catalogue` (cache only) ·
`npm run e6` (also needs local Ollama with `qwen3:14b`).

## Data handling
The Qloo key never leaves the server. Raw Qloo responses are never committed: the private cache lives in `.private/`
(gitignored) and stores only the fields Territory reads. `docs/experiments/*.json` contain aggregates only.

## Architecture & docs
[Product spec](docs/PRODUCT_SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [API feasibility](docs/API_FEASIBILITY.md) ·
[Evaluation](docs/EVALUATION.md) · [Decision log](docs/DECISION_LOG.md) · [Deploy](docs/DEPLOY.md) · [Usability test](docs/USABILITY_TEST.md)

## License
MIT — see [LICENSE](LICENSE).
