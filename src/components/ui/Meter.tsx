import type { EvidenceStrength } from "@/lib/territory/view-model";

const SEGMENTS: Record<EvidenceStrength, number> = { moderate: 2, low: 1, none: 0 };
const TONE: Record<EvidenceStrength, string> = { moderate: "var(--evidence)", low: "var(--caution)", none: "var(--line-2)" };
const LABEL: Record<EvidenceStrength, string> = { moderate: "Moderate", low: "Low", none: "None" };

/** Three-notch evidence gauge. Never fills the third notch: no market's evidence is "high". */
export function EvidenceMeter({ strength }: { strength: EvidenceStrength }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-bone-dim" role="img" aria-label={`Confidence: ${LABEL[strength]}`}>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-5 rounded-full" style={{ background: i < SEGMENTS[strength] ? TONE[strength] : "var(--line-2)" }} />
        ))}
      </span>
      {LABEL[strength]}
    </span>
  );
}
