"use client";

import { geoNaturalEarth1, geoPath } from "d3-geo";
import { useMemo } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";

import type { MarketResearch } from "@/lib/agent/agent";
import { MARKETS } from "@/lib/territory/markets";

const WIDTH = 960;
const HEIGHT = 470;

type Status = "plan" | "scored" | "insufficient" | "excluded" | "candidate" | "none";

export interface AtlasProps {
  research: Record<string, MarketResearch>;
  planCodes: string[];
  candidateCodes: string[];
  excludedCodes: string[];
  selected: string | null;
  onSelect: (code: string) => void;
  /** Markets currently being investigated (live progress). */
  pending?: string[];
}

/** Sequential amber ramp for lift; clamped to the 0.4–1.4× range seen live. */
function liftColor(score: number): string {
  const t = Math.max(0, Math.min(1, (score - 0.4) / 1.0));
  const l = 22 + t * 46;
  const c = 0.05 + t * 0.11;
  return `oklch(${l}% ${c} 70)`;
}

export function Atlas({ research, planCodes, candidateCodes, excludedCodes, selected, onSelect, pending = [] }: AtlasProps) {
  const { paths } = useMemo(() => {
    const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    const fc = feature(topo, topo.objects.countries);
    const projection = geoNaturalEarth1().fitExtent([[8, 8], [WIDTH - 8, HEIGHT - 8]], fc);
    const gen = geoPath(projection);
    return { paths: fc.features.filter((f) => f.properties?.name !== "Antarctica").map((f, i) => ({ id: String(f.id), key: `${f.id ?? "x"}-${i}`, d: gen(f) ?? "" })) };
  }, []);

  const byIso = new Map(MARKETS.map((m) => [m.iso, m]));
  const status = (code: string): Status => {
    if (excludedCodes.includes(code)) return "excluded";
    if (planCodes.includes(code)) return "plan";
    const r = research[code];
    if (r) return r.score === null ? "insufficient" : "scored";
    return candidateCodes.includes(code) ? "candidate" : "none";
  };

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label="World map of candidate markets coloured by taste-portability lift">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ember)" strokeWidth="2" opacity="0.55" />
          </pattern>
        </defs>
        {paths.map((p) => {
          const m = byIso.get(p.id);
          if (!m) return <path key={p.key} d={p.d} fill="#16140f" stroke="#221f19" strokeWidth={0.5} />;
          const st = status(m.code);
          const r = research[m.code];
          const fill = st === "excluded" ? "url(#hatch)" : st === "insufficient" ? "#2a1a14" : r?.score != null ? liftColor(r.score) : st === "candidate" ? "#4a3f2e" : "#16140f";
          const isPending = pending.includes(m.code);
          const clickable = st !== "none";
          return (
            <path
              key={p.key}
              d={p.d}
              fill={fill}
              stroke={selected === m.code ? "var(--bone)" : st === "plan" ? "var(--amber)" : "#3b352c"}
              strokeWidth={selected === m.code ? 2 : st === "plan" ? 1.6 : 0.7}
              className={`${clickable ? "cursor-pointer" : ""} ${isPending ? "pulse" : ""} transition-[fill] duration-500`}
              onClick={clickable ? () => onSelect(m.code) : undefined}
              aria-hidden
            >
              <title>{`${m.name}${r?.score != null ? ` — ${r.score.toFixed(2)}× lift` : st === "insufficient" ? " — insufficient evidence" : ""}`}</title>
            </path>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-bone-dim">
        <span className="flex items-center gap-2">
          <span className="h-2 w-16 rounded-full" style={{ background: `linear-gradient(90deg, ${liftColor(0.4)}, ${liftColor(1.4)})` }} />
          lift 0.4× → 1.4×
        </span>
        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm border-2 border-amber" />in plan</span>
        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: "#2a1a14" }} />insufficient evidence</span>
        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, var(--ember) 0 2px, transparent 2px 5px)" }} />excluded</span>
      </figcaption>
    </figure>
  );
}
