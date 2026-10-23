import { NextResponse } from "next/server";
import { decide } from "@/lib/agent/pipeline";
import { AnswersSchema, ExtractionSchema } from "@/lib/agent/schema";


/** POST { extraction, answers } -> MatchResult. No LLM call: re-ranks in milliseconds after a follow-up answer or a corrected chip. */
export async function POST(req: Request) {
  const body = await req.json();
  const ex = ExtractionSchema.safeParse(body?.extraction);
  const ans = AnswersSchema.safeParse(body?.answers ?? {});
  if (!ex.success || !ans.success)
    return NextResponse.json({ error: "invalid extraction/answers", details: [ex.error?.issues, ans.error?.issues] }, { status: 400 });
  return NextResponse.json(decide(ex.data, ans.data));
}
