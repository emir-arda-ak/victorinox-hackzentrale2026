import { CATALOG, CROSSREF, SCORING, TOOL_META, zoneFor } from "@/lib/catalog";
import type { CatalogModel, ToolId, Visibility } from "@/lib/catalog.types";
import type { Answers, Extraction } from "./schema";
import { BLADE_TWIN, confirmedNonBladeWorking, excessScore, functionalCoverageScore, handlingScore, isWorking, negativeToolScore } from "./functional";

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
  /** function-first diagnostics (labels only for tools that were actually observed / confirmed) */
  functional?: {
    coverage: number | null; // weighted recall of observed working functions, null = none observed
    confirmed_coverage: number | null;
    confirmed_tool_count: number;
    matched_working_tools: string[];
    partially_matched_working_tools: string[];
    uncertain_matched_working_tools: string[];
    missing_working_tools: string[]; // confirmed on the photo / by the user, not in this model
    matched_handling_attributes: string[];
  };
};

/** victorinox = identify the exact own model; competitor/unknown = recommend a functional replacement */
export type MatchMode = "victorinox" | "competitor" | "unknown";
export const modeFor = (ex: Extraction): MatchMode =>
  ex.is_victorinox === true ? "victorinox" : ex.is_victorinox === false ? "competitor" : "unknown";

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

