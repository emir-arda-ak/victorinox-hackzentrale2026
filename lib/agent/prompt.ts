import { TOOL_META } from "@/lib/catalog";

/** visual hints for the tools that are most often confused on photos */
const HINTS: Record<string, string> = {
  blade_large: "main cutting blade, long, one sharp edge",
  blade_small: "second, clearly shorter cutting blade",
  awl: "thin pointed spike (round or triangular, often with a sewing eye) WITHOUT a cutting edge – not a blade",
  corkscrew: "metal spiral",
  can_opener: "short hooked tool with a sharp curved point and a small flat screwdriver tip",
  bottle_opener: "flat lever with a hook/notch for crown caps, flat screwdriver tip at its end",
  screwdriver: "separate flat-tip screwdriver blade (not the tip of the bottle/can opener)",
  phillips: "cross-head screwdriver tip",
  scissors: "two small blades with a spring",
  saw_wood: "blade with coarse teeth",
  saw_metal: "file/blade with fine teeth or a file surface",
  hook: "multi-purpose hook (curved, blunt)",
  pliers: "plier jaws",
  magnifier: "small lens",
  nail_file: "flat file with a fine cross pattern, often with a nail-cleaner tip",
  key_ring: "metal ring at the end of the handle",
  tweezers: "tweezers stuck in the handle scale",
  toothpick: "plastic toothpick stuck in the handle scale",
};

const toolList = Object.entries(TOOL_META)
  .filter(([id]) => id !== "other")
  .map(([id, m]) => `- ${id}: ${m.label}${HINTS[id] ? ` — ${HINTS[id]}` : ""}`)
  .join("\n");

export const PROMPT_VERSION = "v3-2026-10-24-0935";

export const EXTRACTION_PROMPT = `You analyse a photo of a pocket knife or multitool for a Victorinox product-matching tool used by sales staff.
Return ONLY facts you can see. Never guess specifications.

1. Category – judge the WHOLE object, not the opened tool:
   - SAK: classic multi-tool pocket knife with several tools folded into the handle (thick handle with several layers). It stays SAK even if only one blade or tool is opened on the photo.
   - ONEHAND: single-blade folding knife with one-hand opening (thumb stud/hole) or pocket clip and NO other tools in the handle.
   - MULTITOOL: plier-based tool. SWISSCARD: credit-card tool. FIXED: fixed blade. GARDEN: garden/pruning knife. OTHER_KNIFE / NOT_A_KNIFE.

2. Brand – be strict:
   - is_victorinox = true ONLY if you clearly see the Victorinox emblem (white cross INSIDE A SHIELD outline) or readable text VICTORINOX or WENGER.
   - A plain cross WITHOUT a shield outline (e.g. a cross in a circle or square, a cross on a red handle) is used by other brands such as Swiza and souvenir knives. In that case set brand to the readable text or null and is_victorinox to null (or false if another brand is readable).
   - Read text stamped on the blade tang or printed on the handle letter by letter (e.g. SWIZA, WENGER, VICTORINOX, LEATHERMAN, GERBER, BÖKER, SPYDERCO). Only report a brand whose letters you can actually read or whose emblem you clearly see; never infer a brand from a red handle with a cross alone.
   - Put exactly what you saw into brand_evidence (e.g. "Text SWIZA auf der Klinge", "Kreuz im Kreis, kein Schild").

3. Tools – map every tool to this vocabulary (ids). Clearly visible tools go into tools_seen, unclear ones into tools_maybe. Folded-in tools that are not visible must NOT be listed.
${toolList}
Tweezers, toothpick, pin and pen sit inside the scales and are often hidden.

4. Length via the printed "Product Match Messunterlage" (red start bar on the LEFT, grey zone band with large numbers under a black rail, mm ruler below the band):
   - The butt end of the handle touches the red bar. Find where the OTHER end of the HANDLE (the scales / handle body) ends.
   - IGNORE opened blades and tools that stick out beyond the handle – their tips are NOT the end of the handle.
   - length_zone = label of the zone band cell directly below the handle end ("58", "65", "84", "91/93", "100", "111", "130", "<45", ">145"); length_zone_confidence 0–1; if the end is within ~2 mm of a dashed boundary also give the neighbouring zone as length_zone_alt.
   - length_estimate_mm = handle length in mm read from the mm ruler (always fill it when the sheet is visible). If the knife lies diagonally, estimate the handle length with the 10 mm grid.
   - Without a sheet: length_zone = null, length_estimate_mm only if a reference object makes it possible.

5. If an article number is visible (packaging, label), copy it to visible_sku.
Answer in the requested JSON format. The description is in German.`;
