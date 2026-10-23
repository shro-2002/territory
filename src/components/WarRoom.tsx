"use client";

import { useState } from "react";

import type { ChangeDriver, Session } from "@/lib/agent/agent";
import { marketByCode } from "@/lib/territory/markets";
import type { Constraints, Plan } from "@/lib/territory/planner";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const BUDGET_CUT = 0.6;

type Props = {
  session: Session;
  previous: Session | null;
  isBusy: boolean;
  onReplan: (patch: Partial<Constraints>, label: string) => void;
  onSelect: (code: string) => void;
};

export function WarRoom({ session, previous, isBusy, onReplan, onSelect }: Props) {
  const c = session.input.constraints;
  const [budgetDraft, setBudgetDraft] = useState(String(c.budgetUsd));
  const planLanguages = [...new Set(session.plan.markets.filter((m) => m.mode !== "original").map((m) => m.language))];
  const remove = (code: string) => onReplan({ excludedMarkets: [...c.excludedMarkets, code] }, `Remove ${marketByCode(code).name}`);
  const reinstate = (code: string) => onReplan({ excludedMarkets: c.excludedMarkets.filter((x) => x !== code) }, `Reinstate ${marketByCode(code).name}`);
  const budget = Number(budgetDraft);
  const isBudgetValid = Number.isFinite(budget) && budget >= 0 && budget !== c.budgetUsd;

  return (
    <section className="space-y-5" aria-label="Distribution War Room">
      <div className="panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Strategy v{session.version}</p>
            <h3 className="font-display text-2xl">Release plan</h3>
          </div>
          <SpendMeter plan={session.plan} budget={c.budgetUsd} />
        </div>
        <PlanTable plan={session.plan} onSelect={onSelect} onRemove={remove} isBusy={isBusy} />
        <p className={`mt-3 text-xs ${session.violations.length ? "text-ember" : "text-ok"}`}>
          {session.violations.length ? `Constraint violations: ${session.violations.join("; ")}` : "✓ Independent check passed — budget, market cap, exclusions and subtitle rule recomputed outside the planner."}
        </p>
      </div>

      <div className="panel p-5">
        <p className="eyebrow mb-1">War Room</p>
        <h3 className="font-display text-xl">Break the plan</h3>
        <p className="mt-1 text-sm text-bone-dim">Each change re-runs the agent: it finds which decisions are invalidated, reuses existing evidence, researches replacements only when needed, then re-optimizes and re-verifies.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={isBusy} onClick={() => onReplan({ budgetUsd: Math.round(c.budgetUsd * BUDGET_CUT) }, "Cut budget 40%")} className="btn-primary">
            Cut budget 40% <span className="opacity-70">→ {usd(Math.round(c.budgetUsd * BUDGET_CUT))}</span>
          </button>
          <button type="button" disabled={isBusy || c.maxMarkets <= 1} onClick={() => onReplan({ maxMarkets: c.maxMarkets - 1 }, `Fewer markets (${c.maxMarkets - 1})`)} className="btn">
            Prioritise fewer markets ({c.maxMarkets} → {c.maxMarkets - 1})
          </button>
          <button type="button" disabled={isBusy} onClick={() => onReplan({ subtitleFirst: !c.subtitleFirst }, c.subtitleFirst ? "Allow dubbing" : "Subtitle-first")} className="btn" aria-pressed={c.subtitleFirst}>
            {c.subtitleFirst ? "Allow dubbing again" : "Require subtitle-first"}
          </button>
          {planLanguages.map((l) => (
            <button key={l} type="button" disabled={isBusy} onClick={() => onReplan({ excludedLanguages: [...c.excludedLanguages, l] }, `Exclude ${l}`)} className="btn">
              Exclude {l}
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex flex-wrap items-center gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (isBudgetValid) onReplan({ budgetUsd: Math.round(budget) }, `Budget ${usd(Math.round(budget))}`);
          }}
        >
          <label htmlFor="budget" className="text-bone-dim">Set budget</label>
          <input id="budget" inputMode="numeric" value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value.replace(/[^\d]/g, ""))} className="w-32 rounded-md border border-line-2 bg-ink px-2 py-1.5 tabular-nums" />
          <button type="submit" disabled={isBusy || !isBudgetValid} className="btn">Apply</button>
        </form>
        {(c.excludedMarkets.length > 0 || c.excludedLanguages.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-bone-dim">
            Excluded:
            {c.excludedMarkets.map((code) => (
              <button key={code} type="button" disabled={isBusy} onClick={() => reinstate(code)} className="rounded-full border border-ember/50 px-2.5 py-1 text-ember hover:bg-ember/10">
                {marketByCode(code).name} ✕
              </button>
            ))}
            {c.excludedLanguages.map((l) => (
              <button key={l} type="button" disabled={isBusy} onClick={() => onReplan({ excludedLanguages: c.excludedLanguages.filter((x) => x !== l) }, `Reinstate ${l}`)} className="rounded-full border border-ember/50 px-2.5 py-1 text-ember hover:bg-ember/10">
                {l} ✕
              </button>
            ))}
          </div>
        )}
      </div>

      {previous && <RevisionCompare previous={previous} current={session} />}
    </section>
  );
}

