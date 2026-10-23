import catalogJson from "@/data/catalog.json";
import toolsJson from "@/data/tools.json";
import zonesJson from "@/data/zones.json";
import crossrefJson from "@/data/crossref.json";
import scoringJson from "@/config/scoring.json";
import type { CatalogModel, ToolId, ToolMeta } from "@/lib/catalog.types";

export const CATALOG = catalogJson as unknown as CatalogModel[];
export const TOOL_META = toolsJson as unknown as ToolMeta;
export const SCORING = scoringJson;

export type Zone = { from: number; to: number; label: string; class_mm: number[] | null };
export const ZONES = (zonesJson as { zones_mm: Zone[] }).zones_mm;
export const ZONE_LABELS = ZONES.map((z) => z.label) as [string, ...string[]];

export type CrossrefEntry = {
  brand: string;
  model: string;
  category: string;
  length_mm: number | null;
  tools: ToolId[];
  source_url: string | null;
  preferred_match: string | null;
  rule_note?: string;
};
export const CROSSREF = (crossrefJson as { entries: CrossrefEntry[] }).entries.filter(
  (e) => !e.model.startsWith("BEISPIEL"),
);

export const byId = new Map(CATALOG.map((m) => [m.id, m]));

/** id of the model a SKU (incl. variants like 1.3603.3B1) belongs to */
export function modelForSku(sku: string): CatalogModel | undefined {
  const s = sku.trim().toUpperCase();
  return CATALOG.find((m) => m.id.toUpperCase() === s || m.variants.some((v) => v.sku.toUpperCase() === s));
}

export function zoneFor(label: string | null | undefined): Zone | undefined {
  return ZONES.find((z) => z.label === label);
}
