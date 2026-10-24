# Territory — distribution war room for independent film

Territory helps an independent filmmaker or small distributor decide **where an unreleased film should be sold first and
how to localize it under a fixed budget** — then re-plans when a market falls through or the budget is cut, showing which
evidence still holds, what was invalidated, what new research was needed and why the decision changed.

Built for the Qloo Agentic Hackathon 2026. Cultural evidence comes from the Qloo Taste AI™ hackathon API.

**Live demo:** https://territory-qloo.netlify.app (no login) · **Source:** https://github.com/shro-2002/territory · **Judge walkthrough:** [docs/JUDGE_DEMO.md](docs/JUDGE_DEMO.md)

## What it does
1. **Brief** — title, synopsis, original language, 3–6 comparable titles, candidate markets, budget.
2. **Cultural investigation** — resolves comps in Qloo, builds the comps' taste neighbourhood, re-queries it conditioned on each
   market, and normalizes by four reference genres in that market ("taste portability"). Thin evidence triggers a fallback;
   insufficient markets are shown as such and never planned.
3. **Strategy** — a deterministic optimizer chooses markets and subtitle/dub per language under budget and market cap; an
   independent validator re-checks every plan.
4. **War Room** — remove a market, cut the budget, cap markets, require subtitles, exclude a language. The agent analyses the
   impact, reuses valid evidence, researches same-language or zero-cost reserves only when needed, re-plans, re-verifies, and
   tags every change as driven by **Qloo evidence**, **cost** or **your constraint**.
5. **Evidence Lab + export** — provenance-tagged claim ledger, every Qloo request (live vs cache), validation results, and a
   Markdown distribution research brief.

## What the numbers mean — and don't
Taste portability = share of the comps' 100 closest Qloo titles that remain in the top 100 when Qloo conditions on a market,
divided by the same share for reference genres there. It measures **relative cultural overlap**. It is **not** a box-office,
audience-size, revenue or demand forecast and has not been validated against release outcomes. Location-conditioned Qloo movie
data covers 2018+ releases. See [docs/EVALUATION.md](docs/EVALUATION.md).

## Evidence that Qloo is necessary
In a controlled ablation (same planner, costs, constraints, validator; only Qloo evidence removed) the Qloo-disabled condition
recommends the **same plan for every film**. With Qloo, plans and post-shock replacements depend on the film, every market claim
cites Qloo requests, and a brief with non-existent comps is declined rather than planned. An LLM-only baseline (local qwen3:14b)
produced valid-looking plans but wrong cost totals in 9/12 and a confident plan for fictional comps. Details and limits:
[docs/EVALUATION.md](docs/EVALUATION.md).

## Run locally
Requires Node 24+ (tested on 26.12.1).
```bash
npm install
cp .env.example .env.local      # add QLOO_API_KEY (server-side only); leave empty for labelled mock data
npm run dev                     # http://localhost:3000
```
Checks: `npm test` (87 unit/integration) · `npx tsx e2e/local-comps-check.mts` (cached real data, needs the private cache) · `npm run e2e` (Playwright, mock backend) · `npm run typecheck` · `npm run lint` · `npm run build`.
Local runs ignore any Upstash credentials unless `TERRITORY_REDIS_NAMESPACE` names an isolated keyspace, so tests and dev servers can never spend a deployment's shared quota (see `docs/DEPLOY.md`).
Experiments (need a key): `npm run experiments` (E1–E5) · `npm run year-window` · `npm run ablation` · `npm run audit-scoring` ·
`npm run e6` (also needs local Ollama with `qwen3:14b`).

## Data handling
The Qloo key never leaves the server. Raw Qloo responses are never committed: the private cache lives in `.private/`
(gitignored) and stores only the fields Territory reads. `docs/experiments/*.json` contain aggregates only.

## Architecture & docs
[Product spec](docs/PRODUCT_SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [API feasibility](docs/API_FEASIBILITY.md) ·
[Evaluation](docs/EVALUATION.md) · [Decision log](docs/DECISION_LOG.md) · [Deploy](docs/DEPLOY.md) · [Usability test](docs/USABILITY_TEST.md)

## License
MIT — see [LICENSE](LICENSE).