function SpendMeter({ plan, budget }: { plan: Plan; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (plan.totalCostUsd / budget) * 100) : 0;
  return (
    <div className="w-56 text-right">
      <p className="text-sm tabular-nums">
        <span className="font-display text-2xl text-bone">{usd(plan.totalCostUsd)}</span>
        <span className="text-bone-faint"> / {usd(budget)}</span>
      </p>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink">
        <span className="block h-full rounded-full bg-amber transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function PlanTable({ plan, onSelect, onRemove, isBusy }: { plan: Plan; onSelect: (code: string) => void; onRemove?: (code: string) => void; isBusy?: boolean }) {
  if (!plan.markets.length) return <p className="mt-4 text-sm text-ember">No market satisfies these constraints with sufficient evidence.</p>;
  const cost = new Map(plan.languages.map((l) => [l.language, l.costUsd]));
  return (
    <div className="mt-4 overflow-x-auto">
    <table className="w-full min-w-[34rem] text-sm">
      <thead>
        <tr className="text-left text-[0.7rem] uppercase tracking-wider text-bone-faint">
          <th className="pb-2 font-normal">Market</th>
          <th className="pb-2 font-normal">Localization</th>
          <th className="pb-2 text-right font-normal">Lift</th>
          <th className="pb-2 text-right font-normal">Language cost</th>
          {onRemove && <th className="pb-2" />}
        </tr>
      </thead>
      <tbody>
        {plan.markets.map((m) => (
          <tr key={m.code} className="border-t border-line">
            <td className="py-2">
              <button type="button" onClick={() => onSelect(m.code)} className="text-left hover:text-amber">{m.name}</button>
            </td>
            <td className="py-2 capitalize text-bone-dim">{m.mode}{m.mode !== "original" ? ` · ${m.language}` : ""}</td>
            <td className="py-2 text-right tabular-nums text-amber">{m.score.toFixed(2)}×</td>
            <td className="py-2 text-right tabular-nums text-bone-dim">{m.mode === "original" ? "—" : usd(cost.get(m.language) ?? 0)}</td>
            {onRemove && (
              <td className="py-2 text-right">
                <button type="button" disabled={isBusy} onClick={() => onRemove(m.code)} className="rounded-md border border-line-2 px-2 py-1 text-xs text-bone-dim hover:border-ember hover:text-ember disabled:opacity-40" aria-label={`Remove ${m.name} and replan`}>
                  Remove
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function RevisionCompare({ previous, current }: { previous: Session; current: Session }) {
  const rev = current.revisions.at(-1);
  if (!rev) return null;
  return (
    <div className="panel rise p-5" aria-label="Strategy revision">
      <p className="eyebrow">Revision v{previous.version} → v{current.version}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {[previous, current].map((s, i) => (
          <div key={s.version} className={`rounded-xl border p-3 ${i ? "border-amber/40" : "border-line"}`}>
            <p className="mb-2 text-xs text-bone-faint">v{s.version} · {usd(s.plan.totalCostUsd)} of {usd(s.input.constraints.budgetUsd)}</p>
            <ul className="space-y-1 text-sm">
              {s.plan.markets.map((m) => {
                const other = (i ? previous : current).plan.markets.find((x) => x.code === m.code);
                const tone = !other ? (i ? "text-ok" : "text-ember line-through") : other.mode !== m.mode ? "text-amber" : "text-bone";
                return (
                  <li key={m.code} className={`flex justify-between ${tone}`}>
                    <span>{m.name}</span>
                    <span className="capitalize text-bone-dim">{m.mode}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
        <div>
          <dt className="eyebrow mb-1">1 · Impact analysis</dt>
          <dd className="text-bone-dim">{rev.invalidated.length ? rev.invalidated.join("; ") : "No decision invalidated — the change only re-optimizes existing choices."}</dd>
        </div>
        <div>
          <dt className="eyebrow mb-1">2 · Evidence ledger</dt>
          <dd className="space-y-1 text-bone-dim">
            <p><span className="text-ok">Still valid, reused:</span> {rev.reusedMarkets.filter((c) => !rev.retainedUnusable.includes(c)).map((c) => marketByCode(c).name).join(", ")} — no new Qloo calls.</p>
            {rev.retainedUnusable.length > 0 && <p><span className="text-ember">Valid but unusable:</span> {rev.retainedUnusable.map((c) => marketByCode(c).name).join(", ")} (excluded; evidence kept for reference).</p>}
            <p><span className="text-amber">Newly researched:</span> {rev.newlyResearched.length ? rev.newlyResearched.map((c) => marketByCode(c).name).join(", ") : "none needed"}.</p>
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="eyebrow mb-1">3 · Agent tool decisions</dt>
          <dd>
            <ul className="space-y-1 text-bone-dim">
              {rev.decisions.map((d, i) => (
                <li key={i}><span className="font-mono text-[0.7rem] text-amber">{d.action}</span> — {d.reason}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="eyebrow mb-1">4 · What changed and why</dt>
          <dd>
            <ul className="space-y-1.5">
              {rev.changes.map((ch) => (
                <li key={ch.text} className="flex items-start gap-2 text-bone">
                  {ch.driver !== "summary" && <DriverTag driver={ch.driver} />}
                  <span className={ch.driver === "summary" ? "text-bone-dim" : ""}>{ch.text}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </div>
  );
}

const DRIVER: Record<ChangeDriver, { label: string; color: string }> = {
  "cultural-evidence": { label: "Qloo evidence", color: "var(--prov-qloo)" },
  cost: { label: "Cost", color: "var(--prov-external)" },
  constraint: { label: "Your constraint", color: "var(--prov-user)" },
};

function DriverTag({ driver }: { driver: ChangeDriver }) {
  const d = DRIVER[driver];
  return (
    <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider" style={{ color: d.color, borderColor: `color-mix(in oklab, ${d.color} 55%, transparent)` }}>
      {d.label}
    </span>
  );
}
