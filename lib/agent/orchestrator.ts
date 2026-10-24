import { CATALOG, SCORING, TOOL_META, zoneFor } from "@/lib/catalog";
import type { ToolId } from "@/lib/catalog.types";
import { getLearnedRules } from "@/lib/learned";
import { extract, verifyTool, type Verification } from "./extract";
import { mergeExtractions } from "./merge";
import { decide, type MatchResult } from "./pipeline";
import { HINTS, PROMPT_VERSION } from "./prompt";
import type { Answers, Extraction } from "./schema";

/** Agentic workflow (orchestrator + specialised agents, as in the challenge brief):
 *  1 Vision-Agent       – one vision call per new photo, in parallel
 *  2 Orchestrator       – merges all photos of the knife, routes: Victorinox path vs. competitor path
 *  3 Product-Data-Agent – narrows the released catalog data (category, size)
 *  4 Recommendation-Agent – weighs tools, size, cross-reference/feedback rules -> ranking + confidence
 *  5 Orchestrator loop  – if unsure, decides which fact would separate the top candidates, first re-checks
 *                         it ITSELF on the photos (verification tool), and only asks the user if that stays unclear.
 *  Every step is streamed to the UI. Specs always come from the catalog, never from the LLM. */

export type StepEvent = {
  type: "step";
  id: string;
  agent: string;
  status: "run" | "done" | "skip";
  text: string;
  ms?: number;
};
export type AgentEvent =
  | StepEvent
  | { type: "photo"; index: number; extraction: Extraction }
  | {
      type: "result";
      result: MatchResult & { photos: number; model: string; prompt_version: string; answers: Answers; agent_checks: AgentCheck[] };
    }
  | { type: "error"; error: string };

export type AgentCheck = { tool: ToolId; label: string; answer: Verification["answer"]; confidence: number; evidence: string; accepted: boolean };

export type AgentInput = {
  photos: string[]; // ALL photos of this knife (data URLs), oldest first
  previous: Extraction[]; // extractions for photos[0..previous.length-1]
  answers: Answers;
};

type Deps = { extract: typeof extract; verifyTool: typeof verifyTool; getLearnedRules: typeof getLearnedRules };
const MAX_SELF_CHECKS = 2;
const ACCEPT = { yes: 0.7, no: 0.85 };

const CAT_DE: Record<string, string> = {
  SAK: "Taschenmesser", MULTITOOL: "Multitools", ONEHAND: "Einhandmesser", SWISSCARD: "SwissCards",
  FIXED: "feststehende Messer", GARDEN: "Gartenmesser", OTHER_KNIFE: "andere Messer",
};

