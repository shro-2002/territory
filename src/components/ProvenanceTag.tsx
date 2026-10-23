import type { Provenance } from "@/lib/agent/claims";

const LABEL: Record<Provenance, string> = {
  qloo: "Qloo evidence",
  external: "External source",
  user: "Your input",
  hypothesis: "Model assumption",
  insufficient: "Insufficient",
};

export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wider"
      style={{ borderColor: `color-mix(in oklab, var(--prov-${provenance}) 55%, transparent)`, color: `var(--prov-${provenance})` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--prov-${provenance})` }} />
      {LABEL[provenance]}
    </span>
  );
}
