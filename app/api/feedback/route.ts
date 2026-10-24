import { NextResponse } from "next/server";
import { z } from "zod";
import { byId } from "@/lib/catalog";
import { mergeExtractions } from "@/lib/agent/merge";
import { ExtractionSchema } from "@/lib/agent/schema";
import { listFeedback, PERSISTENT, saveFeedback } from "@/lib/learned";

const Body = z.object({
  extractions: z.array(ExtractionSchema).min(1),
  suggested: z.string().nullable(),
  chosen: z.string(),
  correct: z.boolean(),
});

/** POST: 👍 (correct=true, chosen=suggested) or 👎 + better match (correct=false, chosen=other id) -> learned rule */
export async function POST(req: Request) {
  const b = Body.safeParse(await req.json());
  if (!b.success) return NextResponse.json({ error: "invalid feedback", details: b.error.issues }, { status: 400 });
  if (!byId.has(b.data.chosen)) return NextResponse.json({ error: "unbekannte Artikelnummer" }, { status: 400 });
  const r = await saveFeedback(mergeExtractions(b.data.extractions), b.data.suggested, b.data.chosen, b.data.correct);
  return NextResponse.json({ ok: true, ...r });
}

/** GET: latest feedback (for /admin or the presentation) */
export async function GET() {
  return NextResponse.json({ persistent: PERSISTENT, feedback: await listFeedback() });
}
