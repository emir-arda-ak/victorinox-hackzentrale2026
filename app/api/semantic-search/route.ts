import { NextResponse } from "next/server";
import { z } from "zod";
import { ExtractionSchema, AnswersSchema } from "@/lib/agent/schema";
import { EMBEDDING_SETTINGS } from "@/lib/semantic/descriptions";
import { fallbackResult, semanticSearch } from "@/lib/semantic/search";

// cacheComponents uses the default Node runtime; an explicit runtime segment config is disallowed here.
const RequestSchema = z.object({ extraction: ExtractionSchema,
  answers: AnswersSchema.optional(), k: z.number().int().min(1).max(EMBEDDING_SETTINGS.max_k).optional() });

/** Explicit opt-in endpoint; /api/match, /api/score and /api/agent are untouched. */
export async function POST(request: Request) {
  if (process.env.SEMANTIC_SEARCH_ENABLED !== "1") return NextResponse.json(fallbackResult("disabled"));
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_semantic_search_request" }, { status: 400 });
  return NextResponse.json(await semanticSearch(parsed.data.extraction, AnswersSchema.parse(parsed.data.answers ?? {}), parsed.data.k));
}
