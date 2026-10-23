"use client";

import type { AgentState, TraceEvent } from "@/lib/agent/agent";

export const TRACE_LABEL: Record<AgentState, string> = {
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

/** Technical audit trail of the agent's steps. Lives at Level 3 of the evidence view, never in the main flow. */
export function TracePanel({ events, isRunning, startedAt, lastCalls }: Props) {
  if (!events.length && !isRunning) return <p className="text-sm text-bone-dim">No agent run yet.</p>;
  return (
    <section aria-live="polite" aria-label="Agent activity">
      <ol className="space-y-3">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[9.5rem_1fr]">
            <span className="font-mono text-[0.72rem] uppercase tracking-wider text-bone-faint">
              {startedAt ? `+${((e.at - startedAt) / 1000).toFixed(1)}s ` : ""}
              <span className="text-bone-dim">{TRACE_LABEL[e.state]}</span>
            </span>
            <span className="leading-snug text-bone/90">
              {e.message}
              {e.callIds && <span className="ml-2 font-mono text-[0.7rem] text-teal/80">{e.callIds.length} Qloo request{e.callIds.length > 1 ? "s" : ""}</span>}
            </span>
          </li>
        ))}
        {!isRunning && lastCalls && (
          <li className="grid gap-x-3 gap-y-1 text-xs text-bone-dim sm:grid-cols-[9.5rem_1fr]">
            <span className="font-mono uppercase tracking-wider text-bone-faint">Evidence source</span>
            <span>{lastCalls.live + lastCalls.cached} Qloo requests · <span className="text-ok">{lastCalls.live} live</span> · {lastCalls.cached} answered from the private cache of earlier live Qloo responses</span>
          </li>
        )}
        {isRunning && <li className="pulse text-sm text-bone-faint">waiting for the next step…</li>}
      </ol>
    </section>
  );
}
