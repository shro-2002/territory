"use client";

import type { AgentState, TraceEvent } from "@/lib/agent/agent";

const LABEL: Record<AgentState, string> = {
  INPUT_VALIDATION: "Validate brief",
  ENTITY_RESOLUTION: "Resolve comps",
  RESEARCH_PLANNING: "Plan research",
  QLOO_INVESTIGATION: "Investigate markets",
  EVIDENCE_VERIFICATION: "Verify evidence",
  STRATEGY_CONSTRUCTION: "Build strategy",
  CONSTRAINT_VALIDATION: "Check constraints",
  FINAL_REPORT: "Report",
  IMPACT_ANALYSIS: "Impact analysis",
  SELECTIVE_RESEARCH: "Selective research",
  STRATEGY_REVISION: "Revise strategy",
  VERIFICATION: "Re-verify",
};

type Props = {
  events: TraceEvent[];
  isRunning: boolean;
  startedAt: number | null;
  /** Calls made by the last completed request: how many reached Qloo vs the private cache. */
  lastCalls: { live: number; cached: number } | null;
};

export function TracePanel({ events, isRunning, startedAt, lastCalls }: Props) {
  if (!events.length && !isRunning) return null;
  return (
    <section className="panel p-5" aria-live="polite" aria-label="Agent activity">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="eyebrow">Agent activity</h3>
        {isRunning && (
          <span className="flex items-center gap-2 text-xs text-amber">
            <span className="pulse h-2 w-2 rounded-full bg-amber" />
            working — live Qloo calls in progress
          </span>
        )}
      </div>
      <ol className="space-y-3">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="rise grid grid-cols-[8.5rem_1fr] gap-3 text-sm">
            <span className="font-mono text-[0.72rem] uppercase tracking-wider text-bone-faint">
              {startedAt ? `+${((e.at - startedAt) / 1000).toFixed(1)}s ` : ""}
              <span className="text-bone-dim">{LABEL[e.state]}</span>
            </span>
            <span className="text-bone/90 leading-snug">
              {e.message}
              {e.callIds && <span className="ml-2 font-mono text-[0.7rem] text-amber/70">{e.callIds.length} Qloo request{e.callIds.length > 1 ? "s" : ""}</span>}
            </span>
          </li>
        ))}
        {!isRunning && lastCalls && (
          <li className="grid grid-cols-[8.5rem_1fr] gap-3 text-xs text-bone-dim">
            <span className="font-mono uppercase tracking-wider text-bone-faint">Evidence source</span>
            <span>
              {lastCalls.live + lastCalls.cached} Qloo requests · <span className="text-ok">{lastCalls.live} live</span> · {lastCalls.cached} answered from the private cache of earlier live Qloo responses
            </span>
          </li>
        )}
        {isRunning && (
          <li className="grid grid-cols-[8.5rem_1fr] gap-3 text-sm text-bone-faint">
            <span />
            <span className="pulse">waiting for the next step…</span>
          </li>
        )}
      </ol>
    </section>
  );
}
