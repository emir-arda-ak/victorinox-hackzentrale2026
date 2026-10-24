import type { Extraction } from "./schema";

/** Combine the extractions of several photos of the SAME knife (one tool opened per photo is typical):
 *  union of tools, majority category/brand, the most confident length measurement. Same logic as eval/run_eval.py. */
export function mergeExtractions(exs: Extraction[]): Extraction {
  if (exs.length === 1) return exs[0];
  const mode = <T,>(vals: (T | null | undefined)[]): T | null => {
    const counts = new Map<T, number>();
    for (const v of vals) if (v !== null && v !== undefined && v !== ("" as unknown as T)) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: T | null = null;
    let n = 0;
    for (const [v, c] of counts) if (c > n) { best = v; n = c; }
    return best;
  };
  const cat = new Map<Extraction["category"], number>();
  for (const e of exs) if (e.category !== "NOT_A_KNIFE") cat.set(e.category, (cat.get(e.category) ?? 0) + e.category_confidence);
  const category = [...cat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? exs[0].category;
  const seen = [...new Set(exs.flatMap((e) => e.tools_seen))];
  const maybe = [...new Set(exs.flatMap((e) => e.tools_maybe))].filter((t) => !seen.includes(t));
  const bestLen = [...exs].sort((a, b) => (b.length_zone_confidence ?? 0) - (a.length_zone_confidence ?? 0))[0];
  const est = exs.map((e) => e.length_estimate_mm).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const median = est.length ? (est.length % 2 ? est[(est.length - 1) / 2] : (est[est.length / 2 - 1] + est[est.length / 2]) / 2) : null;
  const vic = exs.map((e) => e.is_victorinox).filter((v): v is boolean => v !== null);
  const states = new Set(exs.map((e) => e.open_state));
  return {
    category,
    category_confidence: exs.reduce((s, e) => s + e.category_confidence, 0) / exs.length,
    brand: mode(exs.map((e) => e.brand)),
    brand_evidence: mode(exs.map((e) => e.brand_evidence)),
    is_victorinox: vic.length ? vic.filter(Boolean).length > vic.length / 2 : null,
    model_guess: mode(exs.map((e) => e.model_guess)),
    visible_sku: mode(exs.map((e) => e.visible_sku)),
    // "open" only if one single photo really shows the knife unfolded (>= 3 tools); one tool per photo -> unseen != missing
    open_state: exs.some((e) => e.open_state === "open" && e.tools_seen.length >= 3) ? "open" : states.has("open") || states.has("partly") ? "partly" : "closed",
    tools_seen: seen,
    tools_maybe: maybe,
    sheet_visible: exs.some((e) => e.sheet_visible),
    length_zone: bestLen.length_zone,
    length_zone_alt: bestLen.length_zone_alt,
    length_zone_confidence: bestLen.length_zone_confidence ?? 0,
    length_estimate_mm: median,
    scale_color: mode(exs.map((e) => e.scale_color)),
    scale_material: mode(exs.map((e) => e.scale_material)),
    description: exs.slice(0, 2).map((e) => e.description).filter(Boolean).join(" / "),
    image_issues: [],
  };
}
