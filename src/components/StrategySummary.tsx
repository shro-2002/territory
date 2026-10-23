"use client";

import { motion, useReducedMotion } from "motion/react";

import type { Session } from "@/lib/agent/agent";
import { nextSteps, strategyItems, uncertainties, type BaselineComparison, type StrategyItem } from "@/lib/territory/view-model";
import { EvidenceMeter } from "./ui/Meter";
import { SectionHead } from "./ui/SectionHead";

export interface CallStats {
  live: number;
  cached: number;
}

type Props = { session: Session; stats: CallStats | null; onInspect: (code: string) => void };

const COMPARISON_TONE: Record<BaselineComparison, string> = { above: "var(--teal)", mixed: "var(--bone-dim)", below: "var(--warm)", unknown: "var(--bone-faint)" };

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
    <>Investigate {joinNames(items.map((i) => i.name))} first.</>
  ) : (
    <>No market can be recommended yet.</>
  );
  return (
    <section aria-labelledby="strategy-title" className="mx-auto max-w-[1320px] px-4 pt-24 sm:px-8">
      <SectionHead id="strategy" eyebrow={`Strategy, version ${session.version}`} title={<span id="strategy-title">{lede}</span>}>
        {items.length
          ? `These ${items.length} markets give the most taste overlap with your comparable films that fits your ${c.maxMarkets}-market limit, leaving $${remaining.toLocaleString("en-US")} of the $${c.budgetUsd.toLocaleString("en-US")} localization budget unspent. Overlap says where to investigate first; it does not say a market will buy or watch the film.`
          : "Evidence is insufficient or your constraints exclude every supported market. Loosen a constraint or try different comparable titles."}
      </SectionHead>

      {items.length > 0 && (
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it, i) => <MarketCard key={it.code} item={it} rank={i + 1} onInspect={onInspect} />)}
        </ol>
      )}

      <p className={`mt-5 flex items-start gap-2 text-sm ${session.violations.length ? "text-rose" : "text-ok"}`}>
        <span aria-hidden>{session.violations.length ? "!" : "✓"}</span>
        {session.violations.length ? `Constraint violations: ${session.violations.join("; ")}` : "Independent check passed — budget, market cap, exclusions and subtitle rule recomputed outside the planner."}
      </p>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <Panel title="Do next" tone="var(--violet)">
          <ul className="space-y-3">{nextSteps(session).map((s) => <li key={s} className="flex gap-3"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-violet" />{s}</li>)}</ul>
        </Panel>
        <Panel title="What remains uncertain" tone="var(--warm)">
          <ul className="space-y-3">{uncertainties(session).map((s) => <li key={s} className="flex gap-3"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warm" />{s}</li>)}</ul>
        </Panel>
        <QlooPanel session={session} stats={stats} />
      </div>
    </section>
  );
}

function Panel({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="panel p-6">
      <p className="eyebrow" style={{ color: tone }}>{title}</p>
      <div className="mt-4 text-sm leading-relaxed text-bone-dim">{children}</div>
    </div>
  );
}

function QlooPanel({ session, stats }: { session: Session; stats: CallStats | null }) {
  const read = Object.keys(session.research).length;
  const qlooClaims = session.claims.filter((cl) => cl.provenance === "qloo").length;
  const localTitles = Object.values(session.research).reduce((n, r) => n + r.localNeighbours.length, 0);
  const rows: Array<[string, string]> = [
    ["Markets read through Qloo", String(read)],
    ["Qloo-backed claims", String(qlooClaims)],
    ["Local comparable titles found", String(localTitles)],
    ...(stats ? [["Qloo requests", `${stats.live + stats.cached} (${stats.live} live)`] as [string, string]] : []),
  ];
  return (
    <div className="panel p-6">
      <p className="eyebrow text-teal">What Qloo contributes</p>
      <p className="mt-4 text-sm leading-relaxed text-bone-dim">Qloo&apos;s taste graph supplies the cultural neighbourhood of your comps in each country. Territory&apos;s planner — deterministic, no AI arithmetic — turns it into a budgeted plan.</p>
      <dl className="mt-4 divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-bone-dim">{k}</dt><dd className="tabular-nums text-bone">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function MarketCard({ item, rank, onInspect }: { item: StrategyItem; rank: number; onInspect: (code: string) => void }) {
  const reduce = useReducedMotion();
  const tone = COMPARISON_TONE[item.reading.comparison];
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: rank * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="panel flex flex-col p-6"
    >
      <p className="eyebrow">Investigate {ordinal(rank)}</p>
      <h3 className="display mt-2 text-4xl leading-none">{item.name}</h3>
      <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs" style={{ borderColor: `color-mix(in oklab, ${tone} 50%, transparent)`, color: tone }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />{item.reading.comparisonLabel}
      </p>
      <p className="mt-4 text-sm leading-relaxed text-bone-dim">{item.reason}</p>
      <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
        <div className="flex items-center justify-between gap-3"><dt className="text-bone-faint">Localization</dt><dd className="text-right">{item.formatLabel}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-bone-faint">Evidence strength</dt><dd><EvidenceMeter strength={item.evidence} /></dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-bone-faint">Overlap ratio</dt><dd className="tabular-nums text-bone-dim">{item.score.toFixed(2)}×{item.scoreRange ? ` (${item.scoreRange[0].toFixed(2)}–${item.scoreRange[1].toFixed(2)})` : ""}</dd></div>
      </dl>
      {item.localComps.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-bone-faint">Local titles near yours: <span className="text-bone-dim">{item.localComps.join(", ")}</span></p>
      )}
      <button type="button" onClick={() => onInspect(item.code)} className="btn mt-5 w-full">Inspect on the atlas</button>
    </motion.li>
  );
}
