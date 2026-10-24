import { CATALOG, CROSSREF, SCORING, TOOL_META, zoneFor } from "@/lib/catalog";
import type { CatalogModel, ToolId, Visibility } from "@/lib/catalog.types";
import type { Answers, Extraction } from "./schema";

export type ToolRowStatus = "both" | "only_victorinox" | "missing" | "unknown";
export type ToolRow = { tool: ToolId; label: string; status: ToolRowStatus };

export type Candidate = {
  id: string;
  name: string;
  category: string;
  length_mm: number | null;
  image: string;
  score: number;
  parts: Record<string, number>;
  tools: ToolRow[];
  source: CatalogModel["source"];
};

export type LearnedRule = {
  brand: string | null;
  model: string | null;
  category: string;
  zone: string | null;
  tools: string[];
  victorinox_id: string;
  count: number;
};

export type Ranking = {
  candidates: Candidate[]; // sorted, best first (top 10)
  confidence: number; // 0..1
  level: "high" | "medium" | "low";
  reasons: string[]; // why this confidence
};

const W = SCORING.weights;
const visW = (t: ToolId) => SCORING.tool_visibility_weight[(TOOL_META[t]?.visibility ?? "normal") as Visibility];
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** absolute blade size cannot be judged on a photo: a "large" blade may be the only (small) blade of a 58 mm knife */
const BLADE_TWIN: Partial<Record<ToolId, ToolId>> = { blade_large: "blade_small", blade_small: "blade_large" };

function toolScore(c: CatalogModel, ex: Extraction, ans: Answers) {
  const main = new Set<ToolId>(c.tools);
  const sub = new Set<ToolId>(c.subtools);
  const seen = new Set<ToolId>([...ex.tools_seen, ...ans.tools_yes]);
  const maybe = new Set<ToolId>(ex.tools_maybe.filter((t) => !seen.has(t)));
  const no = new Set<ToolId>(ans.tools_no);
  let sum = 0;
  let norm_ = 0;
  for (const t of seen) {
    if (t === "other") continue;
    const w = visW(t);
    norm_ += w;
    if (main.has(t)) sum += w;
    else if (sub.has(t)) sum += w * SCORING.tool_seen_as_subtool_credit;
    else if (BLADE_TWIN[t] && main.has(BLADE_TWIN[t])) sum += w * SCORING.blade_size_swap_credit;
    else sum -= w * SCORING.tool_seen_but_missing_penalty;
  }
  for (const t of maybe) {
    const w = visW(t) * SCORING.tool_maybe_factor;
    norm_ += w;
    if (main.has(t) || sub.has(t)) sum += w;
  }
  for (const t of no) {
    const w = visW(t);
    norm_ += w;
    if (main.has(t)) sum -= w * SCORING.tool_answered_no_penalty;
    else sum += w * 0.5;
  }
  // candidate tools that should have been visible but were not seen
  const unseenFactor = (SCORING.tool_unseen_penalty as Record<string, number>)[ex.open_state] ?? 0;
  for (const t of main) {
    if (seen.has(t) || maybe.has(t) || no.has(t) || t === "other") continue;
    const vis = TOOL_META[t]?.visibility;
    if (vis === "hidden") continue;
    const w = visW(t) * unseenFactor;
    norm_ += w;
    sum -= w;
  }
  return norm_ > 0 ? sum / norm_ : 0;
}

function lengthScore(c: CatalogModel, ex: Extraction, ans: Answers): { s: number; conf: number } {
  const zoneLabel = ans.length_zone ?? ex.length_zone;
  const zoneConf = ans.length_zone ? 1 : ex.length_zone_confidence;
  const mm = ans.length_zone ? null : ex.length_estimate_mm;
  // the model sometimes names a zone that contradicts its own ruler reading -> trust the mm reading then
  const llmZone = zoneFor(zoneLabel);
  const zoneContradicts = !ans.length_zone && !!mm && !!llmZone && (mm < llmZone.from - 6 || mm > llmZone.to + 6);
  const zone = zoneContradicts ? undefined : llmZone;
  const measured = !!zone?.class_mm || !!mm;
  if (c.length_mm == null) {
    // catalog has no length (multitools, one-hand knives, cards): neutral, but a measured SAK should not drift to them
    const s = measured && (c.category === "SAK" || c.category === "GARDEN") ? SCORING.length_unknown_candidate_score : 0;
    return { s, conf: measured ? Math.max(zoneConf, 0.5) : 0 };
  }
  const sig = SCORING.length_sigma_mm;
  let sZone: number | null = null;
  if (zone?.class_mm) {
    if (zone.class_mm.includes(c.length_mm)) sZone = 1;
    else if (!ans.length_zone && zoneFor(ex.length_zone_alt)?.class_mm?.includes(c.length_mm)) sZone = SCORING.length_alt_zone_score;
    else {
      // distance to the zone interval, not to its centre
      const d = Math.max(0, zone.from - c.length_mm, c.length_mm - zone.to) / sig;
      sZone = Math.max(-1, 1 - d);
    }
  }
  let sMm: number | null = null;
  if (mm) {
    const d = Math.abs(c.length_mm - mm) / (ex.sheet_visible ? sig : sig * 2);
    sMm = Math.max(-1, 1 - d);
  }
  if (sZone != null && sMm != null)
    return { s: SCORING.length_mm_weight * sMm + (1 - SCORING.length_mm_weight) * sZone, conf: zoneConf };
  if (sZone != null) return { s: sZone, conf: zoneConf };
  if (sMm != null) return { s: sMm, conf: ex.sheet_visible ? 0.7 : 0.4 };
  return { s: 0, conf: 0 };
}

