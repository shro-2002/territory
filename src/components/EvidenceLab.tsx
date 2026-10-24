"use client";

import { useState, type ReactNode } from "react";

import type { MarketResearch, Session } from "@/lib/agent/agent";
import type { Provenance } from "@/lib/agent/claims";
import type { CallRecord } from "@/lib/qloo/types";
import { NEIGHBOURHOOD_SIZE } from "@/lib/territory/market-signal";
import { marketByCode } from "@/lib/territory/markets";
import { ProvenanceTag } from "./ProvenanceTag";
import { TracePanel } from "./TracePanel";
import { SectionHead } from "./ui/SectionHead";
import type { TraceEvent } from "@/lib/agent/agent";

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
  trace: TraceEvent[];
  isRunning: boolean;
  startedAt: number | null;
  lastCalls: { live: number; cached: number } | null;
};

const TABS = ["Agent activity", "Qloo calls", "Validation"] as const;
const ORDER: Provenance[] = ["qloo", "user", "hypothesis", "insufficient", "external"];
const PROVENANCE_MEANING: Record<Provenance, string> = {
  qloo: "Backed by a recorded Qloo request",
  user: "Something you entered",
  hypothesis: "A modelling assumption, not a finding",
  insufficient: "We looked and there was not enough data",
  external: "From a non-Qloo source",
};

function localOriginCell(r: MarketResearch): string {
  if (r.evidenceGap) return `Gap: ${r.evidenceGap}`;
  if (r.nearby.localOrigin.length) return r.nearby.localOrigin.slice(0, 4).join(", ");
  return r.nearby.counts.originUnknown ? "None verified (origin not recorded)" : "None found under controls";
}

export function EvidenceLab({ session, calls, summary, trace, isRunning, startedAt, lastCalls }: Props) {
  return (
    <section aria-labelledby="evidence-title" className="mx-auto max-w-[1320px] px-4 pt-32 sm:px-8">
      <SectionHead id="evidence" eyebrow="Evidence Lab" title={<span id="evidence-title">What Qloo contributed, and how to check it.</span>}>
        Three levels of detail. Start with the plain-English account; open the next level only if you want to check our work.
      </SectionHead>
      <div className="space-y-4">
        <Level n={1} title="In plain English" open>{session ? <PlainEnglish session={session} lastCalls={lastCalls} /> : <p className="text-sm text-bone-dim">Run the research to see what Qloo contributed.</p>}</Level>
        <Level n={2} title="Evidence and comparable-title logic">{session ? <EvidenceDetail session={session} /> : <p className="text-sm text-bone-dim">Run the research first.</p>}</Level>
        <Level n={3} title="Technical audit trail"><AuditTrail calls={calls} summary={summary} trace={trace} isRunning={isRunning} startedAt={startedAt} lastCalls={lastCalls} /></Level>
      </div>
    </section>
  );
}

function Level({ n, title, open, children }: { n: number; title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="panel group p-6">
        <summary className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-4"><span className="text-sm text-accent">Level {n}</span><span className="display text-2xl sm:text-3xl">{title}</span></span>
          <span aria-hidden className="text-xl text-bone-dim transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-6 border-t border-line pt-6">{children}</div>
      </details>
  );
}

