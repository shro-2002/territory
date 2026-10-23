"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { ChangeDriver, Session } from "@/lib/agent/agent";
import { marketByCode } from "@/lib/territory/markets";
import { compareRows, MODE_LABEL, revisionStats, type CompareRow, type RowChange } from "@/lib/territory/view-model";
import { AnimatedNumber } from "./ui/AnimatedNumber";

export interface HistoryEntry {
  session: Session;
  label: string;
}

const DRIVER: Record<ChangeDriver, { label: string; color: string }> = {
  "cultural-evidence": { label: "Qloo evidence", color: "var(--evidence)" },
  cost: { label: "Cost", color: "var(--caution)" },
  constraint: { label: "Your constraint", color: "var(--accent)" },
};

const ROW_TONE: Record<RowChange, { color: string; tag: string }> = {
  kept: { color: "var(--bone)", tag: "" },
  added: { color: "var(--evidence)", tag: "New" },
  changed: { color: "var(--accent)", tag: "Changed" },
  dropped: { color: "var(--removed-ink)", tag: "Removed" },
};

type Props = { history: HistoryEntry[] };

export function RevisionCompare({ history }: Props) {
  const [against, setAgainst] = useState<"previous" | "original">("previous");
  const root = useRef<HTMLDivElement>(null);
  // A new revision mounts this view fresh; bring it into view so the before/after is the first thing seen.
  useEffect(() => {
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const current = history.at(-1)!;
  const base = against === "original" ? history[0] : history.at(-2)!;
  const rev = current.session.revisions.at(-1);
  if (!rev) return null;
  const rows = compareRows(base.session.plan, current.session.plan);
  const stats = revisionStats(rev);

  return (
    <div ref={root} className="mt-10 scroll-mt-24 border-l-2 border-accent pl-4 sm:pl-6" aria-label="Strategy revision">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex flex-wrap items-center gap-3 text-sm text-accent"><span className="rounded-full bg-accent/15 px-3 py-1 font-medium">Currently displayed</span><span className="eyebrow text-accent">Revision v{base.session.version} → v{current.session.version}</span></p>
          <h3 className="display mt-2 text-4xl leading-tight">{current.label}</h3>
        </div>
        {history.length > 2 && (
          <div role="group" aria-label="Compare against" className="flex gap-1 rounded-full border border-line p-1">
            {(["previous", "original"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={against === k} onClick={() => setAgainst(k)} className={`rounded-full px-4 py-2 text-xs ${against === k ? "bg-accent/20 text-bone" : "text-bone-dim hover:text-bone"}`}>
                vs {k === "previous" ? `v${history.at(-2)!.session.version}` : "original v1"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <StrategyColumn title={`${against === "original" ? "Original" : "Previous"} strategy · v${base.session.version}`} session={base.session} rows={rows} side="before" />
        <div aria-hidden className="hidden items-center text-3xl text-accent lg:flex">→</div>
        <StrategyColumn title={`Revised strategy · v${current.session.version}`} session={current.session} rows={rows} side="after" accent />
      </div>

      <dl className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="panel p-6">
          <dt className="eyebrow text-accent">Why the decision changed</dt>
          <dd className="mt-4">
            <ul className="space-y-3">
              {rev.changes.map((ch) => (
                <li key={ch.text} className="flex items-start gap-3 text-sm">
                  {ch.driver !== "summary" && <DriverTag driver={ch.driver} />}
                  <span className={ch.driver === "summary" ? "text-bone-dim" : "text-bone"}>{ch.text}</span>
                </li>
              ))}
            </ul>
            {rev.invalidated.length > 0 && <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-bone-faint"><span className="text-bone-dim">What the change broke:</span> {rev.invalidated.join("; ")}.</p>}
          </dd>
        </div>
        <div className="panel p-6">
          <dt className="eyebrow text-evidence">What evidence was reused — and what was researched again</dt>
          <dd className="mt-4">
            <div className="grid grid-cols-2 gap-4">
              <Stat value={stats.reused} label="markets’ evidence reused, no new Qloo requests" tone="var(--evidence)" />
              <Stat value={stats.newlyResearched} label={stats.newlyResearched ? "markets researched again" : "markets needed new research"} tone="var(--accent)" />
            </div>
            <p className="mt-4 text-sm leading-relaxed text-bone-dim">
              {stats.newlyResearched
                ? <>Researched for this revision: <span className="text-bone">{rev.newlyResearched.map((c) => marketByCode(c).name).join(", ")}</span>.</>
                : "Taste evidence does not change with budget or exclusions, so the existing research was enough."}
              {stats.retainedUnusable > 0 && <> Kept but unusable: {rev.retainedUnusable.map((c) => marketByCode(c).name).join(", ")}.</>}
            </p>
            <details className="group mt-4 border-t border-line pt-4">
              <summary className="flex items-center justify-between text-sm text-bone-dim hover:text-bone"><span>Agent reasoning</span><span aria-hidden className="transition-transform group-open:rotate-45">+</span></summary>
              <ul className="mt-3 space-y-2 text-xs text-bone-dim">
                {rev.decisions.map((d, i) => <li key={i}><span className="font-mono text-accent">{d.action}</span> — {d.reason}</li>)}
              </ul>
            </details>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function StrategyColumn({ title, session, rows, side, accent }: { title: string; session: Session; rows: CompareRow[]; side: "before" | "after"; accent?: boolean }) {
  const reduce = useReducedMotion();
  const visible = rows.filter((r) => (side === "before" ? r.before !== null : r.after !== null));
  const budget = session.input.constraints.budgetUsd;
  return (
    <section className={`panel p-6 ${accent ? "border-accent/50" : ""}`} style={accent ? { boxShadow: "var(--glow-accent)" } : undefined}>
      <p className="eyebrow">{title}</p>
      <p className="mt-3 text-sm text-bone-dim"><AnimatedNumber value={session.plan.totalCostUsd} className="display text-3xl text-bone" /> of <AnimatedNumber value={budget} className="tabular-nums" /> planned</p>
      <ul className="mt-5 space-y-2">
        <AnimatePresence initial={false}>
          {visible.map((r, i) => {
            const mode = side === "before" ? r.before! : r.after!;
            const tone = ROW_TONE[side === "before" ? (r.change === "dropped" ? "dropped" : "kept") : r.change === "dropped" ? "kept" : r.change];
            return (
              <motion.li
                key={`${side}-${r.code}`}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, x: side === "before" ? -12 : 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-ink/50 px-4 py-3"
                style={{ borderColor: tone.tag ? `color-mix(in oklab, ${tone.color} 45%, transparent)` : undefined }}
              >
                <span className={`font-medium ${side === "before" && r.change === "dropped" ? "line-through decoration-removed" : ""}`} style={{ color: tone.color }}>{r.name}</span>
                <span className="flex items-center gap-2 text-xs text-bone-dim">
                  {mode === "original" ? MODE_LABEL.original : `${MODE_LABEL[mode]} · ${r.language}`}
                  {tone.tag && <span className="rounded-full border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider" style={{ color: tone.color, borderColor: `color-mix(in oklab, ${tone.color} 50%, transparent)` }}>{side === "before" ? "Removed" : tone.tag}</span>}
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {visible.length === 0 && <p className="mt-5 text-sm text-removed-ink">No market satisfies these constraints with sufficient evidence.</p>}
    </section>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div>
      <p className="display text-5xl tabular-nums" style={{ color: tone }}>{value}</p>
      <p className="mt-1 text-xs leading-snug text-bone-dim">{label}</p>
    </div>
  );
}

function DriverTag({ driver }: { driver: ChangeDriver }) {
  const d = DRIVER[driver];
  return (
    <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider" style={{ color: d.color, borderColor: `color-mix(in oklab, ${d.color} 55%, transparent)` }}>
      {d.label}
    </span>
  );
}
