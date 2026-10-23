"use client";

import type { MarketResearch, Session } from "@/lib/agent/agent";
import { NEIGHBOURHOOD_SIZE } from "@/lib/territory/market-signal";
import { marketByCode, REFERENCE_SETS } from "@/lib/territory/markets";
import { evidenceOf, excludedReason, formatLabel, readingOf } from "@/lib/territory/view-model";
import { ProvenanceTag } from "./ProvenanceTag";
import { EvidenceMeter } from "./ui/Meter";

type Props = { session: Session; code: string };

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-ink">
      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: tone }} />
    </span>
  );
}

function verdict(session: Session, code: string): { label: string; tone: string; why: string } {
  const decision = session.plan.markets.find((m) => m.code === code);
  const excluded = session.plan.excluded.find((e) => e.code === code);
  const r = session.research[code];
  if (decision) return { label: "In your plan", tone: "var(--accent)", why: `Selected — ${formatLabel(decision.mode, decision.language)}.` };
  if (excluded) return { label: "Excluded", tone: "var(--removed-ink)", why: excludedReason(excluded.reason) };
  if (r?.score === null) return { label: "Insufficient evidence", tone: "var(--caution)", why: r.insufficientReason ?? "Too little overlapping data." };
  if (r) return { label: "Researched, not selected", tone: "var(--evidence)", why: "Other markets add more value within your market cap and budget." };
  return { label: "Not researched", tone: "var(--bone-faint)", why: "Territory researches a market when it is a candidate or when a revision needs a replacement." };
}

export function MarketInspector({ session, code }: Props) {
  const market = marketByCode(code);
  const r: MarketResearch | undefined = session.research[code];
  const v = verdict(session, code);
  const claims = session.claims.filter((c) => c.text.startsWith(`${market.name}:`) || c.text.startsWith(`${market.name}-specific`));
  const reading = r ? readingOf(r) : null;

  return (
    <aside className="panel flex h-full flex-col p-6" aria-label={`${market.name} inspector`} aria-live="polite">
      <p className="eyebrow">{market.language}</p>
      <h3 className="display mt-1 text-5xl leading-none">{market.name}</h3>
      <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs" style={{ color: v.tone, borderColor: `color-mix(in oklab, ${v.tone} 50%, transparent)` }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.tone }} />{v.label}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-bone-dim">{v.why}</p>

      {r && reading && r.score !== null && (
        <div className="mt-5 space-y-3 border-t border-line pt-5 text-sm">
          <p className="leading-relaxed text-bone">{reading.overlap}</p>
          <p className="text-bone-dim">{reading.comparisonLabel}.</p>
          <div className="flex items-center justify-between gap-3"><span className="text-bone-faint">Confidence</span><EvidenceMeter strength={evidenceOf(r)} /></div>
          {r.scoreRange && <p className="text-xs leading-relaxed text-bone-faint">Overlap ratio {r.score.toFixed(2)}× (from {r.scoreRange[0].toFixed(2)} to {r.scoreRange[1].toFixed(2)} depending on which genre baseline is left out). Markets whose ranges overlap are not meaningfully different. This is taste overlap, not proof of buyer or audience demand.</p>}
        </div>
      )}
      {r?.score === null && <p className="mt-5 rounded-xl border border-caution/40 bg-caution/10 p-3 text-sm text-bone">This is a gap in the evidence, not a rejection. Territory will not plan this market without more data.</p>}

      {r && r.localNeighbours.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Local titles near your comps</p>
          <ul className="flex flex-wrap gap-2">{r.localNeighbours.map((t) => <li key={t} className="rounded-full border border-line-2 px-3 py-1 text-xs text-bone">{t}</li>)}</ul>
          <p className="mt-2 text-xs text-bone-faint">From Qloo: close to your comps in {market.name}, absent from the global list. Useful as buyer-facing local comparables.</p>
        </div>
      )}

      {r && r.score !== null && (
        <details className="group mt-5 border-t border-line pt-4">
          <summary className="flex items-center justify-between text-sm text-bone-dim transition-colors hover:text-bone"><span>How this was measured</span><span aria-hidden className="transition-transform group-open:rotate-45">+</span></summary>
          <div className="mt-4 space-y-3 text-xs">
            <p className="text-bone-dim"><span className="text-bone">{r.overlap}</span> of your comps&apos; {NEIGHBOURHOOD_SIZE} closest titles stay in the top {NEIGHBOURHOOD_SIZE} when Qloo conditions on {market.name}.</p>
            <div className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3">
              <span className="text-accent">Your comps</span><Bar value={r.portability} max={Math.max(r.portability, ...Object.values(r.referencePortabilities), 0.01)} tone="var(--accent)" /><span className="text-right tabular-nums">{Math.round(r.portability * 100)}%</span>
              {REFERENCE_SETS.map((ref) => {
                const val = r.referencePortabilities[ref.id];
                return (
                  <div key={ref.id} className="contents">
                    <span className="capitalize text-bone-faint">{ref.id}</span>
                    {val === undefined ? <span className="text-bone-faint">n/a</span> : <Bar value={val} max={Math.max(r.portability, ...Object.values(r.referencePortabilities), 0.01)} tone="var(--line-2)" />}
                    <span className="text-right tabular-nums text-bone-faint">{val === undefined ? "" : `${Math.round(val * 100)}%`}</span>
                  </div>
                );
              })}
            </div>
            <p className="leading-relaxed text-bone-faint">Reference genres show how much any taste survives in this market; dividing by their mean removes market-wide effects. Relative cultural overlap — not audience size, box office or demand.</p>
            {r.fallback && <p className="text-bone-dim">Fallback used: {r.fallback}.</p>}
          </div>
        </details>
      )}

      {claims.length > 0 && (
        <details className="group mt-4 border-t border-line pt-4">
          <summary className="flex items-center justify-between text-sm text-bone-dim transition-colors hover:text-bone"><span>Audit trail · {claims.length} claims</span><span aria-hidden className="transition-transform group-open:rotate-45">+</span></summary>
          <ul className="mt-4 space-y-2">
            {claims.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-2 text-xs text-bone-dim">
                <ProvenanceTag provenance={c.provenance} />
                <span>{c.callIds.length ? `${c.callIds.length} Qloo calls · ` : ""}{c.callIds.slice(0, 3).join(", ")}{c.callIds.length > 3 ? "…" : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
