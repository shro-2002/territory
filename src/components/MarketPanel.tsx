"use client";

import type { MarketResearch, Session } from "@/lib/agent/agent";
import { NEIGHBOURHOOD_SIZE } from "@/lib/territory/market-signal";
import { marketByCode, REFERENCE_SETS } from "@/lib/territory/markets";
import { ProvenanceTag } from "./ProvenanceTag";

type Props = {
  session: Session;
  code: string;
};

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-ink">
      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: tone }} />
    </span>
  );
}

export function MarketPanel({ session, code }: Props) {
  const market = marketByCode(code);
  const r: MarketResearch | undefined = session.research[code];
  const decision = session.plan.markets.find((m) => m.code === code);
  const excluded = session.plan.excluded.find((e) => e.code === code);
  const claims = session.claims.filter((c) => c.text.startsWith(`${market.name}:`) || c.text.startsWith(`${market.name}-specific`));

  if (!r) {
    return (
      <section className="panel p-5">
        <p className="eyebrow">{market.language}</p>
        <h3 className="font-display text-2xl">{market.name}</h3>
        <p className="mt-3 text-sm text-bone-dim">Not researched in this version. Territory researches a market when it is a candidate or when a revision needs a replacement.</p>
      </section>
    );
  }
  const maxPortability = Math.max(r.portability, ...Object.values(r.referencePortabilities), 0.01);
  const verdictText = decision ? `In plan · ${decision.mode}` : excluded ? `Not selected · ${excluded.reason}` : "Researched";
  return (
    <section className="panel rise p-5" aria-label={`${market.name} evidence`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{market.language} · {verdictText}</p>
          <h3 className="font-display text-3xl leading-tight">{market.name}</h3>
        </div>
        <div className="text-right">
          <p className="font-display text-4xl text-amber tabular-nums">{r.score === null ? "—" : `${r.score.toFixed(2)}×`}</p>
          <p className="text-[0.7rem] text-bone-faint">taste-overlap lift vs reference genres</p>
          {r.scoreRange && (
            <p className="text-[0.7rem] text-bone-dim">
              range {r.scoreRange[0].toFixed(2)}–{r.scoreRange[1].toFixed(2)}× · <span className={r.confidence === "low" ? "text-ember" : "text-bone"}>{r.confidence} confidence</span>
            </p>
          )}
        </div>
      </div>

      {r.score === null ? (
        <p className="mt-4 rounded-lg border border-ember/40 bg-ember/10 p-3 text-sm text-bone">Insufficient evidence: {r.insufficientReason}. Territory will not plan this market.</p>
      ) : (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-bone-dim">
            <span className="text-bone">{r.overlap}</span> of the comps&apos; {NEIGHBOURHOOD_SIZE} closest titles stay in the top {NEIGHBOURHOOD_SIZE} when Qloo conditions on {market.name}.
          </p>
          <div className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-xs">
            <span className="text-amber">Your comps</span>
            <Bar value={r.portability} max={maxPortability} tone="var(--amber)" />
            <span className="text-right tabular-nums">{Math.round(r.portability * 100)}%</span>
            {REFERENCE_SETS.map((ref) => (
              <Bar3 key={ref.id} label={ref.id} value={r.referencePortabilities[ref.id]} max={maxPortability} />
            ))}
          </div>
          <p className="text-xs text-bone-faint">Reference genres measure how much any taste survives in this market; dividing by their mean removes market-wide effects. The range shows the lift when each reference genre is left out. Markets whose ranges overlap are not meaningfully different. Relative cultural overlap — not audience size, box office or demand.</p>
          {r.fallback && <p className="text-xs text-bone-dim">Fallback used: {r.fallback}.</p>}
        </div>
      )}

      {r.localNeighbours.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">{market.name}-specific titles near your comps</p>
          <ul className="flex flex-wrap gap-2">
            {r.localNeighbours.map((t) => (
              <li key={t} className="rounded-full border border-line-2 px-3 py-1 text-xs text-bone">{t}</li>
            ))}
          </ul>
          <p className="mt-2 text-[0.7rem] text-bone-faint">From Qloo: in this market&apos;s neighbourhood, absent globally. Useful as buyer-facing local comps.</p>
        </div>
      )}

      <div className="mt-5 space-y-2 border-t border-line pt-4">
        {claims.map((c) => (
          <p key={c.id} className="flex gap-2 text-xs text-bone-dim">
            <ProvenanceTag provenance={c.provenance} />
            <span>{c.callIds.length ? `${c.callIds.length} Qloo calls · ` : ""}{c.callIds.slice(0, 3).join(", ")}{c.callIds.length > 3 ? "…" : ""}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

function Bar3({ label, value, max }: { label: string; value: number | undefined; max: number }) {
  return (
    <>
      <span className="capitalize text-bone-faint">{label}</span>
      {value === undefined ? <span className="text-bone-faint">n/a</span> : <Bar value={value} max={max} tone="var(--line-2)" />}
      <span className="text-right tabular-nums text-bone-faint">{value === undefined ? "" : `${Math.round(value * 100)}%`}</span>
    </>
  );
}
