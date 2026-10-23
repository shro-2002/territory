"use client";

import { useState, type ReactNode } from "react";

import { marketByCode } from "@/lib/territory/markets";
import type { Constraints } from "@/lib/territory/planner";
import { RevisionCompare, type HistoryEntry } from "./RevisionCompare";
import { SectionHead } from "./ui/SectionHead";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const BUDGET_CUT = 0.6;
const PREFERRED_SHOCK = "DE";

type Props = {
  history: HistoryEntry[];
  isBusy: boolean;
  isReplanning: boolean;
  progressLine: string | null;
  onReplan: (patch: Partial<Constraints>, label: string) => void;
};

export function WarRoom({ history, isBusy, isReplanning, progressLine, onReplan }: Props) {
  const session = history.at(-1)!.session;
  const c = session.input.constraints;
  const [budgetDraft, setBudgetDraft] = useState(String(c.budgetUsd));
  const planLanguages = [...new Set(session.plan.markets.filter((m) => m.mode !== "original").map((m) => m.language))];
  const remove = (code: string) => onReplan({ excludedMarkets: [...c.excludedMarkets, code] }, `${marketByCode(code).name}’s distributor pulls out`);
  const shock = session.plan.markets.find((m) => m.code === PREFERRED_SHOCK) ?? session.plan.markets.find((m) => m.mode !== "original") ?? session.plan.markets[0];
  const cutBudget = Math.round(c.budgetUsd * BUDGET_CUT);
  const budget = Number(budgetDraft);
  const isBudgetValid = Number.isFinite(budget) && budget >= 0 && budget !== c.budgetUsd;

  return (
    <section aria-labelledby="war-title" className="mx-auto max-w-[1320px] px-4 pt-32 sm:px-8" aria-label="Distribution War Room">
      <SectionHead id="war-room" eyebrow="The War Room" title={<span id="war-title">Now break the plan.</span>}>
        Real releases fall apart. Pick a disruption and Territory works out which decisions are invalidated, keeps the evidence that still holds, researches only what is missing, then re-optimises and re-checks.
      </SectionHead>

      <div className="grid gap-4 md:grid-cols-2">
        {shock && (
          <Scenario
            tag="Disruption"
            title={`${shock.name}’s distributor pulls out`}
            detail={`Remove ${shock.name} from the plan and find the best replacement.`}
            disabled={isBusy}
            onRun={() => remove(shock.code)}
          />
        )}
        <Scenario
          tag="Disruption"
          title="Localization budget cut by 40%"
          detail={`${usd(c.budgetUsd)} becomes ${usd(cutBudget)}. Which language work survives?`}
          disabled={isBusy}
          onRun={() => onReplan({ budgetUsd: cutBudget }, "Localization budget cut by 40%")}
        />
      </div>

      {isReplanning && (
        <div role="status" className="mt-6 overflow-hidden rounded-2xl border border-accent/40 bg-accent/10 p-5">
          <p className="flex items-center gap-3 text-sm text-bone"><span className="pulse h-2 w-2 rounded-full bg-accent" />Re-planning — reusing evidence, researching only what is missing{progressLine ? ` · ${progressLine}` : ""}</p>
          <span aria-hidden className="mt-4 block h-0.5 w-full rounded-full" style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)", backgroundSize: "50% 100%", animation: "drift 1.6s linear infinite" }} />
        </div>
      )}

      {history.length > 1 ? <RevisionCompare history={history} /> : <p className="mt-8 rounded-2xl border border-dashed border-line-2 p-6 text-sm text-bone-dim">Run a scenario and the original and revised strategies will appear here, side by side, with the reasons for every change.</p>}

      <div className="panel mt-10 p-6">
        <p className="eyebrow">Other changes to test</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {session.plan.markets.map((m) => <button key={m.code} type="button" disabled={isBusy} onClick={() => remove(m.code)} className="btn" aria-label={`Remove ${m.name} and replan`}>Remove {m.name}</button>)}
          <button type="button" disabled={isBusy || c.maxMarkets <= 1} onClick={() => onReplan({ maxMarkets: c.maxMarkets - 1 }, `Prioritise ${c.maxMarkets - 1} markets`)} className="btn">Prioritise fewer markets ({c.maxMarkets} → {c.maxMarkets - 1})</button>
          <button type="button" disabled={isBusy} onClick={() => onReplan({ subtitleFirst: !c.subtitleFirst }, c.subtitleFirst ? "Dubbing allowed again" : "Subtitle-first rule")} className="btn" aria-pressed={c.subtitleFirst}>{c.subtitleFirst ? "Allow dubbing again" : "Require subtitle-first"}</button>
          {planLanguages.map((l) => <button key={l} type="button" disabled={isBusy} onClick={() => onReplan({ excludedLanguages: [...c.excludedLanguages, l] }, `${l} localization excluded`)} className="btn">Exclude {l}</button>)}
        </div>
        <form className="mt-4 flex flex-wrap items-center gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); if (isBudgetValid) onReplan({ budgetUsd: Math.round(budget) }, `Budget set to ${usd(Math.round(budget))}`); }}>
          <label htmlFor="budget" className="text-bone-dim">Set budget (USD)</label>
          <input id="budget" inputMode="numeric" value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value.replace(/[^\d]/g, ""))} className="field w-36 tabular-nums" />
          <button type="submit" disabled={isBusy || !isBudgetValid} className="btn">Apply</button>
        </form>
        {(c.excludedMarkets.length > 0 || c.excludedLanguages.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-bone-dim">
            Excluded:
            {c.excludedMarkets.map((code) => <Restore key={code} disabled={isBusy} onClick={() => onReplan({ excludedMarkets: c.excludedMarkets.filter((x) => x !== code) }, `${marketByCode(code).name} reinstated`)}>{marketByCode(code).name}</Restore>)}
            {c.excludedLanguages.map((l) => <Restore key={l} disabled={isBusy} onClick={() => onReplan({ excludedLanguages: c.excludedLanguages.filter((x) => x !== l) }, `${l} reinstated`)}>{l}</Restore>)}
          </div>
        )}
        <p className="mt-4 text-xs text-bone-faint">History: {history.map((h) => `v${h.session.version} ${h.label}`).join(" → ")}</p>
      </div>
    </section>
  );
}

function Scenario({ tag, title, detail, disabled, onRun }: { tag: string; title: string; detail: string; disabled: boolean; onRun: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onRun} className="panel p-7 text-left transition-colors hover:border-accent disabled:opacity-50">
      <p className="eyebrow text-removed-ink">{tag}</p>
      <span className="display mt-3 block text-3xl leading-tight sm:text-4xl">{title}</span>
      <span className="mt-3 block text-sm text-bone-dim">{detail}</span>
      <span className="mt-6 inline-flex text-sm text-accent">Run this scenario</span>
    </button>
  );
}

function Restore({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="rounded-full border border-removed/50 px-3 py-1.5 text-removed-ink hover:bg-removed/10">{children} ✕</button>;
}
