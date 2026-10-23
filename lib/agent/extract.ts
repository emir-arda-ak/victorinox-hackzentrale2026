import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ExtractionSchema, type Extraction } from "./schema";
import { EXTRACTION_PROMPT } from "./prompt";

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
export async function extract(imageUrl: string): Promise<{ extraction: Extraction; ms: number; model: string }> {
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
  return { extraction: res.output_parsed, ms: Date.now() - t0, model: VISION_MODEL };
}
