import type { Session } from "@/lib/agent/agent";
import { NEIGHBOURHOOD_SIZE } from "@/lib/territory/market-signal";
import { marketByCode } from "@/lib/territory/markets";
import { catalogueSentence, internationalSentence, localOriginSentence } from "@/lib/territory/nearby-titles";
import { MODE_REACH } from "@/lib/territory/planner";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const range = (r: [number, number] | null) => (r ? `${r[0].toFixed(2)}–${r[1].toFixed(2)}×` : "n/a");

/** Distributor research brief as Markdown, built only from the session's plan, research, revisions and claims. */
export function briefMarkdown(s: Session, source: "live" | "mock"): string {
  const L: string[] = [];
  const c = s.input.constraints;
  const scored = Object.values(s.research).filter((r) => r.score !== null).sort((a, b) => b.score! - a.score!);
  const thin = Object.values(s.research).filter((r) => r.score === null);

  L.push(`# Distribution research brief — ${s.input.title}`, "");
  L.push(`Territory v${s.version} · ${source === "live" ? "Qloo hackathon API evidence" : "**MOCK DATA — not Qloo evidence**"} · ${new Date().toISOString().slice(0, 10)} · status: ${s.status}`, "");
  L.push(`> ${s.input.synopsis}`, "", `${s.input.genre || "Film"} · original language ${s.input.originalLanguage} · unreleased · represented by comps: ${s.comps.map((x) => `${x.input.name}${x.input.year ? ` (${x.input.year})` : ""}${x.status !== "resolved" ? ` [${x.status}]` : ""}`).join(", ")}.`, "");

  L.push("## 1. Executive recommendation", "");
  if (!s.plan.markets.length) L.push("No market can be recommended: evidence is insufficient or the constraints exclude every supported market.", "");
  else {
    const loc = s.plan.markets.filter((m) => m.mode !== "original");
    L.push(`Prioritise **${s.plan.markets.map((m) => m.name).join(", ")}** for initial sales outreach and festival positioning.`);
    L.push(`Localization: ${loc.length ? loc.map((m) => `${m.mode} for ${m.name} (${m.language})`).join("; ") : "none needed (original-language markets only)"}. Spend ${usd(s.plan.totalCostUsd)} of a ${usd(c.budgetUsd)} budget, ${s.plan.markets.length}/${c.maxMarkets} markets.`);
    const strongest = scored[0];
    if (strongest) L.push(`Strongest taste alignment: ${marketByCode(strongest.code).name} (${strongest.score!.toFixed(2)}×, range ${range(strongest.scoreRange)}).`);
    L.push(s.violations.length ? `**Constraint violations:** ${s.violations.join("; ")}.` : "All budget, market-cap, exclusion and subtitle constraints verified independently.", "");
  }

  L.push("## 2. Market-by-market evidence", "", `Lift = share of the comps' ${NEIGHBOURHOOD_SIZE} closest Qloo titles that stay in the top ${NEIGHBOURHOOD_SIZE} when conditioned on the market, divided by the same share for reference genres there. Range = lift when each reference genre is left out.`, "");
  L.push("| Market | Decision | Lift | Range | Confidence | Overlap | Nearby titles also returned for unrelated genres |", "|---|---|---|---|---|---|---|");
  for (const r of scored) {
    const m = marketByCode(r.code);
    const d = s.plan.markets.find((x) => x.code === r.code);
    const ex = s.plan.excluded.find((x) => x.code === r.code);
    L.push(`| ${m.name} | ${d ? `**${d.mode}**` : ex ? `not selected (${ex.reason})` : "not selected (lower value)"} | ${r.score!.toFixed(2)}× | ${range(r.scoreRange)} | ${r.confidence} | ${r.overlap}/${NEIGHBOURHOOD_SIZE} | ${r.nearby.controlsTested ? `${r.nearby.genericCount}/${NEIGHBOURHOOD_SIZE}` : "not tested"} |`);
  }
  L.push("", "**Nearby titles vs same-country genre controls.** A title Qloo also returns for an unrelated reference genre in the same country is that country's catalogue, not a comparable for this film. A title absent from those lists is distinctive only relative to the genres tested.", "");
  for (const r of scored) {
    const name = marketByCode(r.code).name;
    const catalogue = r.nearby.controlsTested ? catalogueSentence(r.nearby, name) : "";
    L.push(`- **${name}:** ${[catalogue, localOriginSentence(r.nearby, name), internationalSentence(r.nearby)].filter(Boolean).join(" ")}`);
  }
  if (thin.length) L.push("", `**Insufficient evidence (not scored, never recommended):** ${thin.map((r) => `${marketByCode(r.code).name} — ${r.insufficientReason}`).join("; ")}.`);
  L.push("");

  L.push("## 3. Localization plan and constraints", "");
  for (const l of s.plan.languages) L.push(`- ${l.language}: ${l.mode}, ${usd(l.costUsd)} (shared by ${s.plan.markets.filter((m) => m.language === l.language).map((m) => m.name).join(", ")})`);
  L.push(`- Constraints: budget ${usd(c.budgetUsd)}; max ${c.maxMarkets} markets${c.excludedMarkets.length ? `; excluded markets ${c.excludedMarkets.map((x) => marketByCode(x).name).join(", ")}` : ""}${c.excludedLanguages.length ? `; excluded languages ${c.excludedLanguages.join(", ")}` : ""}${c.subtitleFirst ? "; subtitle-first" : ""}.`, "");

  if (s.revisions.length) {
    L.push("## 4. Strategy revisions", "");
    for (const r of s.revisions) {
      L.push(`**v${r.version}** — invalidated: ${r.invalidated.join("; ") || "none"}. Evidence reused for ${r.reusedMarkets.length - r.retainedUnusable.length} markets; newly researched: ${r.newlyResearched.map((x) => marketByCode(x).name).join(", ") || "none"}.`);
      for (const ch of r.changes) L.push(`- ${ch.driver === "summary" ? "" : `[${ch.driver}] `}${ch.text}`);
      L.push("");
    }
  }

  L.push(`## ${s.revisions.length ? 5 : 4}. Assumptions and uncertainty`, "");
  L.push(
    "- Taste portability measures relative cultural overlap. It is **not** a box-office, audience-size, revenue or distribution-demand forecast, and it has not been validated against release outcomes.",
    "- Location-conditioned Qloo movie data covers titles released 2018 or later; older comps contribute only through their post-2018 neighbourhood.",
    "- An unreleased film is represented entirely by its comps; different comps can change every result.",
    `- Localization costs are user-entered assumptions. Subtitles are modelled as reaching ${Math.round(MODE_REACH.subtitle * 100)}% of a dub's value (assumption, not measured).`,
    "- Original-language markets carry no localization cost, so the planner favours them when lifts are similar.",
    "- Each market uses one primary language; multilingual markets are simplified.",
    "",
  );

  L.push(`## ${s.revisions.length ? 6 : 5}. Suggested next steps`, "");
  L.push(
    `- Pitch buyers in ${s.plan.markets.slice(0, 3).map((m) => m.name).join(", ") || "the shortlisted markets"} only after checking the nearby titles above with local acquisitions staff: Qloo proximity is not evidence of buyer or audience demand.`,
    "- Validate the shortlist with a sales agent or distributor active in each territory, and check rights availability and festival premiere strategy.",
    "- Get real localization quotes to replace the cost assumptions; re-run Territory with them.",
    ...(thin.length ? [`- Gather market-specific evidence for ${thin.map((r) => marketByCode(r.code).name).join(", ")} (local festival data, comparable releases) before ruling them out.`] : []),
    "- Re-run with alternative comps to test how sensitive the shortlist is to comp choice.",
    "",
  );

  L.push("## Evidence ledger", "");
  for (const cl of s.claims) L.push(`- [${cl.provenance}${cl.callIds.length ? ` · ${cl.callIds.length} Qloo call${cl.callIds.length > 1 ? "s" : ""}` : ""}] ${cl.text}`);
  L.push("", "_Generated by Territory (Qloo Agentic Hackathon 2026). Qloo data is used under the hackathon terms; this brief contains derived aggregates and title names only._");
  return L.join("\n");
}