function categoryScore(c: CatalogModel, ex: Extraction) {
  if (ex.category === "OTHER_KNIFE") return ["SAK", "ONEHAND", "FIXED", "GARDEN"].includes(c.category) ? 0 : -0.5;
  return c.category === ex.category ? 1 : -1;
}

function nameScore(c: CatalogModel, ex: Extraction) {
  if (!ex.is_victorinox || !ex.model_guess) return 0;
  const g = norm(ex.model_guess);
  const n = norm(c.name_catalog);
  if (!g) return 0;
  if (g === n) return 1;
  if (n.includes(g) || g.includes(n)) return 0.6;
  return 0;
}

function skuScore(c: CatalogModel, ex: Extraction) {
  if (!ex.visible_sku) return 0;
  const s = ex.visible_sku.trim().toUpperCase();
  if (c.id.toUpperCase() === s || c.variants.some((v) => v.sku.toUpperCase() === s)) return 1;
  // model prefix match, e.g. "1.3603" on a "1.3603.3" box
  return s.startsWith(c.id.toUpperCase()) || c.id.toUpperCase().startsWith(s) ? 0.5 : 0;
}

/** how similar a new extraction is to the one a learned rule was made from (0..1) */
export function ruleSimilarity(ex: Extraction, r: LearnedRule): number {
  if (r.category !== ex.category) return 0;
  const b1 = norm(ex.brand), b2 = norm(r.brand);
  if (b1 && b2 && b1 !== b2) return 0;
  if (norm(ex.model_guess) && norm(r.model) && norm(ex.model_guess) === norm(r.model)) return 1;
  const a = new Set<string>(ex.tools_seen), t = new Set<string>(r.tools);
  const inter = [...a].filter((x) => t.has(x)).length;
  const union = new Set([...a, ...t]).size;
  const jac = union ? inter / union : 0;
  // strict on purpose: a rule must not leak onto other knives with a similar tool set
  if (ex.length_zone && r.zone && ex.length_zone !== r.zone) return 0;
  const brandBonus = b1 && b1 === b2 ? 1 : 0.8;
  return jac >= 0.7 ? jac * brandBonus : 0;
}

function crossrefScore(c: CatalogModel, ex: Extraction, learned: LearnedRule[]) {
  let s = 0;
  if (ex.brand && ex.model_guess) {
    const b = norm(ex.brand), m = norm(ex.model_guess);
    for (const e of CROSSREF) if (norm(e.brand) === b && norm(e.model) === m && e.preferred_match === c.id) s = Math.max(s, 1);
  }
  for (const r of learned) {
    if (r.victorinox_id !== c.id) continue;
    s = Math.max(s, ruleSimilarity(ex, r) * Math.min(1, 0.6 + 0.2 * r.count));
  }
  return s;
}

function materialScore(c: CatalogModel, ex: Extraction) {
  const cm = c.scale_material ?? (c.category === "SAK" ? "Cellidor" : null);
  if (!ex.scale_material || !cm) return 0;
  return cm.toLowerCase().startsWith(ex.scale_material.toLowerCase()) ? 1 : 0;
}

function colorScore(c: CatalogModel, ex: Extraction) {
  const col = (ex.scale_color ?? "").toLowerCase();
  if (!col) return 0;
  return c.variants.some((v) => v.color && (col.includes(v.color.name) || v.color.name.includes(col))) ? 1 : 0;
}

/** how much the photo actually shows (0..1): few visible tools or folded knife = weak evidence */
function evidence(ex: Extraction, ans: Answers) {
  const seen = new Set([...ex.tools_seen, ...ans.tools_yes]);
  let w = 0;
  for (const t of seen) w += visW(t);
  const base = Math.min(1, w / 3);
  const open = ex.open_state === "open" ? 1 : ex.open_state === "partly" ? 0.8 : 0.5;
  return Math.max(0.2, base * open + (ans.tools_yes.length + ans.tools_no.length > 0 ? 0.1 : 0));
}