const visW = (t: ToolId) => SCORING.tool_visibility_weight[(TOOL_META[t]?.visibility ?? "normal") as Visibility];
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Legacy net tool fit for direct Victorinox identification only. */
function toolScore(c: CatalogModel, ex: Extraction, ans: Answers) {
  const main = new Set<ToolId>(c.tools);
  const sub = new Set<ToolId>(c.subtools);
  const no = new Set<ToolId>(ans.tools_no.filter(t => t !== "other"));
  const seen = new Set<ToolId>([...ex.tools_seen, ...ans.tools_yes].filter(t => !no.has(t) && t !== "other"));
  const maybe = new Set<ToolId>(ex.tools_maybe.filter((t) => !seen.has(t) && !no.has(t) && t !== "other"));
  let sum = 0;
  let norm_ = 0;
  for (const t of seen) {
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
    if (main.has(t) || sub.has(t)) sum -= w * SCORING.tool_answered_no_penalty;
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
  if (c.length_mm == null) {
    // Missing catalog data is neither a length match nor a mismatch, in every category.
    return { s: 0, conf: 0 };
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

function categoryScore(c: CatalogModel, ex: Extraction, mode: MatchMode = "victorinox") {
  if (ex.category === "OTHER_KNIFE") return ["SAK", "ONEHAND", "FIXED", "GARDEN"].includes(c.category) ? 0 : -0.5;
  if (c.category === ex.category) return 1;
  // replacement: a neighbouring category is a soft preference, not a hard penalty that overrides confirmed tools
  if (mode !== "victorinox") {
    const soft = (SCORING.functional.category_soft as Record<string, number>)[`${ex.category}|${c.category}`];
    if (soft != null) return soft;
  }
  return -1;
}

/** Category used for scoring + trust in it. A "one-hand knife" with e.g. scissors + corkscrew is most likely a
 *  pocket knife: score it as SAK (MULTITOOL if pliers were seen) with reduced weight. The extraction itself is not changed. */
function effectiveCategory(ex: Extraction, ans: Answers): { category: Extraction["category"]; trust: number } {
  if (ans.category) return { category: ans.category, trust: 1 }; // corrected by the user
  const single = ex.category === "ONEHAND" || ex.category === "FIXED";
  if (single && confirmedNonBladeWorking(ex, ans) >= SCORING.functional.category_conflict_min_tools) {
    const pliers = !ans.tools_no.includes("pliers") && [...ex.tools_seen, ...ans.tools_yes].includes("pliers");
    return { category: pliers ? "MULTITOOL" : "SAK", trust: SCORING.functional.category_conflict_factor };
  }
  return { category: ex.category, trust: 1 };
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
  if (!ex.visible_sku || ex.is_victorinox === false) return 0;
  const s = ex.visible_sku.trim().toUpperCase();
  if (!s) return 0;
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

/** verified cross-reference table (data/crossref.json): exact brand + model -> Victorinox model */
function crossrefScore(c: CatalogModel, ex: Extraction) {
  if (!ex.brand || !ex.model_guess) return 0;
  const b = norm(ex.brand), m = norm(ex.model_guess);
  return CROSSREF.some((e) => norm(e.brand) === b && norm(e.model) === m && e.preferred_match === c.id) ? 1 : 0;
}

/** unvalidated user feedback ("this knife -> that model"), 0..1. NOT product data: in replacement mode it is
 *  gated by the candidate's functional coverage, so it cannot override a large confirmed-function mismatch. */
function learnedScore(c: CatalogModel, ex: Extraction, learned: LearnedRule[]) {
  let s = 0;
  for (const r of learned) {
    if (r.victorinox_id !== c.id) continue;
    s = Math.max(s, ruleSimilarity(ex, r) * Math.min(1, 0.6 + 0.2 * r.count));
  }
  return s;
}

function materialScore(c: CatalogModel, ex: Extraction) {
  const cm = c.scale_material ?? (c.category === "SAK" ? "Cellidor" : null);
  if (!ex.scale_material || ex.scale_material === "Andere" || !cm) return 0;
  return cm.toLowerCase().startsWith(ex.scale_material.toLowerCase()) ? 1 : 0;
}

function colorScore(c: CatalogModel, ex: Extraction) {
  const col = (ex.scale_color ?? "").toLowerCase();
  if (!col) return 0;
  return c.variants.some((v) => v.color && (col.includes(v.color.name) || v.color.name.includes(col))) ? 1 : 0;
}

/** how much the photo actually shows (0..1): few visible tools or folded knife = weak evidence */
function evidence(ex: Extraction, ans: Answers) {
  const seen = new Set([...ex.tools_seen, ...ans.tools_yes].filter(t => t !== "other" && !ans.tools_no.includes(t)));
  let w = 0;
  for (const t of seen) w += visW(t);
  const base = Math.min(1, w / 3);
  const open = ex.open_state === "open" ? 1 : ex.open_state === "partly" ? 0.8 : 0.5;
  const answered = [...ans.tools_yes, ...ans.tools_no].some(t => t !== "other");
  return Math.min(1, Math.max(0.2, base * open + (answered ? 0.1 : 0)));
}

function toolRows(c: CatalogModel, ex: Extraction, ans: Answers): ToolRow[] {
  const seen = new Set<ToolId>([...ex.tools_seen, ...ans.tools_yes].filter(t => !ans.tools_no.includes(t)));
  const cand = new Set<ToolId>([...c.tools, ...c.subtools]);
  const rows: ToolRow[] = [];
  for (const t of seen) {
    if (t === "other") continue;
    rows.push({ tool: t, label: TOOL_META[t].label, status: cand.has(t) ? "both" : "missing" });
  }
  for (const t of cand) {
    if (seen.has(t) || t === "other") continue;
    rows.push({ tool: t, label: TOOL_META[t].label, status: ans.tools_no.includes(t) ? "only_victorinox" : "unknown" });
  }
  const order: Record<ToolRowStatus, number> = { both: 0, missing: 1, only_victorinox: 2, unknown: 3 };
  return rows.sort((a, b) => order[a.status] - order[b.status]);
}

export function score(ex: Extraction, ans: Answers, learned: LearnedRule[] = []): Ranking {
  const excluded = new Set<string>(SCORING.excluded_categories);
  const mode = modeFor(ex);
  const M = (SCORING.modes as Record<MatchMode, Record<string, number>>)[mode];
  const eff = mode === "victorinox" ? { category: ans.category ?? ex.category, trust: 1 } : effectiveCategory(ex, ans);
  const catTrust = eff.trust;
  const exCat: Extraction = eff.category === ex.category ? ex : { ...ex, category: eff.category };
  // category counts fully only while there is little functional evidence (0–1 tools on one photo);
  // with several confirmed working functions it shrinks to the mode's base weight
  const no = new Set(ans.tools_no);
  const confirmedWorking = new Set([...ex.tools_seen, ...ans.tools_yes].filter((t) => isWorking(t) && !no.has(t))).size;
  const strength = Math.min(1, confirmedWorking / SCORING.functional.strong_evidence_tools);
  const catW = M.category_low_evidence + (M.category - M.category_low_evidence) * strength;
  const scored = CATALOG.filter((c) => !excluded.has(c.category)).map((c) => {
    const len = lengthScore(c, ex, ans);
    const fc = functionalCoverageScore(c, ex, ans);
    const hd = handlingScore(c, ex, ans);
    // Neither manual recommendations nor feedback can bypass the functional evidence.
    const supportCoverage = Math.min(fc.coverage ?? 0, fc.confirmedCoverage ?? fc.coverage ?? 0);
    const supportGate = mode === "victorinox" ? 1 : Math.pow(supportCoverage, SCORING.functional.learned_gate_power);
    const parts: Record<string, number> = {
      // Compatibility: tools retains legacy fit for identification; replacement uses explicit negatives only.
      tools: M.tools * (mode === "victorinox" ? toolScore(c, ex, ans) : negativeToolScore(c, ans)),
      // Confirmed recall is primary. Any number of uncertain tools shares one small bonus.
      functional_coverage: M.functional_coverage * (fc.confirmedCoverage == null ? 0 : 2 * fc.confirmedCoverage - 1),
      uncertain_tools: mode === "victorinox" ? 0 : SCORING.functional.maybe_bonus * (fc.uncertainCoverage ?? 0),
      handling_similarity: M.handling * (hd.score ?? 0),
      excess: M.excess * excessScore(c, ex, ans),
      length: M.length * len.s * (0.4 + 0.6 * len.conf),
      category: catW * categoryScore(c, exCat, mode) * ex.category_confidence * catTrust,
      model_name: M.model_name * nameScore(c, ex),
      visible_sku: M.visible_sku * skuScore(c, ex),
      crossref: M.crossref * crossrefScore(c, ex) * supportGate,
      learned: M.learned * learnedScore(c, ex, learned) * supportGate,
      material: M.material * materialScore(c, ex),
      color: M.color * colorScore(c, ex),
    };
    for (const k of Object.keys(parts)) if (!Number.isFinite(parts[k])) parts[k] = 0;
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return { c, total, parts, fc, hd };
  });
  // ties: prefer the standard model (more variants = core model, special editions have few), then stable by id
  scored.sort((a, b) => b.total - a.total || b.c.variants.length - a.c.variants.length || a.c.id.localeCompare(b.c.id));

  const top = scored.slice(0, 10);
  // functional twins (same tools, same length, e.g. Swiss Tool vs. Swiss Tool BS) are not real competitors for confidence
  const sig = (c: CatalogModel) => `${c.category}|${c.length_mm}|${[...c.tools].sort().join(",")}`;
  const rival = top.slice(1).find((x) => sig(x.c) !== sig(top[0].c));
  const margin = top[0] ? top[0].total - (rival?.total ?? 0) : 0;
  // HEURISTIC reliability score (0..1), not a calibrated probability.
  // Category, appearance and either kind of reference never count as fit or separation.
  const replacement = mode !== "victorinox";
  const reliabilityScore = (x: typeof scored[number]) => replacement
    ? x.parts.functional_coverage + x.parts.tools + x.parts.handling_similarity + x.parts.length
    : x.parts.tools + x.parts.length + x.parts.model_name + x.parts.visible_sku;
  const maxPossible = replacement ? M.functional_coverage + M.handling + M.length : M.tools + M.length + M.model_name;
  const fit = Math.max(0, Math.min(1, (top[0] ? reliabilityScore(top[0]) : 0) / Math.max(1, maxPossible)));
  // Compare against all distinct rivals, using fit alone. A category/reference bonus cannot inflate separation.
  const fitRivals = top[0] ? scored.slice(1).filter(x => sig(x.c) !== sig(top[0].c)) : [];
  const reliabilityMargin = top[0]
    ? reliabilityScore(top[0]) - Math.max(0, ...fitRivals.map(reliabilityScore)) : 0;
  const sep = 1 - Math.exp(-SCORING.confidence.margin_scale * Math.max(0, reliabilityMargin));
  const C = SCORING.confidence;
  let confidence = (C.fit_weight * fit + (1 - C.fit_weight) * sep) *
    (C.minimum_evidence_factor + (1 - C.minimum_evidence_factor) * evidence(ex, ans));
  if (top[0]) {
    const provided = new Set([...top[0].c.tools, ...top[0].c.subtools]);
    const missing = mode === "victorinox"
      ? [...new Set([...ex.tools_seen, ...ans.tools_yes])].filter(t => t !== "other" && !ans.tools_no.includes(t) &&
        !provided.has(t) && !(BLADE_TWIN[t] && provided.has(BLADE_TWIN[t]!))).length
      : top[0].fc.missing.length;
    confidence *= Math.max(0.3, 1 - SCORING.confidence.missing_tool_factor * missing);
    if (replacement) confidence = Math.min(confidence, top[0].fc.confirmedCoverage ?? C.no_confirmed_max);
    // a top spot that only exists thanks to unvalidated feedback must not be reported as "high"
    if (top[0].parts.learned > 0 && rival && top[0].total - top[0].parts.learned <= rival.total)
      confidence = Math.min(confidence, SCORING.confidence.high - 0.01);
  }
  // contradictory extraction (category vs. tools): never "high"
  if (catTrust < 1) confidence = Math.min(confidence, SCORING.confidence.high - 0.01);
  if (mode === "victorinox" && top[0] && M.visible_sku > 0 && skuScore(top[0].c, ex) === 1)
    confidence = Math.max(confidence, C.exact_sku_floor);
  confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;

  const reasons: string[] = [];
  const zoneUsed = ans.length_zone ?? ex.length_zone;
  reasons.push(zoneUsed ? `Länge ${ans.length_zone ? "angegeben" : "gemessen"}: Zone ${zoneUsed}` : "Länge nicht gemessen");
  reasons.push(ex.brand ? `Marke erkannt: ${ex.brand}` : "Marke nicht erkannt");
  if (ex.open_state !== "open") reasons.push("Werkzeuge teilweise verdeckt");
  if (ex.image_issues.length) reasons.push(`Bild: ${ex.image_issues.join(", ")}`);
  if (margin < 0.3) reasons.push("Mehrere Modelle fast gleich passend");
  if (catTrust < 1) reasons.push(`Kategorie widerspricht den erkannten Werkzeugen – bewertet als ${eff.category === "SAK" ? "Taschenmesser" : "Multitool"}`);
  if (mode !== "victorinox") reasons.push("Ersatz nach Funktionen gewählt");
  const twins = top.slice(1).filter((x) => top[0] && sig(x.c) === sig(top[0].c)).length;
  if (twins) reasons.push(`${twins} funktional gleiche Variante${twins > 1 ? "n" : ""} (z. B. andere Farbe/Schale)`);

  const level = confidence >= SCORING.confidence.high ? "high" : confidence >= SCORING.confidence.medium ? "medium" : "low";
  return {
    candidates: top.map(({ c, total, parts, fc, hd }) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      length_mm: c.length_mm,
      image: c.image,
      score: Math.round(total * 100) / 100,
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      tools: toolRows(c, ex, ans),
      source: c.source,
      functional: {
        coverage: fc.coverage == null ? null : Math.round(fc.coverage * 100) / 100,
        confirmed_coverage: fc.confirmedCoverage == null ? null : Math.round(fc.confirmedCoverage * 100) / 100,
        confirmed_tool_count: fc.confirmed,
        matched_working_tools: fc.matched.map((t) => TOOL_META[t].label),
        partially_matched_working_tools: fc.partial.map((t) => TOOL_META[t].label),
        uncertain_matched_working_tools: fc.uncertainMatched.map((t) => TOOL_META[t].label),
        missing_working_tools: fc.missing.map((t) => TOOL_META[t].label),
        matched_handling_attributes: hd.matched.map((t) => TOOL_META[t].label),
      },
    })),
    confidence: Math.round(confidence * 100) / 100,
    level,
    reasons,
  };
}
