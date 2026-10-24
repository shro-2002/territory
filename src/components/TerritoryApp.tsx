"use client";

import { useEffect, useRef, useState } from "react";

import type { AgentInput, Session, TraceEvent } from "@/lib/agent/agent";
import { briefMarkdown } from "@/lib/client/brief";
import { useDataSource } from "@/lib/client/data-source";
import { streamAgent } from "@/lib/client/stream";
import type { CallRecord } from "@/lib/qloo/types";
import { marketByCode } from "@/lib/territory/markets";
import type { Constraints } from "@/lib/territory/planner";
import { AtlasSection } from "./AtlasSection";
import { BriefDialog } from "./BriefDialog";
import { BriefingExport } from "./BriefingExport";
import { EvidenceLab, ExperimentSummary } from "./EvidenceLab";
import { Hero } from "./Hero";
import { SiteNav } from "./SiteNav";
import { StrategySummary } from "./StrategySummary";
import { BudgetSection } from "./BudgetSection";
import { WarRoom } from "./WarRoom";

type Version = { session: Session; token: string; context: string | null; label: string };
type Props = { initialInput: AgentInput; summary: ExperimentSummary };

export function TerritoryApp({ initialInput, summary }: Props) {
  const [input, setInput] = useState(initialInput);
  const [isEditing, setIsEditing] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [lastCalls, setLastCalls] = useState<{ live: number; cached: number } | null>(null);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Runtime truth: what the server says it uses now, corrected by what the last run's Qloo calls reported.
  const source = useDataSource(calls.at(-1)?.source ?? null);
  const current = versions.at(-1) ?? null;
  const session = current?.session ?? null;
  // The research context stays server-side (encrypted); its presence means the plan can be revised.
  const canReplan = Boolean(current?.context);
  const doneMarkets = new Set(trace.filter((e) => e.kind === "progress" && e.market).map((e) => e.market!));
  const pending = busy ? (busy === "run" ? input.targetMarkets : []).filter((c) => !doneMarkets.has(c)) : [];
  const history = versions.map((v) => ({ session: v.session, label: v.label }));
  const latestMarket = [...trace].reverse().find((e) => e.kind === "progress" && e.market)?.market;
  const progress = { done: doneMarkets.size, total: busy === "run" ? input.targetMarkets.length : 0, latest: latestMarket ? marketByCode(latestMarket).name : null };
  const planCodes = session?.plan.markets.map((m) => m.code) ?? [];

  // Bring the first result into view once, so the strategy is the first thing seen after the click.
  const hasResult = Boolean(session);
  useEffect(() => {
    if (hasResult && versions.length === 1) document.getElementById("strategy")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hasResult, versions.length]);

  async function execute(body: unknown, label: string, mode: string, reset: boolean) {
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(mode);
    setError(null);
    setNotice(null);
    setTrace([]);
    setStartedAt(Date.now());
    setLastCalls(null);
    if (reset) {
      setVersions([]);
      setCalls([]);
      setSelected(null);
    }
    try {
      await streamAgent(body, (m) => {
        if (m.type === "trace") setTrace((t) => [...t, m.event]);
        else if (m.type === "error") setError(m.message);
        else if (m.type === "notice") setNotice(m.message);
        else {
          setVersions((v) => [...v, { session: m.session, token: m.token, context: m.context, label }]);
          setCalls((c) => [...c, ...m.calls]);
          const live = m.calls.filter((x) => !x.cacheHit).length;
          setLastCalls({ live, cached: m.calls.length - live });
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
    if (!current.context) return;
    void execute({ action: "replan", session: current.session, token: current.token, context: current.context, patch }, label, "replan", false);
  };
  const exportBrief = () => {
    if (!session) return;
    const blob = new Blob([briefMarkdown(session, source === "live" ? "live" : "mock")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `territory-${session.input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-v${session.version}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const inspect = (code: string) => {
    setSelected(code);
    document.getElementById("atlas")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative z-10">
      <SiteNav source={source} hasResult={Boolean(session)} onExport={exportBrief} />
      <main>
        <Hero input={input} source={source} isBusy={busy === "run"} hasResult={Boolean(session)} progress={progress} pendingCodes={busy === "run" ? pending : []} planCodes={planCodes} onRun={() => run(input)} onEdit={() => setIsEditing(true)} />
        {(error || notice) && (
          <div className="mx-auto max-w-[1320px] px-4 sm:px-8">
            {error && <p role="alert" className="panel border-removed/60 p-4 text-sm text-removed-ink">{error}</p>}
            {notice && <p role="status" className="panel border-caution/50 p-4 text-sm text-caution">{notice}</p>}
          </div>
        )}
        {session && canReplan && (
          <>
            <StrategySummary session={session} stats={lastCalls} onInspect={inspect} />
            <BudgetSection session={session} />
            <AtlasSection session={session} selected={selected} pending={pending} onSelect={setSelected} />
            <WarRoom key={session.version} history={history} isBusy={Boolean(busy)} isReplanning={busy === "replan"} progressLine={busy === "replan" ? trace.at(-1)?.message ?? null : null} onReplan={replan} />
          </>
        )}
        {session && !canReplan && (
          <div role="alert" className="mx-auto mt-10 max-w-[1320px] px-4 sm:px-8">
            <div className="panel p-6">
              <p className="text-removed-ink">Research failed for this brief, so Territory produced no plan.</p>
              {session.trace.at(-1) && <p className="mt-2 text-sm text-bone-dim">{session.trace.at(-1)!.message}</p>}
              <button type="button" className="btn mt-4" onClick={() => setIsEditing(true)}>Edit film brief</button>
            </div>
          </div>
        )}
        {(session || trace.length > 0 || calls.length > 0) && (
          <EvidenceLab key={session ? "with-session" : "empty"} session={session} calls={calls} summary={summary} trace={trace} isRunning={Boolean(busy)} startedAt={startedAt} lastCalls={lastCalls} />
        )}
        {session && canReplan && <BriefingExport session={session} onExport={exportBrief} />}
      </main>

      {isEditing && <BriefDialog initial={input} onSubmit={run} onCancel={() => setIsEditing(false)} />}

      <footer className="mx-auto mt-32 max-w-[1320px] border-t border-line px-4 py-8 text-xs leading-relaxed text-bone-faint sm:px-8">
        Qloo associations are titles related to your comps in each country, checked against unrelated genres and films there. Surviving titles are candidates to verify, not proven local matches. They are not audience preference, demand, box-office or revenue evidence, and they do not choose your markets. Location-conditioned Qloo movie data covers 2018+ releases. Cost figures are illustrative user assumptions. Built for the Qloo Agentic Hackathon 2026 · MIT licence.
      </footer>
    </div>
  );
}
