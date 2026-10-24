import type { Extraction, Answers } from "./schema";
import type { Candidate } from "./score";

/** Deterministic explanation built only from structured data (no LLM, no invented specs). */
export function explain(c: Candidate, ex: Extraction, ans: Answers): string[] {
  const out: string[] = [];
  const zone = ans.length_zone ?? ex.length_zone;
  const mm = ans.length_zone ? null : ex.length_estimate_mm;
  const measured = zone ? `Zone ${zone}${mm ? `, ≈ ${Math.round(mm)} mm` : ""}` : mm ? `≈ ${Math.round(mm)} mm` : null;
  if (c.length_mm && measured)
    out.push(c.parts.length > 1 ? `Grösse passt: ${c.length_mm} mm Schalenlänge (gemessen: ${measured}).` : `Schalenlänge ${c.length_mm} mm (gemessen: ${measured}).`);
  else if (c.length_mm) out.push(`Schalenlänge ${c.length_mm} mm (Länge auf dem Foto nicht gemessen).`);
  const extra = c.tools.filter((t) => t.status === "only_victorinox");
  const f = c.functional;
  if (f && f.confirmed_tool_count > 0) {
    out.push(`Funktionen: ${f.matched_working_tools.length} von ${f.confirmed_tool_count} sicher erkannten Arbeitsfunktionen vollständig abgedeckt` +
      (f.matched_working_tools.length ? ` (${f.matched_working_tools.slice(0, 5).join(", ")})` : "") + ".");
    if (f.missing_working_tools.length) out.push(`Fehlt im Vorschlag: ${f.missing_working_tools.join(", ")}.`);
    if (f.partially_matched_working_tools.length) out.push(`Teilweise abgedeckt: ${f.partially_matched_working_tools.join(", ")}.`);
  } else if (f) out.push("Funktionen: keine Arbeitswerkzeuge sicher erkannt oder bestätigt.");
  if (f?.uncertain_matched_working_tools.length) out.push(`Im Vorschlag vorhanden, am Ausgangsmesser unsicher: ${f.uncertain_matched_working_tools.join(", ")}.`);
  if (f?.matched_handling_attributes.length) out.push(`Handhabung gleich: ${f.matched_handling_attributes.join(", ")}.`);
  if (extra.length) out.push(`Im Vorschlag vorhanden, am Ausgangsmesser verneint: ${extra.slice(0, 4).map((t) => t.label).join(", ")}${extra.length > 4 ? " u. a." : "."}`);
  if (c.parts.crossref > 0) out.push("Gestützt durch eine gespeicherte Cross-Reference-Empfehlung.");
  if ((c.parts.learned ?? 0) > 0) out.push("Gestützt durch Feedback aus früheren Suchen (nicht geprüft).");
  if (c.parts.visible_sku > 0) out.push("Artikelnummer auf dem Foto erkannt.");
  return out;
}
