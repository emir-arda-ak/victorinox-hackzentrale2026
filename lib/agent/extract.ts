import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ExtractionSchema, type Extraction } from "./schema";
import { EXTRACTION_PROMPT, PROMPT_VERSION } from "./prompt";

let client: OpenAI | null = null;
/** Provider switch: set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY to run the same code on Azure OpenAI. */
function getClient(): OpenAI {
  if (client) return client;
  if (process.env.AZURE_OPENAI_ENDPOINT) {
    client = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "")}/openai/v1/`,
    });
  } else {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-6-luna";

/** One vision call: photo (data URL or https URL) -> structured extraction */
export async function extract(imageUrl: string): Promise<{ extraction: Extraction; ms: number; model: string; prompt_version: string }> {
  const t0 = Date.now();
  const effort = process.env.OPENAI_REASONING_EFFORT as "none" | "minimal" | "low" | "medium" | "high" | undefined;
  const res = await getClient().responses.parse({
    model: VISION_MODEL,
    ...(effort ? { reasoning: { effort } } : {}),
    input: [
      { role: "system", content: EXTRACTION_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Analysiere dieses Foto." },
          { type: "input_image", image_url: imageUrl, detail: "high" },
        ],
      },
    ],
    text: { format: zodTextFormat(ExtractionSchema, "extraction") },
  });
  if (!res.output_parsed) throw new Error("Vision model returned no parsable output");
  return { extraction: res.output_parsed, ms: Date.now() - t0, model: VISION_MODEL, prompt_version: PROMPT_VERSION };
}

const VerifySchema = z.object({
  answer: z.enum(["yes", "no", "unclear"]),
  confidence: z.number().describe("0..1"),
  evidence: z.string().describe("Short German sentence: what exactly you see (or why it is unclear)"),
});
export type Verification = z.infer<typeof VerifySchema>;

/** Agent tool: look again at ALL photos of one knife with one targeted question (used before asking the user). */
export async function verifyTool(images: string[], toolLabel: string, hint: string | undefined): Promise<Verification & { ms: number }> {
  const t0 = Date.now();
  const effort = process.env.OPENAI_REASONING_EFFORT as "none" | "minimal" | "low" | "medium" | "high" | undefined;
  const res = await getClient().responses.parse({
    model: VISION_MODEL,
    ...(effort ? { reasoning: { effort } } : {}),
    input: [
      {
        role: "system",
        content:
          "You check ONE detail on photos of the same pocket knife / multitool for a product-matching agent. " +
          "Answer 'yes' only if you can clearly see the tool on at least one photo. " +
          "Answer 'no' only if the knife is shown opened so that this tool would be visible and it is clearly absent. " +
          "If tools are folded in or the view is not clear, answer 'unclear'. Never guess.",
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: `Does this knife have: ${toolLabel}${hint ? ` (${hint})` : ""}?` },
          ...images.map((image_url) => ({ type: "input_image" as const, image_url, detail: "high" as const })),
        ],
      },
    ],
    text: { format: zodTextFormat(VerifySchema, "verification") },
  });
  if (!res.output_parsed) throw new Error("Verification returned no parsable output");
  return { ...res.output_parsed, ms: Date.now() - t0 };
}
