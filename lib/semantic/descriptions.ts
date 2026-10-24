import { createHash } from "node:crypto";
import { CATALOG, TOOL_META, zoneFor } from "@/lib/catalog";
import type { CatalogModel, ToolId } from "@/lib/catalog.types";
import type { Answers, Extraction } from "@/lib/agent/schema";
import { HANDLING } from "@/lib/agent/functional";
import settings from "@/config/embeddings.json";

// Bump this whenever the description template or its interpretation changes.
export const DESCRIPTION_VERSION = "product-description-de-v2";
export const EMBEDDING_SETTINGS = settings;
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clean = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim();
const categories: Record<string, string> = {
  SAK: "Taschenmesser", MULTITOOL: "Zangen-Multitool", ONEHAND: "Einhand-Klappmesser",
  SWISSCARD: "Swiss Card", FIXED: "Feststehendes Messer", GARDEN: "Gartenmesser",
  OTHER: "Sonstiges Werkzeug", OTHER_KNIFE: "Anderes Messer",
};
const unique = (tools: ToolId[]) => [...new Set(tools)].filter(t => t !== "other").sort(compareIds);
const labels = (tools: ToolId[]) => unique(tools).map(t => clean(TOOL_META[t].label)).join(", ") || "nicht angegeben";

function describe(model: string | null, category: string, length: string | null, confirmed: ToolId[], maybe: ToolId[] = [], no: ToolId[] = []) {
  const text = [
    `Modell: ${model ? clean(model) : "unbekannt"}`,
    `Kategorie: ${categories[category] ?? "unbekannt"}`,
    `Grifflänge: ${length ?? "unbekannt"}`,
    `Arbeitsfunktionen: ${labels(confirmed.filter(t => !HANDLING.has(t)))}`,
    `Handhabung: ${labels(confirmed.filter(t => HANDLING.has(t)))}`,
    // Optional evidence fields are omitted when empty. Repeated empty boilerplate dilutes semantic content.
    ...(maybe.some(t => !HANDLING.has(t)) ? [`Unsichere Arbeitsfunktionen: ${labels(maybe.filter(t => !HANDLING.has(t)))}`] : []),
    ...(maybe.some(t => HANDLING.has(t)) ? [`Unsichere Handhabung: ${labels(maybe.filter(t => HANDLING.has(t)))}`] : []),
    ...(no.length ? [`Ausdrücklich verneinte Merkmale: ${labels(no)}`] : []),
  ].join("\n");
  // Conservative UTF-8 byte bound also bounds token count without adding a tokenizer dependency.
  if (Buffer.byteLength(text, "utf8") > settings.max_input_bytes) throw new Error("description_too_long");
  return text;
}

export type ProductDocument = { id: string; description: string; description_sha256: string };
export function catalogDocuments(catalog: CatalogModel[] = CATALOG): ProductDocument[] {
  if (!catalog.length || new Set(catalog.map(c => c.id)).size !== catalog.length) throw new Error("invalid_catalog_ids");
  return catalog.map(c => {
    if (!c.id.trim()) throw new Error("invalid_catalog_ids");
    const description = describe(c.name_catalog, c.category,
      c.length_mm != null ? `${c.length_mm} mm` : null, [...c.tools, ...c.subtools]);
    return { id: c.id, description, description_sha256: sha256(description) };
  }).sort((a, b) => compareIds(a.id, b.id));
}

/** Same fields and vocabulary as catalog documents; no invented absence, SKU or free-form vision prose. */
export function extractionDescription(ex: Extraction, ans: Answers): string | null {
  const category = ans.category ?? ex.category;
  if (category === "NOT_A_KNIFE") return null;
  const no = unique(ans.tools_no);
  const confirmed = unique([...ex.tools_seen, ...ans.tools_yes]).filter(t => !no.includes(t));
  const maybe = unique(ex.tools_maybe).filter(t => !no.includes(t) && !confirmed.includes(t));
  const zone = zoneFor(ans.length_zone ?? ex.length_zone);
  const mm = !ans.length_zone && ex.length_estimate_mm != null && Number.isFinite(ex.length_estimate_mm) && ex.length_estimate_mm > 0
    ? ex.length_estimate_mm : null;
  const length = mm != null ? `${mm} mm` : zone ? `${zone.label} mm (Grössenzone)` : null;
  const model = clean(ex.model_guess ?? "") || null;
  // A generic category with no concrete features is not a semantic search query.
  if (!model && !length && !confirmed.length && !maybe.length && !no.length && category === "OTHER_KNIFE") return null;
  return describe(model, category, length, confirmed, maybe, no);
}

/** Order-independent content version; changes to relevant data, vocabulary or template invalidate the index. */
export function dataVersion(documents: ProductDocument[]): string {
  return sha256(JSON.stringify({ description_version: DESCRIPTION_VERSION, model: settings.model,
    dimensions: settings.dimensions, documents: [...documents].sort((a, b) => compareIds(a.id, b.id)) }));
}