function PlainEnglish({ session, lastCalls }: { session: Session; lastCalls: { live: number; cached: number } | null }) {
  const comps = session.comps.map((c) => c.input.name).join(", ");
  const counts = ORDER.map((p) => [p, session.claims.filter((c) => c.provenance === p).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-4 text-[0.95rem] leading-relaxed text-bone-dim">
        <p>Qloo is a taste graph. Territory asks it one question about <span className="text-bone">{comps}</span>: which films do audiences who love these also love?</p>
        <p>It asks again inside each country, and again for four unrelated genres there. Titles that come back for those genres too are <span className="text-bone">the country&apos;s general catalogue</span>; the rest are distinctive associations worth investigating.</p>
        <p>Separately, the planner fits your candidate markets, in your priority order, to your budget with plain arithmetic. Qloo evidence never enters it, and nothing here predicts box office, audience size or demand{lastCalls ? `, and it made ${lastCalls.live + lastCalls.cached} Qloo requests to get here (${lastCalls.live} live).` : "."}</p>
      </div>
      <div>
        <p className="eyebrow mb-3">Where each claim comes from</p>
        <ul className="space-y-2">
          {counts.map(([p, n]) => (
            <li key={p} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-3"><ProvenanceTag provenance={p} /><span className="text-bone-dim">{PROVENANCE_MEANING[p]}</span></span><span className="tabular-nums text-bone">{n}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EvidenceDetail({ session }: { session: Session }) {
  const [filter, setFilter] = useState<Provenance | "all">("all");
  const rows = Object.values(session.research);
  const claims = session.claims.filter((c) => filter === "all" || c.provenance === filter);
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow mb-3">Your comparable titles, as Qloo resolved them</p>
        <ul className="flex flex-wrap gap-2">
          {session.comps.map((c) => <li key={c.input.name} className="rounded-full border border-line-2 px-3 py-1 text-xs text-bone-dim">{c.input.name} <span className={c.status === "resolved" ? "text-success" : "text-caution"}>· {c.status}</span></li>)}
        </ul>
      </div>
      <div className="overflow-x-auto">
        <p className="eyebrow mb-3">Market by market</p>
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs text-bone-faint"><tr><th className="pb-2 font-normal">Market</th><th className="pb-2 font-normal">Associated</th><th className="pb-2 font-normal">General catalogue</th><th className="pb-2 font-normal">Distinctive</th><th className="pb-2 font-normal">Distinctive local-origin titles</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t border-line align-top">
                <td className="py-2 pr-3">{marketByCode(r.code).name}</td>
                <td className="py-2 pr-3 tabular-nums">{r.titlesFound}</td>
                <td className="py-2 pr-3 tabular-nums text-bone-dim">{r.evidenceGap ? "—" : r.nearby.genericCount}</td>
                <td className="py-2 pr-3 tabular-nums text-bone-dim">{r.evidenceGap ? "—" : r.titlesFound - r.nearby.genericCount}</td>
                <td className="py-2 text-bone-dim">{localOriginCell(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="eyebrow mb-3">Claim ledger</p>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All {session.claims.length}</button>
          {ORDER.map((p) => {
            const n = session.claims.filter((c) => c.provenance === p).length;
            return n ? <button key={p} type="button" className="chip" aria-pressed={filter === p} onClick={() => setFilter(p)}>{p} {n}</button> : null;
          })}
        </div>
        <ul className="max-h-[26rem] space-y-2 overflow-auto pr-2">
          {claims.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-ink/60 p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <ProvenanceTag provenance={c.provenance} />
                {c.source === "mock" && <span className="font-mono text-[0.62rem] text-caution">MOCK DATA</span>}
                {c.callIds.length > 0 && <span className="font-mono text-[0.62rem] text-bone-faint">{c.callIds.join(" ")}</span>}
              </div>
              {c.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AuditTrail({ calls, summary, trace, isRunning, startedAt, lastCalls }: Omit<Props, "session">) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Agent activity");
  const network = calls.filter((c) => !c.cacheHit);
  return (
    <div>
      <div role="tablist" className="mb-5 flex w-fit gap-1 rounded-full border border-line p-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-xs ${tab === t ? "bg-accent/20 text-bone" : "text-bone-dim hover:text-bone"}`}>{t}</button>
        ))}
      </div>
      {tab === "Agent activity" && <TracePanel events={trace} isRunning={isRunning} startedAt={startedAt} lastCalls={lastCalls} />}
      {tab === "Qloo calls" && (
        <div>
          <p className="mb-3 text-xs text-bone-dim">{calls.length} calls this session · {network.length} reached the Qloo hackathon API · {calls.length - network.length} served from the private cache. GET only; the API key never leaves the server.</p>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-left font-mono text-[0.7rem]">
              <thead className="sticky top-0 bg-ink-2 text-bone-faint"><tr><th className="py-1 pr-2 font-normal">id</th><th className="py-1 pr-2 font-normal">request</th><th className="py-1 pr-2 font-normal">status</th><th className="py-1 pr-2 text-right font-normal">ms</th><th className="py-1 text-right font-normal">results</th></tr></thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="py-1 pr-2 text-bone-faint">{c.id}</td><td className="py-1 pr-2 text-bone-dim">{describeCall(c)}</td>
                    <td className={`py-1 pr-2 ${c.status === 200 ? "text-success" : "text-removed-ink"}`}>{c.cacheHit ? "cache" : String(c.status)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{c.cacheHit ? "" : c.latencyMs}</td><td className="py-1 text-right tabular-nums">{c.resultCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "Validation" && <Validation summary={summary} />}
    </div>
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
    <div className="space-y-6 text-sm">
      <div>
        <p className="eyebrow mb-2">Retired metric · taste portability</p>
        <p className="leading-relaxed text-bone-dim">Territory used to rank markets by how much of the comps&apos; {NEIGHBOURHOOD_SIZE}-title Qloo neighbourhood survived in each country, relative to four reference genres. An audit on cached data found 42–80% of that overlap was the country&apos;s general catalogue, the ranking reordered once catalogue titles were removed, and a Spanish-language film scored below a typical genre in Spain and Mexico. The score no longer exists in the product; the experiments below are kept as the record of that test. Method: docs/EVALUATION.md.</p>
      </div>
      {summary.experiments && (
        <div>
          <p className="eyebrow mb-2">API feasibility experiments (live; E2–E5 tested the retired metric)</p>
          <ul className="space-y-1">
            {summary.experiments.map((e) => (
              <li key={e.id} className="grid gap-2 sm:grid-cols-[2.5rem_6.5rem_1fr]">
                <span className="font-mono text-bone-faint">{e.id}</span>
                <span className={e.verdict === "pass" ? "text-success" : e.verdict === "not_run" || e.verdict.startsWith("run") ? "text-bone-faint" : "text-removed-ink"}>{e.verdict}</span>
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
              <thead className="text-bone-faint"><tr className="text-left"><th className="py-1 pr-3 font-normal">Scenario</th><th className="py-1 pr-3 font-normal">Territory</th><th className="py-1 font-normal">LLM-only</th></tr></thead>
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
      ) : <p className="text-bone-faint">E6 results not yet available in this build.</p>}
      {summary.yearWindow && (
        <div>
          <p className="eyebrow mb-2">Known limit · location-conditioned movie data</p>
          <p className="text-bone-dim">With a country or city location, Qloo returned no pre-2018 films in any variant tested (trend bias off, low location weight, explicit ≤2017 filter → 0 results). TV shows are not limited. Territory compares like with like by restricting every neighbourhood to 2018+.</p>
        </div>
      )}
    </div>
  );
}
