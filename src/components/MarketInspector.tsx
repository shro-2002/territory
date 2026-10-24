"use client";

import type { MarketResearch, Session } from "@/lib/agent/agent";
import { marketByCode, REFERENCE_SETS } from "@/lib/territory/markets";
import { catalogueSentence, localOriginSentence, NearbyTitles, SHOWN_PER_GROUP } from "@/lib/territory/nearby-titles";
import { candidateRank, excludedReason, formatLabel } from "@/lib/territory/view-model";
import { ProvenanceTag } from "./ProvenanceTag";

type Props = { session: Session; code: string };

function verdict(session: Session, code: string): { label: string; tone: string; why: string } {
  const decision = session.plan.markets.find((m) => m.code === code);
  const excluded = session.plan.excluded.find((e) => e.code === code);
  const r = session.research[code];
  const rank = candidateRank(session, code);
  const listed = rank ? `#${rank} on your candidate list` : "Suggested by Territory after a market was lost";
  if (decision) return { label: "In your plan", tone: "var(--accent)", why: `${listed} — ${formatLabel(decision.mode, decision.language)}.` };
  if (excluded) return { label: "Excluded", tone: "var(--removed-ink)", why: excludedReason(excluded.reason) };
  if (r) return { label: "Researched, not in plan", tone: "var(--evidence)", why: `${listed}; markets higher on your list fill the cap or budget first.` };
  return { label: "Not researched", tone: "var(--bone-faint)", why: "Territory researches a market when it is a candidate or when a revision needs a replacement." };
}

function TitleChips({ titles, label }: { titles: string[]; label: string }) {
  if (!titles.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs text-bone-faint">{label}</p>
      <ul className="flex flex-wrap gap-2">{titles.slice(0, SHOWN_PER_GROUP).map((t) => <li key={t} className="rounded-full border border-line-2 px-3 py-1 text-xs text-bone">{t}</li>)}</ul>
    </div>
  );
}

function NearbyTitlesBlock({ nearby, marketName }: { nearby: NearbyTitles; marketName: string }) {
  return (
    <div className="mt-5 border-t border-line pt-5">
      <p className="eyebrow mb-2">Titles near your comps in {marketName}</p>
      <p className="text-xs leading-relaxed text-bone-dim">{catalogueSentence(nearby, marketName)}</p>
      <p className="mt-2 text-sm leading-relaxed text-bone">{localOriginSentence(nearby, marketName)}</p>
      <TitleChips titles={nearby.international} label="Distinctive under the controls, produced elsewhere — relevant to the comps, not local matches" />
      <TitleChips titles={nearby.originUnknown} label="Distinctive under the controls, production origin not recorded" />
      <TitleChips titles={nearby.genericExamples} label={`Also returned for unrelated genres in ${marketName} (catalogue)`} />
      <p className="mt-3 text-xs text-bone-faint">Tested against {nearby.controlsTested} reference genres only. Proximity in Qloo is not evidence of buyer interest or audience demand.</p>
    </div>
  );
}

export function MarketInspector({ session, code }: Props) {
  const market = marketByCode(code);
  const r: MarketResearch | undefined = session.research[code];
  const v = verdict(session, code);
  const claims = session.claims.filter((c) => c.text.startsWith(`${market.name}:`));

  return (
    <aside className="panel flex h-full flex-col p-6" aria-label={`${market.name} inspector`} aria-live="polite">
      <p className="eyebrow">{market.language}</p>
      <h3 className="display mt-1 text-5xl leading-none">{market.name}</h3>
      <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs" style={{ color: v.tone, borderColor: `color-mix(in oklab, ${v.tone} 50%, transparent)` }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.tone }} />{v.label}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-bone-dim">{v.why}</p>

      {r?.evidenceGap && <p className="mt-5 rounded-xl border border-caution/40 bg-caution/10 p-3 text-sm text-bone">Research gap: {r.evidenceGap}. This is missing evidence, not a rejection; Territory still plans the market if your priorities and budget include it.</p>}

      {r && !r.evidenceGap && <NearbyTitlesBlock nearby={r.nearby} marketName={market.name} />}

      {r && !r.evidenceGap && (
        <details className="group mt-5 border-t border-line pt-4">
          <summary className="flex items-center justify-between text-sm text-bone-dim transition-colors hover:text-bone"><span>How this was checked</span><span aria-hidden className="transition-transform group-open:rotate-45">+</span></summary>
          <div className="mt-4 space-y-3 text-xs leading-relaxed text-bone-faint">
            <p>Qloo returned <span className="text-bone">{r.titlesFound}</span> titles associated with your comps when conditioned on {market.name}. Each was checked against the titles Qloo returns there for {r.nearby.controlsTested} unrelated genre sets ({REFERENCE_SETS.map((x) => x.id).join(", ")}).</p>
            <p>A title that also appears for an unrelated genre is the country&apos;s general catalogue. The rest are distinctive only relative to those genres. Production origin comes from Qloo&apos;s release-country field when it was recorded.</p>
            <p>None of this measures audience preference, buyer interest or demand, and it did not decide whether {market.name} is in your plan.</p>
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
