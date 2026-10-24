import { z } from "zod";
import { AGENT_LIMITS, runAgent, type AgentEvent } from "@/lib/agent/orchestrator";
import { AnswersSchema, ExtractionSchema } from "@/lib/agent/schema";

export const maxDuration = 120;

const Body = z.object({
  photos: z.array(z.string().refine((s) => s.startsWith("data:image/") || s.startsWith("https://"))).min(1).max(AGENT_LIMITS.max_photos),
  previous: z.array(ExtractionSchema).default([]),
  answers: AnswersSchema.default(AnswersSchema.parse({})),
});

/** POST { photos: [all photos of the knife], previous: [extractions of the photos already analysed], answers }
 *  -> NDJSON stream of AgentEvent (steps live, then one "result"). */
export async function POST(req: Request) {
  const b = Body.safeParse(await req.json());
  if (!b.success) return Response.json({ error: "invalid request", details: b.error.issues }, { status: 400 });
  if (b.data.previous.length >= b.data.photos.length)
    return Response.json({ error: "keine neuen Fotos" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: AgentEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await runAgent(b.data, emit);
      } catch (e) {
        console.error(e);
        emit({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
