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
  // Your candidate order, then any Territory-suggested reserves; never sorted by a Qloo measure.
  const markets = Object.values(session.research);
  return (
    <section aria-labelledby="atlas-title" className="mx-auto max-w-[1320px] px-4 pt-32 sm:px-8">
      <SectionHead id="atlas" eyebrow="Cultural market atlas" title={<span id="atlas-title">Every candidate market, and what Qloo found there.</span>}>
        Select a country to see what Qloo associates with your comps there: which titles are general catalogue, which are distinctive under four genre controls, and what to investigate next.
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
            {markets.map((r) => (
              <button key={r.code} type="button" className="chip tabular-nums" aria-pressed={selected === r.code} onClick={() => onSelect(r.code)}>
                {marketByCode(r.code).name}{r.evidenceGap && <span className="text-caution"> · gap</span>}
              </button>
            ))}
          </div>
        </div>
        {selected ? <MarketInspector key={`${selected}-${session.version}`} session={session} code={selected} /> : <p className="panel p-6 text-sm text-bone-dim">Select a market on the map.</p>}
      </div>
    </section>
  );
}
