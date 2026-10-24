import { SCORING, TOOL_META } from "@/lib/catalog";
import type { CatalogModel, ToolId, Visibility } from "@/lib/catalog.types";
import type { Answers, Extraction } from "./schema";

/** Function-first matching helpers (pure, deterministic).
 *
 *  WORKING functions = everything you actually work with (blades, scissors, corkscrew, saws, openers, pliers, bits …).
 *  HANDLING attributes = how the knife is carried/opened: clip, thumb stud, lanyard hole, key ring.
 *  The key ring is deliberately HANDLING: it says nothing about what the knife can do, and almost every SAK has one.
 *  `other` is never counted (no useful information). */
export const HANDLING = new Set<ToolId>(["clip", "thumb_stud", "lanyard_hole", "key_ring"]);
export const isWorking = (t: ToolId) => t !== "other" && !HANDLING.has(t);

/** absolute blade size cannot be judged on a photo: a "large" blade may be the only (small) blade of a 58 mm knife */
export const BLADE_TWIN: Partial<Record<ToolId, ToolId>> = { blade_large: "blade_small", blade_small: "blade_large" };

/** blade variants that a plain main blade covers partially (a competitor's serrated or hooked edge is usually its main blade) */
export const BLADE_VARIANT: Partial<Record<ToolId, ToolId[]>> = {
  blade_serrated: ["blade_large", "blade_small"],
  blade_hook: ["blade_large", "blade_small"],
};

const F = SCORING.functional;
const visW = (t: ToolId) => SCORING.tool_visibility_weight[(TOOL_META[t]?.visibility ?? "normal") as Visibility];

export type FunctionalCoverage = {
  /** weighted recall of the observed working functions, 0..1; null = no working function observed (unknown, not perfect) */
  coverage: number | null;
  matched: ToolId[]; // observed working functions the candidate has (main tool, sub-tool or blade twin)
  missing: ToolId[]; // CONFIRMED working functions the candidate lacks (maybe-tools are not listed)
  partial: ToolId[]; // matched only as sub-tool or other blade size (not an exact match)
  confirmed: number; // number of confirmed working functions (seen or answered yes)
};

/** which observed tools count, and how strongly: user "yes" > seen by vision > maybe; "no" answers are excluded */
export function observedTools(ex: Extraction, ans: Answers) {
  const no = new Set<ToolId>(ans.tools_no);
  const w = new Map<ToolId, number>();
  for (const t of ex.tools_maybe) if (!no.has(t) && t !== "other") w.set(t, F.maybe_weight);
  for (const t of ex.tools_seen) if (!no.has(t) && t !== "other") w.set(t, 1);
  for (const t of ans.tools_yes) if (t !== "other") w.set(t, F.answer_weight);
  return w; // tool -> confidence weight
}

/** credit of a candidate for one observed tool: 1 exact, sub-tool / other blade size = partial credit, else 0 */
function credit(c: CatalogModel, t: ToolId): number {
  if (c.tools.includes(t)) return 1;
  if (c.subtools.includes(t)) return SCORING.tool_seen_as_subtool_credit;
  const twin = BLADE_TWIN[t];
  if (twin && c.tools.includes(twin)) return SCORING.blade_size_swap_credit;
  if (BLADE_VARIANT[t]?.some((b) => c.tools.includes(b))) return F.blade_variant_credit;
  return 0;
}

/** -1..0: penalty for a replacement that is far bigger than the observed functional profile (e.g. Swiss Champ XXL
 *  "covers" everything). Log-scaled, so a few extra tools cost almost nothing. Hypothesis, see report. */
export function excessScore(c: CatalogModel, ex: Extraction, ans: Answers): number {
  const observed = [...observedTools(ex, ans)].filter(([t, w]) => isWorking(t) && w >= 1).length;
  const candWorking = c.tools.filter(isWorking).length;
  const ratio = candWorking / Math.max(F.excess_min_tools, observed * F.excess_slack);
  return -Math.max(0, Math.min(1, Math.log2(Math.max(ratio, 1)) / F.excess_log_scale));
}

/** weighted recall of the working functions seen on the photo (what a replacement must be able to do) */
export function functionalCoverageScore(c: CatalogModel, ex: Extraction, ans: Answers): FunctionalCoverage {
  const obs = observedTools(ex, ans);
  let num = 0;
  let den = 0;
  let confirmed = 0;
  const matched: ToolId[] = [];
  const missing: ToolId[] = [];
  const partial: ToolId[] = [];
  for (const [t, conf] of obs) {
    if (!isWorking(t)) continue;
    const w = visW(t) * conf;
    const cr = credit(c, t);
    den += w;
    num += w * cr;
    const isConfirmed = conf >= 1;
    if (isConfirmed) confirmed++;
    if (cr > 0) {
      matched.push(t);
      if (cr < 1) partial.push(t);
    } else if (isConfirmed) missing.push(t);
  }
  return { coverage: den > 0 ? num / den : null, matched, missing, partial, confirmed };
}

/** overlap of carrying/opening attributes (clip, thumb stud, lanyard, key ring), 0..1; null = none observed.
 *  Kept separate so a clip + thumb stud can never compensate for missing working tools by default. */
export function handlingScore(c: CatalogModel, ex: Extraction, ans: Answers): { score: number | null; matched: ToolId[] } {
  const obs = observedTools(ex, ans);
  let num = 0;
  let den = 0;
  const matched: ToolId[] = [];
  for (const [t, conf] of obs) {
    if (!HANDLING.has(t)) continue;
    den += conf;
    if (c.tools.includes(t) || c.subtools.includes(t)) {
      num += conf;
      matched.push(t);
    }
  }
  return { score: den > 0 ? num / den : null, matched };
}

/** confirmed working tools that are NOT blades: several of them contradict a "single-blade" category guess */
export function confirmedNonBladeWorking(ex: Extraction, ans: Answers): number {
  const no = new Set(ans.tools_no);
  const s = new Set<ToolId>([...ex.tools_seen, ...ans.tools_yes].filter((t) => !no.has(t)));
  return [...s].filter((t) => isWorking(t) && !t.startsWith("blade_")).length;
}
