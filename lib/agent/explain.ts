import type { Extraction, Answers } from "./schema";
import type { Candidate } from "./score";

/** Deterministic explanation built only from structured data (no LLM, no invented specs). */
export function explain(c: Candidate, ex: Extraction, ans: Answers): string[] {
  const out: string[] = [];
  const zone = ans.length_zone ?? ex.length_zone;
  if (c.length_mm && zone) out.push(`Grösse passt: ${c.length_mm} mm Schalenlänge (gemessen: Zone ${zone}).`);
  else if (c.length_mm) out.push(`Schalenlänge ${c.length_mm} mm (Länge auf dem Foto nicht gemessen).`);
  const both = c.tools.filter((t) => t.status === "both");
  const missing = c.tools.filter((t) => t.status === "missing");
  const extra = c.tools.filter((t) => t.status === "only_victorinox");
  const seenCount = both.length + missing.length;
  if (seenCount) out.push(`${both.length} von ${seenCount} erkannten Werkzeugen vorhanden${both.length ? `: ${both.slice(0, 5).map((t) => t.label).join(", ")}` : ""}.`);
  if (missing.length) out.push(`Fehlt im Vorschlag: ${missing.map((t) => t.label).join(", ")}.`);
  if (extra.length) out.push(`Zusätzlich bei Victorinox: ${extra.slice(0, 4).map((t) => t.label).join(", ")}${extra.length > 4 ? " u. a." : ""}.`);
  if (c.parts.crossref > 0) out.push("Bestätigt durch Cross-Reference-Regel bzw. Feedback.");
  if (c.parts.visible_sku > 0) out.push("Artikelnummer auf dem Foto erkannt.");
  return out;
}
