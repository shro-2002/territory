"use client";

import { useState } from "react";

import type { Session } from "@/lib/agent/agent";
import type { Provenance } from "@/lib/agent/claims";
import type { CallRecord } from "@/lib/qloo/types";
import { ProvenanceTag } from "./ProvenanceTag";

export type ExperimentSummary = {
  experiments: Array<{ id: string; verdict: string; hypothesis: string }> | null;
  e6: E6Summary | null;
  yearWindow: Record<string, { n?: number; min?: number | null; pre2018?: number; error?: string }> | null;
};

export type E6Summary = {
  model: string;
  finishedAt: string;
  rows: Array<{ scenario: string; territory: Record<string, string | number | boolean>; llm: Record<string, string | number | boolean> }>;
  differentiation: { territory: Record<string, number>; llmOnly: Record<string, number> };
};

type Props = {
  session: Session | null;
  calls: CallRecord[];
  summary: ExperimentSummary;
};

const TABS = ["Claim ledger", "Qloo calls", "Validation"] as const;
const ORDER: Provenance[] = ["qloo", "user", "hypothesis", "insufficient", "external"];

export function EvidenceLab({ session, calls, summary }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(session ? "Claim ledger" : "Validation");
  const [filter, setFilter] = useState<Provenance | "all">("all");
  const claims = session?.claims.filter((c) => filter === "all" || c.provenance === filter) ?? [];
  const network = calls.filter((c) => !c.cacheHit);

  return (
    <section className="panel p-5" aria-label="Evidence Lab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Evidence Lab</p>
          <h3 className="font-display text-2xl">What Qloo actually contributed</h3>
        </div>
        <div role="tablist" className="flex gap-1 rounded-xl border border-line p-1">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-xs ${tab === t ? "bg-ink-3 text-bone" : "text-bone-dim hover:text-bone"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "Claim ledger" && (
        <div className="mt-4">
          {!session ? (
            <p className="text-sm text-bone-dim">Run the research to build a claim ledger.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <button type="button" onClick={() => setFilter("all")} className={`rounded-full border px-2.5 py-1 ${filter === "all" ? "border-bone" : "border-line-2 text-bone-dim"}`}>All {session.claims.length}</button>
                {ORDER.map((p) => {
                  const n = session.claims.filter((c) => c.provenance === p).length;
                  return n ? (
                    <button key={p} type="button" onClick={() => setFilter(p)} className={`rounded-full ${filter === p ? "ring-1 ring-bone" : ""}`}>
                      <ProvenanceTag provenance={p} /> <span className="sr-only">{n}</span>
                      <span className="ml-1 text-bone-dim">{n}</span>
                    </button>
                  ) : null;
                })}
              </div>
              <ul className="max-h-[28rem] space-y-2 overflow-auto pr-2">
                {claims.map((c) => (
                  <li key={c.id} className="rounded-lg border border-line bg-ink/60 p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <ProvenanceTag provenance={c.provenance} />
                      {c.source === "mock" && <span className="font-mono text-[0.62rem] text-ember">MOCK DATA</span>}
                      {c.callIds.length > 0 && <span className="font-mono text-[0.62rem] text-bone-faint">{c.callIds.join(" ")}</span>}
                    </div>
                    {c.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "Qloo calls" && (
        <div className="mt-4">
          <p className="mb-3 text-xs text-bone-dim">
            {calls.length} calls this session · {network.length} reached the Qloo hackathon API · {calls.length - network.length} served from the private cache. GET only; the API key never leaves the server.
          </p>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-left font-mono text-[0.7rem]">
              <thead className="sticky top-0 bg-ink-2 text-bone-faint">
                <tr>
                  <th className="py-1 pr-2 font-normal">id</th>
                  <th className="py-1 pr-2 font-normal">request</th>
                  <th className="py-1 pr-2 font-normal">status</th>
                  <th className="py-1 pr-2 text-right font-normal">ms</th>
                  <th className="py-1 text-right font-normal">results</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="py-1 pr-2 text-bone-faint">{c.id}</td>
                    <td className="py-1 pr-2 text-bone-dim">{describeCall(c)}</td>
                    <td className={`py-1 pr-2 ${c.status === 200 ? "text-ok" : "text-ember"}`}>{c.cacheHit ? "cache" : String(c.status)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{c.cacheHit ? "" : c.latencyMs}</td>
                    <td className="py-1 text-right tabular-nums">{c.resultCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Validation" && <Validation summary={summary} />}
    </section>
  );
}

function describeCall(c: CallRecord): string {
  const p = c.params;
  const parts = [c.path];
  if (p["signal.location.query"]) parts.push(`location=${p["signal.location.query"]}`);
  if (p["signal.interests.entities"]) parts.push(`seeds=${String(p["signal.interests.entities"]).split(",").length}`);
  if (p.query) parts.push(`query="${p.query}"`);
  if (p.page) parts.push(`page=${p.page}`);
  return parts.join(" ");
}

function Validation({ summary }: { summary: ExperimentSummary }) {
  return (
    <div className="mt-4 space-y-5 text-sm">
      {summary.experiments && (
        <div>
          <p className="eyebrow mb-2">API feasibility experiments (live)</p>
          <ul className="space-y-1">
            {summary.experiments.map((e) => (
              <li key={e.id} className="grid grid-cols-[2.5rem_6.5rem_1fr] gap-2">
                <span className="font-mono text-bone-faint">{e.id}</span>
                <span className={e.verdict === "pass" ? "text-ok" : e.verdict === "not_run" || e.verdict.startsWith("run") ? "text-bone-faint" : "text-ember"}>{e.verdict}</span>
                <span className="text-bone-dim">{e.hypothesis}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.e6 ? (
        <div>
          <p className="eyebrow mb-2">E6 · Territory vs LLM-only ({summary.e6.model}, no tools) on identical briefs</p>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-bone-faint">
                <tr className="text-left">
                  <th className="py-1 pr-3 font-normal">Scenario</th>
                  <th className="py-1 pr-3 font-normal">Territory</th>
                  <th className="py-1 font-normal">LLM-only</th>
                </tr>
              </thead>
              <tbody>
                {summary.e6.rows.map((r) => (
                  <tr key={r.scenario} className="border-t border-line align-top">
                    <td className="py-2 pr-3 text-bone">{r.scenario}</td>
                    <td className="py-2 pr-3 text-bone-dim">{Object.entries(r.territory).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
                    <td className="py-2 text-bone-dim">{Object.entries(r.llm).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-bone-faint">Single run per prompt, temperature 0. Not a box-office or accuracy benchmark: it measures grounding, constraint correctness and scenario sensitivity. Full method in docs/EVALUATION.md.</p>
        </div>
      ) : (
        <p className="text-bone-faint">E6 results not yet available in this build.</p>
      )}
      {summary.yearWindow && (
        <div>
          <p className="eyebrow mb-2">Known limit · location-conditioned movie data</p>
          <p className="text-bone-dim">With a country or city location, Qloo returned no pre-2018 films in any variant tested (trend bias off, low location weight, explicit ≤2017 filter → 0 results). TV shows are not limited. Territory compares like with like by restricting every neighbourhood to 2018+.</p>
        </div>
      )}
    </div>
  );
}
