import { NextResponse } from "next/server";
import { extract } from "@/lib/agent/extract";
import { mergeExtractions } from "@/lib/agent/merge";
import { decide } from "@/lib/agent/pipeline";
import { AnswersSchema, ExtractionSchema } from "@/lib/agent/schema";
import { getLearnedRules } from "@/lib/learned";
import { z } from "zod";

export const maxDuration = 120;

/** POST { image: "data:image/jpeg;base64,...", previous?: Extraction[], answers?: Answers }
 *  -> MatchResult for ALL photos of this knife (previous + new), plus `photo_extraction` of the new photo */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const image: unknown = body?.image;
    if (typeof image !== "string" || !(image.startsWith("data:image/") || image.startsWith("https://")))
      return NextResponse.json({ error: "image (data URL) fehlt" }, { status: 400 });
    const previous = z.array(ExtractionSchema).safeParse(body?.previous ?? []);
    const answers = AnswersSchema.safeParse(body?.answers ?? {});
    const [{ extraction, ms, model, prompt_version }, learned] = await Promise.all([extract(image), getLearnedRules()]);
    const all = [...(previous.success ? previous.data : []), extraction];
    const result = decide(mergeExtractions(all), answers.success ? answers.data : AnswersSchema.parse({}), learned, { extract_ms: ms });
    return NextResponse.json({
      ...result,
      photo_extraction: extraction,
      photos: all.length,
      model,
      prompt_version,
      reasoning_effort: process.env.OPENAI_REASONING_EFFORT ?? null,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
