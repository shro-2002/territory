"use client";

import { motion, useReducedMotion } from "motion/react";

import type { AgentInput } from "@/lib/agent/agent";
import { GlobeStage } from "./globe/GlobeStage";

export interface HeroProgress {
  done: number;
  total: number;
  latest: string | null;
}

type Props = {
  input: AgentInput;
  source: "live" | "mock" | null;
  isBusy: boolean;
  hasResult: boolean;
  progress: HeroProgress;
  pendingCodes: string[];
  planCodes: string[];
  onRun: () => void;
  onEdit: () => void;
};

const STEPS = [
  { n: "01", title: "Investigate", body: "What Qloo associates with your comps in each country — and what is just catalogue." },
  { n: "02", title: "Allocate", body: "Which language work to fund, and what it costs." },
  { n: "03", title: "Challenge", body: "Break the plan and watch it re-plan, with reasons." },
] as const;

export function Hero({ input, source, isBusy, hasResult, progress, pendingCodes, planCodes, onRun, onEdit }: Props) {
  const reduce = useReducedMotion();
  const enter = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, delay: 0.15 + i * 0.12, ease: [0.16, 1, 0.3, 1] as const } });
  return (
    <section id="top" className="relative isolate min-h-[100svh] overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-svh min-h-[640px]">
        <GlobeStage candidates={input.targetMarkets} pending={pendingCodes} plan={planCodes} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink via-ink/60 to-transparent lg:via-ink/25" />
      {/* Title-card vignette: darkens the frame edges like a projected image. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 120% 90% at 55% 45%, transparent 62%, var(--ink) 100%)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-ink to-transparent" />

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[1320px] flex-col justify-center px-4 pb-24 pt-[clamp(3rem,12svh,7rem)] sm:px-8">
        <div className="max-w-[640px]">
          <motion.p className="eyebrow flex items-center gap-3 text-gold" {...enter(0)}>
            <span aria-hidden className="h-px w-10 bg-gold/70" />
            Market strategy for independent film, built on Qloo taste data
          </motion.p>
          <motion.h1 className="display mt-6 text-[clamp(2.9rem,min(7.6vw,10svh),6rem)] leading-[0.98]" {...enter(1)}>
            Research the <em className="text-accent">world</em> before your film travels.
          </motion.h1>
          <motion.p className="mt-6 max-w-[34rem] text-base leading-relaxed text-bone-dim sm:text-lg" {...enter(2)}>
            Territory reads Qloo&apos;s taste graph in each country you are considering, separates generic catalogue from the few associations worth verifying, and fits your localization budget to your priorities — then re-plans the moment a distributor drops out or the budget shrinks.
          </motion.p>

          <motion.div className="mt-[clamp(1.5rem,4svh,2.25rem)] flex flex-wrap items-center gap-3" {...enter(3)}>
            {hasResult ? (
              <a href="#strategy" className="btn-primary">See the strategy</a>
            ) : (
              <button type="button" className="btn-primary" disabled={isBusy} onClick={onRun}>{isBusy ? "Investigating…" : "Reveal the strategy"}</button>
            )}
            <button type="button" className="btn" disabled={isBusy} onClick={onEdit}>{hasResult ? "Edit film brief" : "Use your own film"}</button>
            {hasResult && <button type="button" className="btn" disabled={isBusy} onClick={onRun}>Re-run research</button>}
          </motion.div>

          <div className="mt-6 min-h-6 text-sm" aria-live="polite">
            {isBusy ? (
              <p className="flex items-center gap-3 text-evidence">
                <span className="pulse h-2 w-2 rounded-full bg-evidence" />
                {progress.total > 0 ? `${progress.done} of ${progress.total} markets read` : "Working"}{progress.latest ? ` · ${progress.latest}` : ""}
              </p>
            ) : !hasResult ? (
              <p className="text-bone-faint">
                {source === "live" ? "Answers the showcase film in about two seconds from cached live Qloo responses." : source === "mock" ? "Running on labelled mock data — no Qloo evidence." : "\u00a0"}
              </p>
            ) : null}
          </div>
        </div>

        <motion.aside className="panel mt-14 max-w-[560px] p-5 sm:mt-20" aria-label="Film in this strategy" {...enter(4)}>
          <p className="eyebrow">The film being planned{input.genre ? `: ${input.genre}, ` : ", "}in {input.originalLanguage}</p>
          <h2 className="display mt-2 text-3xl leading-tight">{input.title}</h2>
          <p className="mt-2 line-clamp-2 text-sm text-bone-dim">{input.synopsis}</p>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Comparable titles">
            {input.comps.map((c) => (
              <li key={c.name} className="rounded-full border border-line-2 px-3 py-1 text-xs text-bone-dim">{c.name}{c.year ? <span className="text-bone-faint"> {c.year}</span> : null}</li>
            ))}
          </ul>
        </motion.aside>

        <ol className="mt-10 grid max-w-[880px] gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-ink-2/90 p-4">
              <span className="font-mono text-xs text-gold">{s.n}</span>
              <p className="mt-1 font-medium">{s.title}</p>
              <p className="mt-1 text-sm leading-snug text-bone-dim">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
