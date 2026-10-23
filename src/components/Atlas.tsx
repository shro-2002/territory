"use client";

import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";

import type { MarketResearch } from "@/lib/agent/agent";
import { MARKET_GEO } from "@/lib/territory/market-geo";
import { MARKETS } from "@/lib/territory/markets";

const WIDTH = 960;
const HEIGHT = 480;
const LIFT_FLOOR = 0.4;
const LIFT_SPAN = 1;

export type AtlasStatus = "plan" | "scored" | "insufficient" | "excluded" | "candidate" | "none";

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

export const STATUS_LABEL: Record<AtlasStatus, string> = {
  plan: "Selected",
  scored: "Researched",
  insufficient: "Insufficient evidence",
  excluded: "Excluded",
  candidate: "Awaiting research",
  none: "Not a candidate",
};

const lift = (score: number) => Math.max(0, Math.min(1, (score - LIFT_FLOOR) / LIFT_SPAN));

export function Atlas({ research, planCodes, candidateCodes, excludedCodes, selected, onSelect, pending = [] }: AtlasProps) {
  const tilt = useRef<HTMLDivElement>(null);
  const { paths, graticule, points } = useMemo(() => {
    const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    const fc = feature(topo, topo.objects.countries);
    const land = { ...fc, features: fc.features.filter((f) => f.properties?.name !== "Antarctica") };
    const projection = geoNaturalEarth1().fitExtent([[10, 10], [WIDTH - 10, HEIGHT - 10]], land);
    const gen = geoPath(projection);
    return {
      paths: land.features.map((f, i) => ({ id: String(f.id), key: `${f.id ?? "x"}-${i}`, d: gen(f) ?? "" })),
      graticule: gen(geoGraticule10()) ?? "",
      points: Object.fromEntries(Object.entries(MARKET_GEO).map(([code, ll]) => [code, projection(ll)])),
    };
  }, []);

  const byIso = new Map(MARKETS.map((m) => [m.iso, m]));
  const status = (code: string): AtlasStatus => {
    if (excludedCodes.includes(code)) return "excluded";
    if (planCodes.includes(code)) return "plan";
    const r = research[code];
    if (r) return r.score === null ? "insufficient" : "scored";
    return candidateCodes.includes(code) ? "candidate" : "none";
  };

  const onMove = (e: PointerEvent) => {
    const el = tilt.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 7}deg`);
    el.style.setProperty("--rx", `${-((e.clientY - r.top) / r.height - 0.5) * 5}deg`);
  };
  const onLeave = () => {
    tilt.current?.style.setProperty("--ry", "0deg");
    tilt.current?.style.setProperty("--rx", "0deg");
  };
  const keySelect = (code: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(code);
    }
  };

  return (
    <figure className="relative" onPointerMove={onMove} onPointerLeave={onLeave}>
      <div aria-hidden className="pointer-events-none absolute inset-x-[8%] bottom-[-6%] h-24 rounded-[50%] bg-accent-deep/25 blur-3xl" />
      <div ref={tilt} className="tilt">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full overflow-visible" role="group" aria-label="World map of candidate markets">
          <defs>
            <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--map-excluded)" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--removed)" strokeWidth="2" opacity="0.85" />
            </pattern>
            <linearGradient id="planFill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--map-selected-from)" />
              <stop offset="1" stopColor="var(--map-selected-to)" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path d={graticule} fill="none" stroke="var(--map-graticule)" strokeWidth={0.5} />
          {paths.map((p) => {
            const m = byIso.get(p.id);
            if (!m) return <path key={p.key} d={p.d} fill="var(--map-land)" stroke="var(--map-land-line)" strokeWidth={0.5} />;
            const st = status(m.code);
            const r = research[m.code];
            const fill =
              st === "plan" ? "url(#planFill)" : st === "excluded" ? "url(#hatch)" : st === "insufficient" ? "var(--map-insufficient)" : st === "scored" ? "var(--evidence)" : st === "candidate" ? "var(--map-candidate)" : "var(--map-land)";
            // Researched markets share one hue; opacity carries the overlap ratio.
            const fillOpacity = st === "scored" && r?.score != null ? 0.12 + lift(r.score) * 0.38 : 1;
            const clickable = st !== "none";
            const isSelected = selected === m.code;
            return (
              <path
                key={p.key}
                d={p.d}
                fill={fill}
                fillOpacity={fillOpacity}
                filter={st === "plan" ? "url(#glow)" : undefined}
                stroke={isSelected ? "var(--bone)" : st === "plan" ? "var(--map-selected-from)" : st === "insufficient" ? "var(--caution)" : st === "scored" ? "color-mix(in oklab, var(--evidence) 50%, transparent)" : st === "excluded" ? "var(--removed)" : "var(--map-land-line)"}
                strokeWidth={isSelected ? 2 : st === "plan" ? 1.2 : 0.7}
                strokeDasharray={st === "insufficient" ? "3 3" : undefined}
                className={`${clickable ? "cursor-pointer" : ""} ${pending.includes(m.code) ? "pulse" : ""} outline-none transition-[fill,stroke] duration-500 focus-visible:stroke-[var(--bone)]`}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? `${m.name}: ${STATUS_LABEL[st]}` : undefined}
                aria-pressed={clickable ? isSelected : undefined}
                onClick={clickable ? () => onSelect(m.code) : undefined}
                onKeyDown={clickable ? keySelect(m.code) : undefined}
              >
                <title>{`${m.name} — ${STATUS_LABEL[st]}${r?.score != null ? ` · ${r.score.toFixed(2)}×` : ""}`}</title>
              </path>
            );
          })}
          {planCodes.map((code, i) => {
            const pt = points[code];
            if (!pt) return null;
            return (
              <g key={code} transform={`translate(${pt[0]} ${pt[1]})`} className="pointer-events-none">
                <circle r={15} fill="none" stroke="var(--accent)" strokeWidth={1} opacity={0.5} />
                <circle r={11} fill="var(--map-marker-ink)" stroke="var(--map-selected-from)" strokeWidth={1.2} />
                <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={600} fill="var(--bone)">{i + 1}</text>
              </g>
            );
          })}
          {Object.keys(research).filter((c) => !planCodes.includes(c) && points[c] && (selected === c || research[c].score !== null)).map((code) => {
            const pt = points[code];
            return <circle key={code} cx={pt![0]} cy={pt![1]} r={selected === code ? 4.5 : 3} fill={research[code].score === null ? "var(--caution)" : "var(--evidence)"} stroke="var(--ink)" strokeWidth={1} className="pointer-events-none" />;
          })}
        </svg>
      </div>
      <figcaption className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-bone-dim">
        <Legend swatch={<span className="h-3 w-3 rounded-sm" style={{ background: "linear-gradient(135deg, var(--map-selected-from), var(--map-selected-to))" }} />} label="Selected" />
        <Legend swatch={<span className="h-3 w-3 rounded-sm bg-evidence/40 ring-1 ring-evidence/60" />} label="Researched" />
        <Legend swatch={<span className="h-3 w-3 rounded-sm ring-1 ring-caution" style={{ background: "var(--map-insufficient)" }} />} label="Insufficient evidence" />
        <Legend swatch={<span className="h-3 w-3 rounded-sm ring-1 ring-removed" style={{ background: "repeating-linear-gradient(45deg, var(--removed) 0 2px, var(--map-excluded) 2px 5px)" }} />} label="Excluded" />
        <span className="text-bone-faint">Brighter cyan = more of your comps&apos; taste carries over</span>
      </figcaption>
    </figure>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return <span className="flex items-center gap-2">{swatch}{label}</span>;
}
