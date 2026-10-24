import type { Session } from "@/lib/agent/agent";
import { NEIGHBOURHOOD_SIZE } from "@/lib/territory/market-signal";
import { marketByCode } from "@/lib/territory/markets";
import { catalogueSentence, internationalSentence, localOriginSentence } from "@/lib/territory/nearby-titles";
import { MODE_REACH } from "@/lib/territory/planner";
import { candidateRank, nextSteps } from "@/lib/territory/view-model";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Distributor research brief as Markdown, built only from the session's plan, research, revisions and claims. */
export function briefMarkdown(s: Session, source: "live" | "mock"): string {
  const L: string[] = [];
  const c = s.input.constraints;
  const researched = Object.values(s.research);
  const qualified = researched.filter((r) => !r.evidenceGap);
  const gaps = researched.filter((r) => r.evidenceGap);
  const priority = (code: string) => {
    const rank = candidateRank(s, code);
    return rank ? `#${rank}` : "suggested reserve";
  };

  L.push(`# Distribution research brief — ${s.input.title}`, "");
  L.push(`Territory v${s.version} · ${source === "live" ? "Qloo hackathon API evidence" : "**MOCK DATA — not Qloo evidence**"} · ${new Date().toISOString().slice(0, 10)} · status: ${s.status}`, "");
  L.push(`> ${s.input.synopsis}`, "", `${s.input.genre || "Film"} · original language ${s.input.originalLanguage} · unreleased · represented by comps: ${s.comps.map((x) => `${x.input.name}${x.input.year ? ` (${x.input.year})` : ""}${x.status !== "resolved" ? ` [${x.status}]` : ""}`).join(", ")}.`, "");

  L.push("## 1. Localization scenario", "");
  if (!s.plan.markets.length) L.push("No candidate market fits the budget, market cap and exclusions.", "");
  else {
    const loc = s.plan.markets.filter((m) => m.mode !== "original");
    L.push(`Within your constraints, Territory can cover **${s.plan.markets.map((m) => `${m.name} (${priority(m.code)})`).join(", ")}**, taken from your candidate list in your priority order.`);
    L.push(`Localization: ${loc.length ? loc.map((m) => `${m.mode} for ${m.name} (${m.language})`).join("; ") : "none needed (original-language markets only)"}. Spend ${usd(s.plan.totalCostUsd)} of a ${usd(c.budgetUsd)} budget, ${s.plan.markets.length}/${c.maxMarkets} markets.`);
    L.push("Qloo evidence did not rank or select these markets; it describes associations to investigate in each (section 2).");
    L.push(s.violations.length ? `**Constraint violations:** ${s.violations.join("; ")}.` : "All budget, market-cap, exclusion and subtitle constraints verified independently.", "");
  }

  L.push("## 2. Qloo cultural associations, market by market", "", `For each market, the ${NEIGHBOURHOOD_SIZE} titles Qloo associates with the comps there are checked against the same market's associations for four unrelated reference genres. Titles that also appear for those genres are the country's general catalogue. The rest are distinctive only relative to the genres tested. None of this measures audience preference or demand.`, "");
  L.push("| Market | Your priority | In scenario | Associated titles | General catalogue | Distinctive under controls | Verified local origin |", "|---|---|---|---|---|---|---|");
  for (const r of qualified) {
    const m = marketByCode(r.code);
    const d = s.plan.markets.find((x) => x.code === r.code);
    const ex = s.plan.excluded.find((x) => x.code === r.code);
    const c2 = r.nearby.counts;
    L.push(`| ${m.name} | ${priority(r.code)} | ${d ? `**${d.mode}**` : ex ? `no (${ex.reason})` : "no (cap or budget)"} | ${r.titlesFound} | ${r.nearby.genericCount} | ${c2.localOrigin + c2.international + c2.originUnknown} | ${c2.localOrigin}${c2.originUnknown ? ` (origin not recorded for ${c2.originUnknown})` : ""} |`);
  }
  L.push("");
  for (const r of qualified) {
    const name = marketByCode(r.code).name;
    L.push(`- **${name}:** ${[catalogueSentence(r.nearby, name), localOriginSentence(r.nearby, name), internationalSentence(r.nearby)].filter(Boolean).join(" ")}`);
  }
  if (gaps.length) L.push("", `**Research gaps (missing evidence, not a reason to drop a market):** ${gaps.map((r) => `${marketByCode(r.code).name} — ${r.evidenceGap}`).join("; ")}.`);
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
    "- Qloo associations are titles related to the comps, qualified against four genre controls. They are **not** audience preferences, demand, box-office or buyer-interest evidence.",
    "- An earlier taste-portability score was retired after an audit found it mostly measured each country's general catalogue; it plays no part in this brief.",
    "- Location-conditioned Qloo movie data covers titles released 2018 or later; older comps contribute only through their post-2018 neighbourhood.",
    "- An unreleased film is represented entirely by its comps; different comps can change every result.",
    `- Localization costs are user-entered assumptions. Subtitles are modelled as reaching ${Math.round(MODE_REACH.subtitle * 100)}% of a dub's value (assumption, not measured).`,
    "- Markets come from your candidate list in your priority order; original-language markets carry no localization cost.",
    "- Each market uses one primary language; multilingual markets are simplified.",
    "",
  );

  L.push(`## ${s.revisions.length ? 6 : 5}. Questions to investigate next`, "");
  L.push(...nextSteps(s).map((q) => `- ${q}`));
  if (gaps.length) L.push(`- Gather other evidence for ${gaps.map((r) => marketByCode(r.code).name).join(", ")} (local festival data, comparable releases); a research gap is not a reason to drop a market.`);
  L.push("- Re-run with alternative comps to see which associations depend on the comp choice.", "");

  L.push("## Evidence ledger", "");
  for (const cl of s.claims) L.push(`- [${cl.provenance}${cl.callIds.length ? ` · ${cl.callIds.length} Qloo call${cl.callIds.length > 1 ? "s" : ""}` : ""}] ${cl.text}`);
  L.push("", "_Generated by Territory (Qloo Agentic Hackathon 2026). Qloo data is used under the hackathon terms; this brief contains derived aggregates and title names only._");
  return L.join("\n");
}