export async function runAgent(input: AgentInput, emit: (e: AgentEvent) => void, deps: Deps = { extract, verifyTool, getLearnedRules }) {
  const step = (id: string, agent: string, status: StepEvent["status"], text: string, ms?: number) =>
    emit({ type: "step", id, agent, status, text, ms });
  const timings: Record<string, number> = {};
  const learnedP = deps.getLearnedRules();

  // ---- 1 Vision-Agent: every new photo in parallel ----
  const newPhotos = input.photos.slice(input.previous.length);
  const t0 = Date.now();
  step("vision", "Vision-Agent", "run", newPhotos.length > 1 ? `Analysiere ${newPhotos.length} Fotos parallel …` : "Analysiere das Foto …");
  let model = "";
  const fresh = await Promise.all(
    newPhotos.map(async (img, k) => {
      const r = await deps.extract(img);
      model = r.model;
      const index = input.previous.length + k;
      emit({ type: "photo", index, extraction: r.extraction });
      const e = r.extraction;
      step(`vision-${index}`, "Vision-Agent", "done",
        `Foto ${index + 1}: ${e.brand ?? "Marke unklar"}, ${e.tools_seen.length} Werkzeug${e.tools_seen.length === 1 ? "" : "e"} sichtbar` +
          (e.length_zone ? `, Zone ${e.length_zone}` : ""), r.ms);
      return e;
    }),
  );
  timings.extract_ms = Date.now() - t0;
  step("vision", "Vision-Agent", "done", `${newPhotos.length} neue${newPhotos.length === 1 ? "s" : ""} Foto${newPhotos.length === 1 ? "" : "s"} analysiert`, timings.extract_ms);

  // ---- 2 Orchestrator: merge + route ----
  const all = [...input.previous, ...fresh];
  const merged = mergeExtractions(all);
  const ex: Extraction = input.answers.category ? { ...merged, category: input.answers.category, category_confidence: 1 } : merged;
  if (ex.category === "NOT_A_KNIFE") {
    step("route", "Orchestrator", "done", "Kein Messer erkannt – Abbruch, bitte neues Foto.");
  } else {
    const route = ex.is_victorinox === true
      ? `Victorinox erkannt (${ex.brand_evidence ?? "Emblem"}) → Pfad: aktuelles Modell / Nachfolger suchen`
      : ex.is_victorinox === false
        ? `Konkurrenzprodukt (${ex.brand ?? "andere Marke"}) → Pfad: bestes Victorinox-Ersatzprodukt`
        : "Marke unklar → beide Pfade offen, Bewertung nur über Merkmale";
    step("route", "Orchestrator", "done", `${all.length > 1 ? `${all.length} Fotos kombiniert. ` : ""}${route}`);

    // ---- 3 Product-Data-Agent ----
    const sameCat = CATALOG.filter((c) => c.category === ex.category);
    const z = input.answers.length_zone ? zoneFor(input.answers.length_zone) : null;
    const est = z ? null : ex.length_estimate_mm;
    const near = z?.class_mm
      ? sameCat.filter((c) => c.length_mm != null && z.class_mm!.includes(c.length_mm))
      : est
        ? sameCat.filter((c) => c.length_mm != null && Math.abs(c.length_mm - est) <= 6)
        : [];
    const sizeTxt = z?.class_mm
      ? `, davon ${near.length} in Zone ${z.label}`
      : est
        ? near.length
          ? `, davon ${near.length} mit ähnlicher Länge (≈ ${Math.round(est)} mm ± 6)`
          : `, keines mit ≈ ${Math.round(est)} mm – nächstliegende Grössen werden bewertet`
        : "";
    step("data", "Product-Data-Agent", "done",
      `${CATALOG.length} freigegebene Modelle → ${sameCat.length} ${CAT_DE[ex.category] ?? ex.category}${sizeTxt} (Quelle: SAK-Katalog 2026)`);
  }

  // ---- 4 + 5 Recommendation-Agent with self-check loop ----
  const learned = await learnedP;
  if (learned.length) step("rules", "Recommendation-Agent", "done", `${learned.length} gelernte Cross-Reference-Regel${learned.length > 1 ? "n" : ""} aus Feedback geladen`);
  let ans: Answers = { ...input.answers, tools_yes: [...input.answers.tools_yes], tools_no: [...input.answers.tools_no] };
  let res = decide(merged, ans, learned, timings);
  const checks: AgentCheck[] = [];
  const top3 = () => res.ranking?.candidates.slice(0, 3).map((c) => c.name).join(", ") ?? "";
  if (res.ranking) step("rank-0", "Recommendation-Agent", "done", `Top-3: ${top3()} · Konfidenz ${Math.round(res.ranking.confidence * 100)} %`);

  for (let i = 0; i < MAX_SELF_CHECKS && res.question?.type === "tool"; i++) {
    const q = res.question;
    const label = TOOL_META[q.tool]?.label ?? q.tool;
    step(`plan-${i}`, "Orchestrator", "done", `Unsicher. Entscheidendes Merkmal: ${label} – ${q.reason} Prüfe das zuerst selbst auf den Fotos.`);
    step(`check-${i}`, "Vision-Agent", "run", `Gezielte Nachprüfung: ${label}?`);
    let v: Verification & { ms: number };
    try {
      v = await deps.verifyTool(input.photos.slice(-4), label, HINTS[q.tool]);
    } catch (e) {
      step(`check-${i}`, "Vision-Agent", "skip", `Nachprüfung fehlgeschlagen (${e instanceof Error ? e.message : e}) → Rückfrage an Nutzer`);
      break;
    }
    timings[`verify_${i}_ms`] = v.ms;
    const accepted = v.answer !== "unclear" && v.confidence >= ACCEPT[v.answer];
    checks.push({ tool: q.tool, label, answer: v.answer, confidence: v.confidence, evidence: v.evidence, accepted });
    const word = v.answer === "yes" ? "Ja" : v.answer === "no" ? "Nein" : "Unklar";
    step(`check-${i}`, "Vision-Agent", accepted ? "done" : "skip", `${label}: ${word} (${Math.round(v.confidence * 100)} %) – ${v.evidence}`, v.ms);
    if (!accepted) {
      step(`ask-${i}`, "Orchestrator", "done", "Auf den Fotos nicht eindeutig → Rückfrage an den Nutzer");
      break;
    }
    ans = v.answer === "yes" ? { ...ans, tools_yes: [...ans.tools_yes, q.tool] } : { ...ans, tools_no: [...ans.tools_no, q.tool] };
    const before = res.ranking?.candidates[0]?.id;
    res = decide(merged, ans, learned, timings);
    const changed = res.ranking?.candidates[0]?.id !== before;
    if (res.ranking) step(`rank-${i + 1}`, "Recommendation-Agent", "done",
      `${changed ? "Neue Rangliste" : "Rangliste bestätigt"}: ${top3()} · Konfidenz ${Math.round(res.ranking.confidence * 100)} %`);
  }

  if (res.ranking) {
    const lvl = res.ranking.level === "high" ? "sicher" : res.ranking.level === "medium" ? "wahrscheinlich" : "unsicher";
    step("final", "Orchestrator", "done",
      res.question ? `Empfehlung ${lvl} – eine Rückfrage an den Nutzer` : `Empfehlung ${lvl}: ${res.ranking.candidates[0]?.name}`);
  }
  emit({
    type: "result",
    result: { ...res, photos: all.length, model, prompt_version: PROMPT_VERSION, answers: ans, agent_checks: checks },
  });
}

export const AGENT_LIMITS = { max_photos: 6, ask_below: SCORING.clarify.ask_below_confidence };