function toolRows(c: CatalogModel, ex: Extraction, ans: Answers): ToolRow[] {
  const seen = new Set<ToolId>([...ex.tools_seen, ...ans.tools_yes]);
  const cand = new Set<ToolId>([...c.tools, ...c.subtools]);
  const rows: ToolRow[] = [];
  for (const t of seen) {
    if (t === "other") continue;
    const twin = BLADE_TWIN[t];
    rows.push({ tool: t, label: TOOL_META[t].label, status: cand.has(t) || (!!twin && cand.has(twin)) ? "both" : "missing" });
  }
  for (const t of c.tools) {
    if (seen.has(t) || t === "other") continue;
    const hidden = TOOL_META[t]?.visibility === "hidden" && !ans.tools_no.includes(t);
    rows.push({ tool: t, label: TOOL_META[t].label, status: hidden ? "unknown" : "only_victorinox" });
  }
  const order: Record<ToolRowStatus, number> = { both: 0, missing: 1, only_victorinox: 2, unknown: 3 };
  return rows.sort((a, b) => order[a.status] - order[b.status]);
}

export function score(ex: Extraction, ans: Answers, learned: LearnedRule[] = []): Ranking {
  const excluded = new Set<string>(SCORING.excluded_categories);
  const scored = CATALOG.filter((c) => !excluded.has(c.category)).map((c) => {
    const len = lengthScore(c, ex, ans);
    const parts: Record<string, number> = {
      tools: W.tools * toolScore(c, ex, ans),
      length: W.length * len.s * (0.4 + 0.6 * len.conf),
      category: W.category * categoryScore(c, ex) * ex.category_confidence,
      model_name: W.model_name * nameScore(c, ex),
      visible_sku: W.visible_sku * skuScore(c, ex),
      crossref: W.crossref * crossrefScore(c, ex, learned),
      material: W.material * materialScore(c, ex),
      color: (W as Record<string, number>).color * colorScore(c, ex),
    };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return { c, total, parts };
  });
  // ties: prefer the standard model (more variants = core model, special editions have few)
  scored.sort((a, b) => b.total - a.total || b.c.variants.length - a.c.variants.length);

  const top = scored.slice(0, 10);
  // functional twins (same tools, same length, e.g. Swiss Tool vs. Swiss Tool BS) are not real competitors for confidence
  const sig = (c: CatalogModel) => `${c.category}|${c.length_mm}|${[...c.tools].sort().join(",")}`;
  const rival = top.slice(1).find((x) => sig(x.c) !== sig(top[0].c));
  const margin = top[0] ? top[0].total - (rival?.total ?? 0) : 0;
  const maxPossible = W.tools + W.length + W.category;
  const fit = Math.max(0, Math.min(1, (top[0]?.total ?? 0) / maxPossible));
  const sep = 1 - Math.exp(-SCORING.confidence.margin_scale * Math.max(0, margin));
  let confidence = (0.5 * fit + 0.5 * sep) * (0.4 + 0.6 * evidence(ex, ans));
  if (top[0]) {
    const missing = toolRows(top[0].c, ex, ans).filter((r) => r.status === "missing").length;
    confidence *= Math.max(0.3, 1 - SCORING.confidence.missing_tool_factor * missing);
  }
  if (top[0] && top[0].parts.visible_sku >= W.visible_sku) confidence = Math.max(confidence, 0.95);

  const reasons: string[] = [];
  const zoneUsed = ans.length_zone ?? ex.length_zone;
  reasons.push(zoneUsed ? `Länge ${ans.length_zone ? "angegeben" : "gemessen"}: Zone ${zoneUsed}` : "Länge nicht gemessen");
  reasons.push(ex.brand ? `Marke erkannt: ${ex.brand}` : "Marke nicht erkannt");
  if (ex.open_state !== "open") reasons.push("Werkzeuge teilweise verdeckt");
  if (ex.image_issues.length) reasons.push(`Bild: ${ex.image_issues.join(", ")}`);
  if (margin < 0.3) reasons.push("Mehrere Modelle fast gleich passend");
  const twins = top.slice(1).filter((x) => top[0] && sig(x.c) === sig(top[0].c)).length;
  if (twins) reasons.push(`${twins} funktional gleiche Variante${twins > 1 ? "n" : ""} (z. B. andere Farbe/Schale)`);

  const level = confidence >= SCORING.confidence.high ? "high" : confidence >= SCORING.confidence.medium ? "medium" : "low";
  return {
    candidates: top.map(({ c, total, parts }) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      length_mm: c.length_mm,
      image: c.image,
      score: Math.round(total * 100) / 100,
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      tools: toolRows(c, ex, ans),
      source: c.source,
    })),
    confidence: Math.round(confidence * 100) / 100,
    level,
    reasons,
  };
}
