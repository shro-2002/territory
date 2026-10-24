# Judge Demo (~90 s)

Exercised on a cached real-data build on 2026-10-25; the showcase answers from cached live Qloo responses.

1. **0–10 s · Landing.** Headline states the question; a preloaded unreleased film (*The Year of Small Rooms*, 4 comps,
   9 candidate markets, $80k budget) and a dimmed world atlas. Badge shows **Live Qloo API** or **Mock data**.
2. **10–50 s · Run live research.** The agent trace streams: comps resolved (one flagged ambiguous), research plan,
   then one line per market as its Qloo research finishes; the atlas pulses the markets still pending.
   Cold cache ≈ 40 s / ~164 Qloo calls; warm cache ≈ 2–3 s.
3. **50–60 s · Atlas + evidence.** Researched markets share one colour; nothing ranks them. Click a country: how many of the
   associated titles are its general catalogue, then the claim check: how many survive four genre controls, two unrelated-film
   controls and the cross-market check (Japan 100 → 31 → 14 → 4), the candidates to verify (origin and format unverified),
   the titles a genre-only filter would have passed but the checker rejects, the next research action, and the Qloo request
   ids behind the decision.
4. **60–80 s · War Room.** Press **Germany's distributor pulls out** → impact analysis, reuse of all prior research, the next
   candidate on the filmmaker's list promoted with no new Qloo calls (reserves are researched only when the list runs out),
   independent constraint check, side-by-side v1 → v2 with reasons tagged priority, cost or constraint. Then **Cut budget 40%**
   → dubs become subtitles, no new Qloo calls.
5. **80–90 s · Evidence Lab + export.** Claim ledger filterable by provenance; every Qloo call (status, latency,
   cache); validation tab with the retired-metric note and live E1–E6 aggregates. **Export briefing (.md)** downloads the distributor brief.

Failure states: invalid brief → inline error; unresolvable comps → failed session with reason; Qloo outage →
"research unavailable" with no fabricated plan; rate limit → 429 with retry time; quota guard → 503 message.
The showcase is served from a shared Redis cache and a deployed seed, so fresh instances answer it without new Qloo calls. A custom brief costs ~170 live calls against a 5,000/day shared quota.
