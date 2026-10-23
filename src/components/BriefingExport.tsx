"use client";

import type { Session } from "@/lib/agent/agent";

const SECTIONS = ["Executive recommendation", "Market-by-market evidence", "Localization plan & constraints", "Strategy revisions", "Assumptions & uncertainty", "Suggested next steps", "Full evidence ledger"];

export function BriefingExport({ session, onExport }: { session: Session; onExport: () => void }) {
  return (
    <section aria-labelledby="briefing-title" className="mx-auto max-w-[1320px] px-4 pt-32 sm:px-8">
      <div className="panel p-8 sm:p-12">
        <div className="grid items-center gap-10 lg:grid-cols-[3fr_2fr]">
          <div>
                        <h2 id="briefing-title" className="display mt-3 text-4xl leading-tight sm:text-5xl">Take the briefing to buyers and sales agents.</h2>
            <p className="mt-4 max-w-xl text-[0.95rem] leading-relaxed text-bone-dim">A distribution research briefing for {session.input.title}, built only from this session&apos;s plan, evidence and revisions — currently strategy v{session.version}. Every claim keeps its source.</p>
            <button type="button" className="btn-primary mt-8" onClick={onExport}>Export briefing (.md)</button>
          </div>
          <ol className="space-y-2" aria-label="Briefing contents">
            {SECTIONS.filter((s) => session.revisions.length > 0 || s !== "Strategy revisions").map((s, i) => (
              <li key={s} className="flex items-center gap-4 rounded-xl border border-line bg-ink/60 px-4 py-3 text-sm"><span className="w-5 text-right text-xs tabular-nums text-gold">{i + 1}</span>{s}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
