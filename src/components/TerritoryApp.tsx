"use client";

import { useRef, useState } from "react";

import type { AgentInput, Session, TraceEvent } from "@/lib/agent/agent";
import { briefMarkdown } from "@/lib/client/brief";
import { streamAgent } from "@/lib/client/stream";
import type { CallRecord } from "@/lib/qloo/types";
import { marketByCode } from "@/lib/territory/markets";
import type { Constraints } from "@/lib/territory/planner";
import { Atlas } from "./Atlas";
import { BriefForm } from "./BriefForm";
import { EvidenceLab, ExperimentSummary } from "./EvidenceLab";
import { MarketPanel } from "./MarketPanel";
import { TracePanel } from "./TracePanel";
import { WarRoom } from "./WarRoom";

type Version = { session: Session; token: string; label: string };
type Props = { initialInput: AgentInput; summary: ExperimentSummary; source: "live" | "mock" };

export function TerritoryApp({ initialInput, summary, source }: Props) {
  const [input, setInput] = useState(initialInput);
  const [isEditing, setIsEditing] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const current = versions.at(-1) ?? null;
  const previous = versions.length > 1 ? versions[versions.length - 2] : null;
  const session = current?.session ?? null;
  const doneMarkets = new Set(trace.filter((e) => e.kind === "progress" && e.market).map((e) => e.market!));
  const pending = busy ? (busy === "run" ? input.targetMarkets : []).filter((c) => !doneMarkets.has(c)) : [];

  async function execute(body: unknown, label: string, mode: string, reset: boolean) {
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(mode);
    setError(null);
    setTrace([]);
    setStartedAt(Date.now());
    if (reset) {
      setVersions([]);
      setCalls([]);
      setSelected(null);
    }
    try {
      await streamAgent(body, (m) => {
        if (m.type === "trace") setTrace((t) => [...t, m.event]);
        else if (m.type === "error") setError(m.message);
        else {
          setVersions((v) => [...v, { session: m.session, token: m.token, label }]);
          setCalls((c) => [...c, ...m.calls]);
          setSelected((s) => s ?? m.session.plan.markets[0]?.code ?? null);
        }
      }, abort.current.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError("Connection lost while the agent was working. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const run = (brief: AgentInput) => {
    setInput(brief);
    setIsEditing(false);
    void execute({ action: "run", input: brief }, "Initial research", "run", true);
  };
  const replan = (patch: Partial<Constraints>, label: string) => {
    if (!current) return;
    void execute({ action: "replan", session: current.session, token: current.token, patch }, label, "replan", false);
  };
  const exportBrief = () => {
    if (!session) return;
    const blob = new Blob([briefMarkdown(session, source)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `territory-${session.input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-v${session.version}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="relative z-10 mx-auto max-w-[1400px] px-4 pb-24 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <div className="flex items-baseline gap-4">
          <span className="font-display text-2xl tracking-tight">Territory</span>
          <span className="hidden text-xs text-bone-faint sm:inline">distribution war room for independent film</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full border px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-wider ${source === "live" ? "border-ok/50 text-ok" : "border-ember/60 text-ember"}`}>
            {source === "live" ? "Live Qloo API" : "Mock data — not Qloo evidence"}
          </span>
          {session && <button type="button" className="btn" onClick={exportBrief}>Export briefing (.md)</button>}
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-5">
          {!session && !busy && (
            <div className="rise">
              <h1 className="font-display text-3xl leading-[1.08] sm:text-[2.6rem]">Where will an unreleased film travel — and what happens when the plan breaks?</h1>
              <p className="mt-3 max-w-xl text-sm text-bone-dim">Territory researches each market with Qloo&apos;s taste graph, builds a localization plan under your budget, then <span className="text-bone">re-plans when you remove a market or cut the budget</span> — reusing evidence and showing exactly what changed.</p>
              <ol className="mt-4 grid grid-cols-3 gap-2 text-xs text-bone-dim">
                {["Research markets with Qloo", "Plan the release", "Break the plan in the War Room"].map((s, i) => (
                  <li key={s} className="rounded-lg border border-line px-3 py-2"><span className="font-mono text-amber">0{i + 1}</span> {s}</li>
                ))}
              </ol>
            </div>
          )}
          {isEditing ? (
            <BriefForm initial={input} onSubmit={run} onCancel={() => setIsEditing(false)} />
          ) : (
            <FilmCard input={input} isBusy={Boolean(busy)} hasRun={Boolean(session)} onRun={() => run(input)} onEdit={() => setIsEditing(true)} />
          )}
          {error && <p role="alert" className="panel border-ember/60 p-4 text-sm text-ember">{error}</p>}
          <TracePanel events={trace} isRunning={Boolean(busy)} startedAt={startedAt} />
        </div>

        <div className="space-y-5">
          <div className="panel p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="eyebrow">Cultural market atlas</p>
              <p className="text-xs text-bone-faint">{session ? "click a market for its evidence" : busy ? "investigating…" : "run research to light the map"}</p>
            </div>
            <Atlas
              research={session?.research ?? {}}
              planCodes={session?.plan.markets.map((m) => m.code) ?? []}
              candidateCodes={input.targetMarkets}
              excludedCodes={session?.input.constraints.excludedMarkets ?? []}
              selected={selected}
              onSelect={setSelected}
              pending={pending}
            />
            {session && (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Researched markets">
                {Object.values(session.research).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((r) => (
                  <button key={r.code} type="button" onClick={() => setSelected(r.code)} aria-pressed={selected === r.code} className={`rounded-full border px-2.5 py-1 text-xs tabular-nums ${selected === r.code ? "border-bone text-bone" : "border-line-2 text-bone-dim hover:text-bone"}`}>
                    {marketByCode(r.code).name} {r.score === null ? "—" : `${r.score.toFixed(2)}×`}
                  </button>
                ))}
              </div>
            )}
          </div>
          {session && selected && <MarketPanel key={`${selected}-${session.version}`} session={session} code={selected} />}
        </div>
      </section>

      {session && session.context && (
        <section className="mt-8">
          <WarRoom key={session.version} session={session} previous={previous?.session ?? null} isBusy={Boolean(busy)} onReplan={replan} onSelect={setSelected} />
          {versions.length > 1 && (
            <p className="mt-3 text-xs text-bone-faint">History: {versions.map((v) => `v${v.session.version} ${v.label}`).join(" → ")}</p>
          )}
        </section>
      )}
      {session && !session.context && <p className="panel mt-8 p-5 text-sm text-ember">Research failed for this brief, so there is no plan to revise. See the agent activity for the reason, then edit the brief.</p>}

      <section className="mt-8">
        <EvidenceLab key={session ? "with-session" : "empty"} session={session} calls={calls} summary={summary} />
      </section>

      <footer className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-bone-faint">
        Taste portability measures how much of the comps&apos; Qloo taste neighbourhood survives when conditioned on a market, relative to reference genres there. It is not a box-office, audience-size or revenue forecast. Location-conditioned Qloo movie data covers 2018+ releases. Cost figures are illustrative user assumptions. Built for the Qloo Agentic Hackathon 2026 · MIT licence.
      </footer>
    </div>
  );
}

function FilmCard({ input, isBusy, hasRun, onRun, onEdit }: { input: AgentInput; isBusy: boolean; hasRun: boolean; onRun: () => void; onEdit: () => void }) {
  return (
    <article className="panel p-5">
      <p className="eyebrow">{input.genre || "Film"} · {input.originalLanguage} · unreleased</p>
      <h2 className="mt-1 font-display text-3xl leading-tight">{input.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-bone-dim">{input.synopsis}</p>
      <div className="mt-4">
        <p className="eyebrow mb-2">Comparable titles</p>
        <ul className="flex flex-wrap gap-2">
          {input.comps.map((c) => (
            <li key={c.name} className="rounded-full border border-line-2 px-3 py-1 text-xs">{c.name}{c.year ? <span className="text-bone-faint"> {c.year}</span> : null}</li>
          ))}
        </ul>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <div><dt className="text-bone-faint">Budget</dt><dd className="tabular-nums text-bone">${input.constraints.budgetUsd.toLocaleString("en-US")}</dd></div>
        <div><dt className="text-bone-faint">Max markets</dt><dd className="text-bone">{input.constraints.maxMarkets}</dd></div>
        <div><dt className="text-bone-faint">Candidates</dt><dd className="text-bone">{input.targetMarkets.length} markets</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={isBusy} onClick={onRun}>{isBusy ? "Researching…" : hasRun ? "Re-run research" : "Run live research"}</button>
        <button type="button" className="btn" disabled={isBusy} onClick={onEdit}>Edit brief</button>
      </div>
      <p className="mt-3 text-[0.7rem] text-bone-faint">Real Qloo calls. A first run takes ~40 s; repeat runs use the private cache and finish in a few seconds.</p>
    </article>
  );
}
