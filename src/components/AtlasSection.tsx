"use client";

import type { Session } from "@/lib/agent/agent";
import { marketByCode } from "@/lib/territory/markets";
import { Atlas } from "./Atlas";
import { MarketInspector } from "./MarketInspector";
import { SectionHead } from "./ui/SectionHead";

type Props = {
  session: Session;
  selected: string | null;
  pending: string[];
  onSelect: (code: string) => void;
};

export function AtlasSection({ session, selected, pending, onSelect }: Props) {
  const ranked = Object.values(session.research).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return (
    <section aria-labelledby="atlas-title" className="mx-auto max-w-[1320px] px-4 pt-32 sm:px-8">
      <SectionHead id="atlas" eyebrow="Cultural market atlas" title={<span id="atlas-title">Every candidate market, and why.</span>}>
        Select a country to see why it was chosen, left out, or could not be read — and the local titles Qloo finds near your comps.
      </SectionHead>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="panel p-4 sm:p-6">
          <Atlas
            research={session.research}
            planCodes={session.plan.markets.map((m) => m.code)}
            candidateCodes={session.input.targetMarkets}
            excludedCodes={session.input.constraints.excludedMarkets}
            selected={selected}
            onSelect={onSelect}
            pending={pending}
          />
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5" role="group" aria-label="Researched markets">
            {ranked.map((r) => (
              <button key={r.code} type="button" className="chip tabular-nums" aria-pressed={selected === r.code} onClick={() => onSelect(r.code)}>
                {marketByCode(r.code).name} <span className="text-bone-faint">{r.score === null ? "—" : `${r.score.toFixed(2)}×`}</span>
              </button>
            ))}
          </div>
        </div>
        {selected ? <MarketInspector key={`${selected}-${session.version}`} session={session} code={selected} /> : <p className="panel p-6 text-sm text-bone-dim">Select a market on the map.</p>}
      </div>
    </section>
  );
}
