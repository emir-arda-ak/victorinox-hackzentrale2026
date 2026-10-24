import { clarify, type Question } from "./clarify";
import { explain } from "./explain";
import { score, type Candidate, type LearnedRule, type Ranking } from "./score";
import type { Answers, Extraction } from "./schema";

export type MatchResult = {
  status: "ok" | "rejected";
  path: "victorinox" | "competitor" | "unknown" | null;
  extraction: Extraction;
  ranking: (Omit<Ranking, "candidates"> & { candidates: (Candidate & { explanation: string[] })[] }) | null;
  question: Question | null;
  timings: Record<string, number>;
  model?: string;
};

/** Router + scoring + follow-up question. Used by /api/match (after extraction) and /api/score (re-rank). */
export function decide(ex0: Extraction, ans: Answers, learned: LearnedRule[] = [], timings: Record<string, number> = {}): MatchResult {
  // corrections from the UI chips override what the vision model saw
  const ex: Extraction = ans.category ? { ...ex0, category: ans.category, category_confidence: 1 } : ex0;
  if (ex.category === "NOT_A_KNIFE") {
    return { status: "rejected", path: null, extraction: ex, ranking: null, question: null, timings };
  }
  const path = ex.is_victorinox === true ? "victorinox" : ex.is_victorinox === false ? "competitor" : "unknown";
  const t0 = Date.now();
  const r = score(ex, ans, learned);
  const q = clarify(ex, ans, r);
  timings.score_ms = Date.now() - t0;
  return {
    status: "ok",
    path,
    extraction: ex,
    ranking: {
      ...r,
      candidates: r.candidates.map((c, i) => ({ ...c, explanation: i < 3 ? explain(c, ex, ans) : [] })),
    },
    question: q,
    timings,
  };
}
