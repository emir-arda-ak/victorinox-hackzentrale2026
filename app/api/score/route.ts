import { NextResponse } from "next/server";
import { z } from "zod";
import { mergeExtractions } from "@/lib/agent/merge";
import { decide } from "@/lib/agent/pipeline";
import { AnswersSchema, ExtractionSchema } from "@/lib/agent/schema";
import { getLearnedRules } from "@/lib/learned";

/** POST { extraction } or { extractions: [...] } + answers -> MatchResult.
 *  No vision call: re-ranks in milliseconds after a follow-up answer or a corrected chip. */
export async function POST(req: Request) {
  const body = await req.json();
  const list = z.array(ExtractionSchema).min(1).safeParse(body?.extractions ?? (body?.extraction ? [body.extraction] : []));
  const ans = AnswersSchema.safeParse(body?.answers ?? {});
  if (!list.success || !ans.success)
    return NextResponse.json({ error: "invalid extraction/answers", details: [list.error?.issues, ans.error?.issues] }, { status: 400 });
  const learned = await getLearnedRules();
  return NextResponse.json({ ...decide(mergeExtractions(list.data), ans.data, learned), photos: list.data.length });
}
