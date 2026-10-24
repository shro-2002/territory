# Decision Log

| Date | Decision | Why |
|---|---|---|
| 2026-10-23 | Build in `territory/` (Next.js 16, TS, Tailwind, Vitest, zod) | No prior code; matches preferred stack, free Vercel deploy |
| 2026-10-23 | Never compare raw affinity across queries; use comps + fixed reference panel in one query per market | Affinity normalized per query; percentile vs panel is scale-invariant (tested) |
| 2026-10-23 | Treat `signal.location` on movie type as unverified | Entity-type guide omits it; location use case shows it; invalid params silently ignored |
| 2026-10-23 | Deterministic planner (exhaustive ≤14 candidates) + separate validator | Arithmetic and constraints must not depend on an LLM |
| 2026-10-23 | Research policy deterministic for now; LLM only narrates ledger claims | Avoid claiming LLM autonomy that isn't there; keeps runs reproducible |
| 2026-10-23 | No audience/demand numbers anywhere | Qloo affinity is relative taste, not demand |
| 2026-10-23 | Negative-control mock (`--mock-ignore-location`) | Proves E2/E3 can fail, so a live pass means something |
| 2026-10-23 | Subtitle reach = 0.7 × dub, shown as `hypothesis` | Needed for trade-offs; not empirical |
| 2026-10-23 | **Abandon fixed anchor panel**; adopt taste portability (set overlap of comps' neighbourhood with/without location, normalized by reference genre sets in the same market) | Live: `filter.results.entities`+location returns only in-pool titles; set overlap is scale-free |
| 2026-10-23 | Restrict all neighbourhoods to `filter.release_year.min=2018` | Live: location-conditioned results contain only 2018+ titles; old comp sets overlapped 0 |
| 2026-10-23 | Drop blockbusters from baselines | Overlap 0 in every market; no information |
| 2026-10-23 | Schema fields nullish; trust observed error codes over docs | Live `popularity`/`tags` null; 400 not 403 for bad type; unknown locality returns 200 |
| 2026-10-23 | GO on country-level Territory | E1–E5 pass live; E3 Spearman 0.07 across genres shows the signal is not a country constant |
| 2026-10-23 | E6 baseline = local qwen3:14b (Ollama), no tools | No cloud LLM key; free, reproducible, offline; scored by the same validator |
| 2026-10-23 | No LLM in the deployed product; narration comes from the claim ledger | No free hosted LLM key; ledger text is already provenance-tagged |
| 2026-10-23 | Sessions HMAC-sealed, stateless API | Serverless without a DB; replans only run on server-produced evidence |
| 2026-10-23 | Cache stores slimmed bodies only (586 MB → 5 MB) | Data minimisation; deployable private seed |
| 2026-10-23 | Treat 2018+ as a hard API limit for movies | Explicit ≤2017 + location → 0 results; TV unaffected |
| 2026-10-24 | **Retire taste portability; stop ranking countries with Qloo.** Planner uses the filmmaker's priority order, costs and constraints only; Qloo evidence becomes catalogue-vs-distinctive associations under four genre controls | Cached audit: 42–80% of the score's overlap was country catalogue; ranking reordered once catalogue removed (Spearman −0.08–0.66); Spanish film scored <1× in Spain and Mexico |
| 2026-10-25 | **Cultural claim checker**: per market, titles near the comps must also pass two unrelated-film controls and be absent from the other researched markets' top-100 lists before Territory names them as candidates to verify; one decision per market (verify / no comparable established / insufficient evidence) with the Qloo call ids behind it | Cached audit: 13–17 titles per market that passed the four genre controls are returned for unrelated films too (e.g. *The Asadas*, *Corsage*); genre-only "distinctive" overclaimed |
| 2026-10-25 | Film controls = first 2 of a fixed list (crime-thriller, spanish-coming-of-age, arthouse-drama) that share no resolved comp with the brief; no threshold, no result-dependent choice | Deterministic and stated before results; known limit: a brief in a control's genre gets a stricter test (more "generic", never fewer) |
| 2026-10-25 | Release format always "unverified"; origin only from Qloo `release_country`, else unknown | Qloo's movie subtype also covers event screenings (e.g. a concert premiere) and records no format; nothing inferred from titles or language |
| 2026-10-25 | Claim-check cost: +4 calls per market (2 film controls × 2 pages) + ≤12 one-off title lookups. Uncached 9-market brief ≈ 170 calls (was ≈ 120); per-request reservation stays 220, so the daily 5,000 cap is unchanged and overflow degrades to "insufficient evidence" | Showcase re-run fully from cache: 164 calls, 0 network |
