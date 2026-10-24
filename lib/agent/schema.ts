import { z } from "zod";
import { TOOL_IDS } from "@/lib/catalog.types";

const ZONE = z.enum(["<45", "58", "65", "84", "91/93", "100", "111", "130", ">145"]);

/** What the vision model must return. Strict structured output: every field required, unknowns = null. */
export const ExtractionSchema = z.object({
  category: z
    .enum(["SAK", "MULTITOOL", "ONEHAND", "SWISSCARD", "FIXED", "GARDEN", "OTHER_KNIFE", "NOT_A_KNIFE"])
    .describe("SAK = classic multi-blade pocket knife; MULTITOOL = plier-based tool; ONEHAND = single-blade folding knife with one-hand opening/lock"),
  category_confidence: z.number().describe("0..1"),
  brand: z.string().nullable().describe("Brand as read from logo/engraving, e.g. Victorinox, Wenger, Swiza, Leatherman, Gerber, Roxon. null if unreadable"),
  brand_evidence: z.string().nullable().describe("What you saw that indicates the brand, e.g. 'cross & shield logo on red scale', 'text SWIZA on tang'"),
  is_victorinox: z.boolean().nullable().describe("true if Victorinox (incl. Wenger-branded knives made by Victorinox), false if another brand, null if unsure"),
  model_guess: z.string().nullable().describe("Product/model name if you can identify it with reasonable certainty, else null"),
  visible_sku: z.string().nullable().describe("An article number visible in the image (e.g. on packaging), format like 1.3603 or 0.8226.22, else null"),
  open_state: z.enum(["open", "partly", "closed"]).describe("Are the tools folded out?"),
  tools_seen: z.array(z.enum(TOOL_IDS)).describe("Tools you can clearly see in the image. Only list what is visible."),
  tools_maybe: z.array(z.enum(TOOL_IDS)).describe("Tools you think are present but cannot see clearly"),
  sheet_visible: z.boolean().describe("Is the printed Product Match measuring sheet visible?"),
  length_zone: ZONE.nullable().describe("Zone label under the end of the handle on the measuring sheet; null without sheet"),
  length_zone_alt: ZONE.nullable().describe("Neighbouring zone if the handle ends within ~2 mm of a boundary, else null"),
  length_zone_confidence: z.number().describe("0..1, 0 if no sheet"),
  length_estimate_mm: z.number().nullable().describe("Handle length in mm: read from the mm ruler when the measuring sheet is visible, otherwise a rough estimate from a reference object, else null"),
  scale_color: z.string().nullable().describe("Colour of the handle scales in German, e.g. rot, schwarz, silber, blau"),
  scale_material: z.enum(["Cellidor", "Alox", "Holz", "Grip", "Metall", "Kunststoff", "Andere"]).nullable(),
  description: z.string().describe("One or two sentences in German describing the knife and its visible tools"),
  image_issues: z.array(z.enum(["blurry", "dark", "partial", "angled", "glare", "tools_hidden", "multiple_objects"])),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/** Answers the user gave to follow-up questions; sent to /api/score */
export const AnswersSchema = z.object({
  tools_yes: z.array(z.enum(TOOL_IDS)).default([]),
  tools_no: z.array(z.enum(TOOL_IDS)).default([]),
  length_zone: ZONE.nullable().default(null),
  rounds: z.number().default(0),
});
export type Answers = z.infer<typeof AnswersSchema>;
