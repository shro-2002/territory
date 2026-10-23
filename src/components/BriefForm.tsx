"use client";

import { useState } from "react";

import type { AgentInput } from "@/lib/agent/agent";
import { MARKETS } from "@/lib/territory/markets";

type Props = {
  initial: AgentInput;
  onSubmit: (input: AgentInput) => void;
  onCancel: () => void;
};

const LANGUAGES = [...new Set(["English", ...MARKETS.map((m) => m.language)])];

export function BriefForm({ initial, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<AgentInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AgentInput>(k: K, v: AgentInput[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setComp = (i: number, patch: Partial<AgentInput["comps"][number]>) => set("comps", draft.comps.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const toggleMarket = (code: string) => set("targetMarkets", draft.targetMarkets.includes(code) ? draft.targetMarkets.filter((c) => c !== code) : [...draft.targetMarkets, code]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const comps = draft.comps.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), ...(c.year ? { year: c.year } : {}) }));
    if (!draft.title.trim()) return setError("Give the film a title or working title.");
    if (comps.length < 3) return setError("Add at least three comparable titles.");
    if (draft.targetMarkets.length === 0) return setError("Choose at least one candidate market.");
    setError(null);
    onSubmit({ ...draft, title: draft.title.trim(), comps, constraints: { ...draft.constraints, excludedMarkets: [], excludedLanguages: [], subtitleFirst: false } });
  };

  const field = "field";
  return (
    <form onSubmit={submit} className="panel space-y-4 p-6 sm:p-8" aria-label="Film brief">
      <h2 className="display text-3xl">Your film</h2>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <label className="space-y-1 text-xs text-bone-dim">Title or working title
          <input className={field} value={draft.title} maxLength={120} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-bone-dim">Original language
          <select className={field} value={draft.originalLanguage} onChange={(e) => set("originalLanguage", e.target.value)}>
            {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-xs text-bone-dim">Synopsis
        <textarea className={`${field} min-h-20`} value={draft.synopsis} maxLength={2000} onChange={(e) => set("synopsis", e.target.value)} />
      </label>
      <label className="block space-y-1 text-xs text-bone-dim">Genre
        <input className={field} value={draft.genre} maxLength={80} onChange={(e) => set("genre", e.target.value)} />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-xs text-bone-dim">Comparable titles (3–6; add a release year to disambiguate)</legend>
        {draft.comps.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_auto] gap-2">
            <input className={field} aria-label={`Comp ${i + 1} title`} value={c.name} maxLength={120} onChange={(e) => setComp(i, { name: e.target.value })} />
            <input className={field} aria-label={`Comp ${i + 1} year`} inputMode="numeric" placeholder="year" value={c.year ?? ""} onChange={(e) => setComp(i, { year: Number(e.target.value.replace(/\D/g, "").slice(0, 4)) || undefined })} />
            <button type="button" className="btn" disabled={draft.comps.length <= 3} onClick={() => set("comps", draft.comps.filter((_, j) => j !== i))} aria-label={`Remove comp ${i + 1}`}>✕</button>
          </div>
        ))}
        {draft.comps.length < 6 && <button type="button" className="btn" onClick={() => set("comps", [...draft.comps, { name: "" }])}>+ Add comp</button>}
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs text-bone-dim">Candidate markets</legend>
        <div className="flex flex-wrap gap-1.5">
          {MARKETS.map((m) => (
            <button key={m.code} type="button" aria-pressed={draft.targetMarkets.includes(m.code)} onClick={() => toggleMarket(m.code)} className={`rounded-full border px-2.5 py-1 text-xs ${draft.targetMarkets.includes(m.code) ? "border-violet bg-violet/15 text-bone" : "border-line-2 text-bone-dim"}`}>
              {m.name}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[0.7rem] text-bone-faint">Each new market costs about 10 Qloo calls on a cold cache (comps + 4 reference genres, 2 pages each).</p>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-bone-dim">Localization budget (USD)
          <input className={field} inputMode="numeric" value={draft.constraints.budgetUsd} onChange={(e) => set("constraints", { ...draft.constraints, budgetUsd: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </label>
        <label className="space-y-1 text-xs text-bone-dim">Max markets
          <input className={field} type="number" min={1} max={8} value={draft.constraints.maxMarkets} onChange={(e) => set("constraints", { ...draft.constraints, maxMarkets: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} />
        </label>
      </div>
      {error && <p className="text-sm text-rose" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">Run live research</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
