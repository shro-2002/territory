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
