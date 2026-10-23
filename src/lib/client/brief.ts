import type { Session } from "@/lib/agent/agent";
import { marketByCode } from "@/lib/territory/markets";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Distributor briefing as Markdown, built only from the session's plan, revisions and claim ledger. */
export function briefMarkdown(s: Session, source: "live" | "mock"): string {
  const lines: string[] = [];
  lines.push(`# Territory briefing — ${s.input.title}`, "");
  lines.push(`Version ${s.version} · ${s.status} · ${source === "live" ? "live Qloo research" : "MOCK DATA — not Qloo evidence"} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "");
  lines.push(`> ${s.input.synopsis}`, "", `Original language: ${s.input.originalLanguage}. Comps: ${s.comps.map((c) => `${c.input.name} (${c.status})`).join(", ")}.`, "");
  lines.push("## Recommended release plan", "", "| Market | Localization | Taste-portability lift |", "|---|---|---|");
  for (const m of s.plan.markets) lines.push(`| ${m.name} | ${m.mode} | ${m.score.toFixed(2)}× |`);
  lines.push("", `Localization spend ${usd(s.plan.totalCostUsd)} of ${usd(s.input.constraints.budgetUsd)} budget; at most ${s.input.constraints.maxMarkets} markets.`);
  lines.push(s.violations.length ? `**Constraint violations:** ${s.violations.join("; ")}` : "Independent constraint check: passed.", "");
  if (s.plan.excluded.length) lines.push("Not selected: " + s.plan.excluded.map((e) => `${marketByCode(e.code).name} (${e.reason})`).join("; ") + ".", "");
  if (s.revisions.length) {
    lines.push("## Revisions", "");
    for (const r of s.revisions) lines.push(`**v${r.version}** — invalidated: ${r.invalidated.join("; ") || "none"}. Reused research: ${r.reusedMarkets.length} markets. New research: ${r.newlyResearched.join(", ") || "none"}. Changes: ${r.changes.join("; ")}.`, "");
  }
  lines.push("## Evidence ledger", "");
  for (const c of s.claims) lines.push(`- [${c.provenance}${c.callIds.length ? ` · ${c.callIds.join(", ")}` : ""}] ${c.text}`);
  lines.push("", "_Taste portability measures how much of the comps' taste neighbourhood survives when Qloo conditions on a market, relative to reference genres there. It is not a box-office, audience-size or revenue forecast. Location-conditioned Qloo movie data covers 2018+ releases._");
  return lines.join("\n");
}
