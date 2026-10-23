# Judge Demo (~90 s)

Everything below was exercised in a browser against the live Qloo hackathon API on 2026-10-23.

1. **0–10 s · Landing.** Headline states the question; a preloaded unreleased film (*The Year of Small Rooms*, 4 comps,
   9 candidate markets, $80k budget) and a dimmed world atlas. Badge shows **Live Qloo API** or **Mock data**.
2. **10–50 s · Run live research.** The agent trace streams: comps resolved (one flagged ambiguous), research plan,
   then one line per market as its Qloo research finishes; the atlas pulses the markets still pending.
   Cold cache ≈ 40 s / ~100 Qloo calls; warm cache ≈ 2–3 s.
3. **50–60 s · Atlas + evidence.** Markets coloured by taste-portability lift. Click any market: overlap of the comps'
   neighbourhood, lift vs four reference genres, market-specific nearby titles from Qloo, provenance-tagged claims.
4. **60–80 s · War Room.** In the release plan, press **Remove** on a dubbed market (e.g. Germany) →
   impact analysis, reuse of all prior research (no new calls), reserve markets researched live, new plan,
   independent constraint check, side-by-side v1 → v2 with reasons. Then **Cut budget 40%** → dubs become subtitles,
   no new Qloo calls.
5. **80–90 s · Evidence Lab + export.** Claim ledger filterable by provenance; every Qloo call (status, latency,
   cache); validation tab with live E1–E6 aggregates. **Export briefing (.md)** downloads the distributor brief.

Failure states: invalid brief → inline error; unresolvable comps → failed session with reason; Qloo outage →
"research unavailable" with no fabricated plan; rate limit → 429 with retry time; quota guard → 503 message.
Not yet: a persistent cached showcase for fresh serverless instances (the cache is per instance).
