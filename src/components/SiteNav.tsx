"use client";

const LINKS = [
  { href: "#strategy", label: "Strategy" },
  { href: "#budget", label: "Budget" },
  { href: "#atlas", label: "Atlas" },
  { href: "#war-room", label: "War Room" },
  { href: "#evidence", label: "Evidence" },
] as const;

type Props = { source: "live" | "mock"; hasResult: boolean; onExport: () => void };

export function SiteNav({ source, hasResult, onExport }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-8">
        <a href="#top" className="display text-2xl tracking-tight">Territory</a>
        {hasResult && (
          <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="rounded-full px-3 py-2 text-sm text-bone-dim transition-colors hover:text-bone">{l.label}</a>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          <span className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-wider sm:inline-flex ${source === "live" ? "border-teal/40 text-teal" : "border-warm/50 text-warm"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${source === "live" ? "bg-teal pulse" : "bg-warm"}`} />
            {source === "live" ? "Live Qloo API" : "Mock data — not Qloo evidence"}
          </span>
          {hasResult && <button type="button" className="btn" onClick={onExport}>Export briefing</button>}
        </div>
      </div>
    </header>
  );
}
