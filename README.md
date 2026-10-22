# Territory

AI distribution war room for independent films (Qloo Agentic Hackathon 2026). Work in progress.

```bash
npm install
npm test                       # 39 unit + agent tests (mock backend)
npm run experiments -- --mock  # E1–E6 harness on the labelled mock
npm run showcase -- --mock     # research -> plan -> remove market -> cut budget 40%
```

Set `QLOO_API_KEY` in `.env.local` (server-side only) to run against `https://hackathon.api.qloo.com`.
Raw Qloo responses are cached in `.private/` (gitignored) and never committed.

Docs: [spec](docs/PRODUCT_SPEC.md) · [API feasibility](docs/API_FEASIBILITY.md) · [architecture](docs/ARCHITECTURE.md) · [evaluation](docs/EVALUATION.md) · [judge demo](docs/JUDGE_DEMO.md) · [decisions](docs/DECISION_LOG.md)

License: MIT.
