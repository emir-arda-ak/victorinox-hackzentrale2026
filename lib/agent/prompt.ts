import { TOOL_META } from "@/lib/catalog";

const toolList = Object.entries(TOOL_META)
  .filter(([id]) => id !== "other")
  .map(([id, m]) => `- ${id}: ${m.label}`)
  .join("\n");

export const EXTRACTION_PROMPT = `You analyse a photo of a pocket knife or multitool for a Victorinox product-matching tool used by sales staff.
Return ONLY facts you can see. Never guess specifications.

1. Category: classic Swiss-Army-style multi-blade knife (SAK), plier-based multitool (MULTITOOL), single-blade folding knife (ONEHAND), credit-card tool (SWISSCARD), fixed blade (FIXED), garden/pruning knife (GARDEN), other knife (OTHER_KNIFE), or not a knife at all (NOT_A_KNIFE).
2. Brand: read logos and engravings. Victorinox uses a cross inside a shield; knives branded Wenger are also made by Victorinox (is_victorinox = true). If you cannot read the brand, use null.
3. Tools: map every tool to this vocabulary (ids). Put clearly visible tools in tools_seen, unclear ones in tools_maybe. A tool that is folded in and not visible must NOT be listed in tools_seen.
${toolList}
Notes: tweezers, toothpick, pin and pen sit inside the scales and are often hidden. A bottle opener usually carries a flat screwdriver tip (list bottle_opener, and screwdriver only if a separate screwdriver blade exists).

4. Length via measuring sheet: if the knife lies on the printed "Product Match Messunterlage" (red start bar on the left, grey zone band with large numbers under a black rail), the butt end of the handle touches the red bar. Find where the OTHER end of the handle/scales ends — ignore opened blades and tools that extend beyond it. Report the label of the zone band cell directly below that point (one of "58", "65", "84", "91/93", "100", "111", "130", "<45", ">145") as length_zone, plus length_zone_confidence (0–1). If the end is within ~2 mm of a dashed zone boundary, also report the neighbouring zone as length_zone_alt. Without a sheet, set length_zone to null and give a rough length_estimate_mm only if a reference object makes it possible.

5. If an article number is visible (packaging, label), copy it to visible_sku.
Answer in the requested JSON format. The description is in German.`;
