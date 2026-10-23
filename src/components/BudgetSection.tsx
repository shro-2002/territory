"use client";

import { motion, useReducedMotion } from "motion/react";

import type { Session } from "@/lib/agent/agent";
import { budgetView, MODE_LABEL, type DeferredOption } from "@/lib/territory/view-model";
import { AnimatedNumber } from "./ui/AnimatedNumber";
import { SectionHead } from "./ui/SectionHead";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const SEGMENT_COLORS = ["var(--violet)", "var(--teal)", "#84b4ff", "#e0a8ff", "#f0b27a"];
const KIND_LABEL: Record<DeferredOption["kind"], string> = { upgrade: "Not upgraded", excluded: "Left out", unselected: "Held back" };

export function BudgetSection({ session }: { session: Session }) {
  const reduce = useReducedMotion();
  const b = budgetView(session);
  return (
    <section aria-labelledby="budget-title" className="mx-auto max-w-[1320px] px-4 pt-32 sm:px-8">
      <SectionHead id="budget" eyebrow="Localization budget" title={<span id="budget-title">Where the localization money goes.</span>}>
        Subtitles and dubbing are the real cost of reaching a market. This is the language work the plan funds, what it supports, and what was deliberately left out.
      </SectionHead>

      <div className="panel p-6 sm:p-8">
        <dl className="grid gap-6 sm:grid-cols-3">
          <Figure label="Available" value={b.budget} />
          <Figure label="Planned spend" value={b.planned} tone="var(--violet)" />
          <Figure label="Remaining" value={b.remaining} tone={b.remaining < 0 ? "var(--rose)" : "var(--teal)"} />
        </dl>

        <div className="mt-8" role="img" aria-label={`${Math.round(b.usedShare * 100)}% of the budget is planned: ${b.actions.map((a) => `${a.language} ${usd(a.costUsd)}`).join(", ")}`}>
          <div className="flex h-4 overflow-hidden rounded-full bg-ink-3 ring-1 ring-line">
            {b.actions.map((a, i) => (
              <motion.span
                key={a.language}
                layout={!reduce}
                className="h-full border-r border-ink last:border-0"
                style={{ background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${(a.costUsd / Math.max(b.budget, 1)) * 100}%` }}
                transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[0.65rem] uppercase tracking-wider text-bone-faint"><span>$0</span><span>{usd(b.budget)}</span></div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div>
          <p className="eyebrow mb-3">Language actions funded</p>
          {b.actions.length === 0 ? (
            <p className="panel p-6 text-sm text-bone-dim">No localization is needed: every planned market plays in the original language.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {b.actions.map((a, i) => (
                <li key={a.language}>
                  <div className="panel h-full p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-sm text-bone-dim"><span className="h-2 w-2 rounded-full" style={{ background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }} />{MODE_LABEL[a.mode]}</p>
                        <h3 className="display mt-1 text-3xl">{a.language}</h3>
                      </div>
                      <p className="display text-3xl tabular-nums">{usd(a.costUsd)}</p>
                    </div>
                    <p className="mt-3 text-sm text-bone-dim">Supports <span className="text-bone">{a.markets.join(", ")}</span></p>
                    <p className="mt-1 text-xs text-bone-faint">{Math.round(a.share * 100)}% of planned spend</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {b.originalMarkets.length > 0 && (
            <p className="mt-3 rounded-2xl border border-dashed border-line-2 p-4 text-sm text-bone-dim"><span className="text-bone">No spend needed:</span> {b.originalMarkets.join(", ")} play in the original language.</p>
          )}
        </div>

        <div>
          <p className="eyebrow mb-3">Deferred and excluded options</p>
          {b.deferred.length === 0 ? (
            <p className="panel p-6 text-sm text-bone-dim">Nothing researched was left out.</p>
          ) : (
            <ul className="space-y-2">
              {b.deferred.map((d) => (
                <li key={`${d.kind}-${d.title}`} className="rounded-2xl border border-line bg-ink-2/70 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{d.title}{d.costUsd !== undefined ? ` · ${usd(d.costUsd)}` : ""}</span>
                    <span className="rounded-full border border-line-2 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-bone-faint">{KIND_LABEL[d.kind]}</span>
                  </div>
                  <p className="mt-1 leading-snug text-bone-dim">{d.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="mt-5 text-xs text-bone-faint">Costs are illustrative figures entered with the brief, not market prices. Subtitles are modelled as reaching 70% of a dub&apos;s value — an assumption, not a measurement.</p>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="display mt-2 text-5xl tabular-nums sm:text-6xl" style={tone ? { color: tone } : undefined}><AnimatedNumber value={value} /></dd>
    </div>
  );
}
