import { byId, SCORING, TOOL_META, ZONES } from "@/lib/catalog";
import type { ToolId } from "@/lib/catalog.types";
import type { Answers, Extraction } from "./schema";
import type { Ranking } from "./score";

export type Question =
  | { type: "photo_open"; text: string; reason: string }
  | { type: "length"; text: string; reason: string; options: { label: string; zone: string }[] }
  | { type: "tool"; text: string; reason: string; tool: ToolId };

/** Pick the ONE follow-up question that best separates the top candidates. Computed, not LLM-generated. */
export function clarify(ex: Extraction, ans: Answers, r: Ranking): Question | null {
  if (ans.rounds >= SCORING.clarify.max_rounds) return null;
  // 1) tools folded in -> ask for an opened photo (first round only), even if the score looks good
  if (ex.open_state === "closed" && ans.rounds === 0)
    return {
      type: "photo_open",
      text: "Bitte fotografieren Sie das Messer mit aufgeklappten Werkzeugen.",
      reason: "Auf dem Foto sind die Werkzeuge eingeklappt, die Kandidaten unterscheiden sich aber darin.",
    };
  if (r.level === "high" || r.confidence >= SCORING.clarify.ask_below_confidence) return null;
  const top = r.candidates.slice(0, SCORING.clarify.top_k).map((c) => byId.get(c.id)!);
  if (top.length < 2) return null;
  const names = (ids: string[]) => ids.slice(0, 2).map((id) => byId.get(id)?.name).join(" und ");

  // 2) length splits the candidates and is not measured reliably
  const lengthKnown = !!ans.length_zone || (ex.length_zone && ex.length_zone_confidence >= 0.6);
  const zonesOfTop = new Map<string, string[]>();
  for (const c of top) {
    if (c.length_mm == null) continue;
    const z = ZONES.find((z) => z.class_mm?.includes(c.length_mm!));
    if (z) zonesOfTop.set(z.label, [...(zonesOfTop.get(z.label) ?? []), c.id]);
  }
  if (!lengthKnown && zonesOfTop.size >= 2) {
    const opts = [...zonesOfTop.keys()].map((zone) => ({ label: `${zone} mm`, zone }));
    return {
      type: "length",
      text: "Wie lang ist die Schale (Griff, zugeklappt)?",
      reason: `Die passendsten Modelle unterscheiden sich vor allem in der Grösse (${opts.map((o) => o.label).join(" / ")}).`,
      options: opts,
    };
  }

  // 3) the tool with the best split among top candidates (max information)
  const asked = new Set<ToolId>([...ex.tools_seen, ...ans.tools_yes, ...ans.tools_no]);
  const weights = r.candidates.slice(0, top.length).map((c) => Math.exp(c.score));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let best: { t: ToolId; gain: number; has: string[]; not: string[] } | null = null;
  const toolsInTop = new Set<ToolId>(top.flatMap((c) => c.tools));
  for (const t of toolsInTop) {
    if (asked.has(t) || t === "other" || TOOL_META[t]?.visibility === "hidden") continue;
    let p = 0;
    const has: string[] = [];
    const not: string[] = [];
    top.forEach((c, i) => {
      if (c.tools.includes(t)) { p += weights[i] / wsum; has.push(c.id); } else not.push(c.id);
    });
    const gain = 1 - Math.abs(2 * p - 1);
    if (gain > 0.2 && (!best || gain > best.gain)) best = { t, gain, has, not };
  }
  if (best)
    return {
      type: "tool",
      tool: best.t,
      text: `Hat Ihr Messer: ${TOOL_META[best.t].label}?`,
      reason: `${names(best.has)} ${best.has.length > 1 ? "haben" : "hat"} dieses Werkzeug, ${names(best.not)} nicht.`,
    };
  return null;
}
