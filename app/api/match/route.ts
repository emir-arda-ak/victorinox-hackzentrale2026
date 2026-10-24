import { NextResponse } from "next/server";
import { extract } from "@/lib/agent/extract";
import { decide } from "@/lib/agent/pipeline";
import { AnswersSchema } from "@/lib/agent/schema";

export const maxDuration = 120;

/** POST { image: "data:image/jpeg;base64,..." } -> MatchResult */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const image: unknown = body?.image;
    if (typeof image !== "string" || !(image.startsWith("data:image/") || image.startsWith("https://")))
      return NextResponse.json({ error: "image (data URL) fehlt" }, { status: 400 });
    const { extraction, ms, model, prompt_version } = await extract(image);
    const result = decide(extraction, AnswersSchema.parse({}), [], { extract_ms: ms });
    return NextResponse.json({ ...result, model, prompt_version, reasoning_effort: process.env.OPENAI_REASONING_EFFORT ?? null });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
