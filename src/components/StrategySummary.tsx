"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId, useState, type ReactNode } from "react";

import type { Session } from "@/lib/agent/agent";
import { CLAIM_BADGE, nextSteps, type StrategyItem, strategyItems, uncertainties, evidenceLine } from "@/lib/territory/view-model";
import { SectionHead } from "./ui/SectionHead";

export interface CallStats {
  live: number;
  cached: number;
}

type Props = { session: Session; stats: CallStats | null; onInspect: (code: string) => void };


const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `#${n}`;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function StrategySummary({ session, stats, onInspect }: Props) {
  const items = strategyItems(session);
  const c = session.input.constraints;
  const remaining = c.budgetUsd - session.plan.totalCostUsd;
  const lede = items.length ? (
    <>Plan for <em>{joinNames(items.map((i) => i.name))}</em>.</>
  ) : (
    <>No candidate market fits yet.</>
  );
  return (
    <section aria-labelledby="strategy-title" className="mx-auto max-w-[1320px] px-4 pt-24 sm:px-8">
      <SectionHead id="strategy" eyebrow={`Strategy, version ${session.version}`} title={<span id="strategy-title">{lede}</span>}>
        {items.length
          ? `Taken from your candidate list in your priority order, these ${items.length} markets fit your ${c.maxMarkets}-market limit and leave $${remaining.toLocaleString("en-US")} of the $${c.budgetUsd.toLocaleString("en-US")} localization budget unspent. Qloo did not rank them: below, it shows what is associated with your comps in each country and what still needs checking.`
          : "Your budget, market cap or exclusions rule out every candidate market. Loosen a constraint or add candidates."}
      </SectionHead>

      {items.length > 0 && (
        <a href="#budget" className="mb-6 flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface-glass px-4 py-3 text-sm transition-colors hover:border-accent">
          <span className="text-bone-dim">Localization budget</span>
          <span className="tabular-nums text-bone">${session.plan.totalCostUsd.toLocaleString("en-US")} of ${c.budgetUsd.toLocaleString("en-US")} planned</span>
          <span className="text-accent">See the breakdown</span>
        </a>
      )}
      {items.length > 0 && (
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it, i) => <MarketCard key={it.code} item={it} rank={i + 1} onInspect={onInspect} />)}
        </ol>
      )}

      <p className={`mt-5 flex items-start gap-2 text-sm ${session.violations.length ? "text-removed-ink" : "text-success"}`}>
        <span aria-hidden>{session.violations.length ? "!" : "✓"}</span>
        {session.violations.length ? `Constraint violations: ${session.violations.join("; ")}` : "Independent check passed — budget, market cap, exclusions and subtitle rule recomputed outside the planner."}
      </p>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <Panel title="Questions to investigate" tone="var(--accent)" defaultOpen>
          <ul className="space-y-3">{nextSteps(session).map((s) => <li key={s} className="flex gap-3"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />{s}</li>)}</ul>
        </Panel>
        <Panel title="What remains uncertain" tone="var(--caution)">
          <ul className="space-y-3">{uncertainties(session).map((s) => <li key={s} className="flex gap-3"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-caution" />{s}</li>)}</ul>
        </Panel>
        <QlooPanel session={session} stats={stats} />
      </div>
    </section>
  );
}

/** Always open from md up; on small screens the body folds behind its title so the page stays short. */
function Panel({ title, tone, defaultOpen = false, children }: { title: string; tone: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="panel p-6">
      <p className="eyebrow hidden md:block" style={{ color: tone }}>{title}</p>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="eyebrow flex min-h-11 w-full items-center justify-between md:hidden" style={{ color: tone }}>
        {title}<span aria-hidden className="text-lg">{open ? "−" : "+"}</span>
      </button>
      <div id={id} className={`${open ? "block" : "hidden"} mt-2 text-sm leading-relaxed text-bone-dim md:mt-4 md:block`}>{children}</div>
    </div>
  );
}

function QlooPanel({ session, stats }: { session: Session; stats: CallStats | null }) {
  const read = Object.keys(session.research).length;
  const qlooClaims = session.claims.filter((cl) => cl.provenance === "qloo").length;
  const candidates = Object.values(session.research).reduce((n, r) => n + (r.claimCheck?.candidateCount ?? 0), 0);
  const rows: Array<[string, string]> = [
    ["Markets read through Qloo", String(read)],
    ["Qloo-backed claims", String(qlooClaims)],
    ["Candidates to verify (survived every control)", String(candidates)],
    ...(stats ? [["Qloo requests", `${stats.live + stats.cached} (${stats.live} live)`] as [string, string]] : []),
  ];
  return (
    <Panel title="What Qloo contributes" tone="var(--evidence)">
      <p>Qloo surfaces the titles associated with your comps in each country. Territory tests them against unrelated genres and films there and against the other markets, separating the country&apos;s general catalogue from the few candidates to verify. The budget planner never sees this evidence.</p>
      <dl className="mt-4 divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-bone-dim">{k}</dt><dd className="tabular-nums text-bone">{v}</dd></div>
        ))}
      </dl>
    </Panel>
  );
}

function MarketCard({ item, rank, onInspect }: { item: StrategyItem; rank: number; onInspect: (code: string) => void }) {
  const reduce = useReducedMotion();
  const tone = item.evidence.gap ? "var(--caution)" : "var(--evidence)";
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: rank * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="panel flex flex-col p-6"
    >
      <p className="eyebrow">{item.priority ? `Your #${item.priority} candidate` : `Suggested reserve · ${ordinal(rank)} in plan`}</p>
      <h3 className="display mt-2 text-4xl leading-none">{item.name}</h3>
      <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs" style={{ borderColor: `color-mix(in oklab, ${tone} 50%, transparent)`, color: tone }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />{item.evidence.gap ? "Research gap" : item.evidence.claim ? CLAIM_BADGE[item.evidence.claim](item.evidence.candidates) : "Not claim-checked"}
      </p>
      <p className="mt-3 text-sm text-bone md:hidden">{item.formatLabel}</p>
      <div id={bodyId} className={`${open ? "block" : "hidden"} md:block`}>
        <p className="mt-4 text-sm leading-relaxed text-bone-dim">{item.reason}</p>
        <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
          <div className="flex items-center justify-between gap-3"><dt className="text-bone-faint">Language work</dt><dd className="text-right">{item.formatLabel}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-bone-faint">General catalogue</dt><dd className="text-right tabular-nums text-bone-dim">{item.evidence.gap ? "—" : `${item.evidence.catalogue} of ${item.evidence.titlesFound}`}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-bone-faint">Candidates to verify</dt><dd className="text-right tabular-nums text-bone-dim">{item.evidence.gap ? "—" : item.evidence.candidates}</dd></div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-bone-faint">{evidenceLine(item.evidence)}</p>
        {item.candidates.length > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-bone-faint">Candidates to verify (not proven local matches): <span className="text-bone-dim">{item.candidates.join(", ")}</span></p>
        )}
        <button type="button" onClick={() => onInspect(item.code)} className="btn mt-5 w-full">Inspect on the atlas</button>
      </div>
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)} className="btn mt-4 w-full md:hidden">{open ? "Hide details" : `Why ${item.name}?`}</button>
    </motion.li>
  );
}
