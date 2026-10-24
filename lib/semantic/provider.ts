import OpenAI from "openai";
import { EMBEDDING_SETTINGS as S } from "./descriptions";
import { unitVector } from "./index";

export type EmbeddingBatch = { model: string; vectors: number[][]; total_tokens: number };
export type EmbedTexts = (texts: string[], timeoutMs?: number) => Promise<EmbeddingBatch>;
export class EmbeddingUnavailable extends Error {
  constructor(readonly reason: "missing_credentials" | "embedding_api_unavailable" | "invalid_embedding_response") {
    super(reason);
  }
}

/** Match response indices, not response order. Reject model/dimension drift before persisting or searching. */
export function decodeResponse(response: OpenAI.CreateEmbeddingResponse, count: number): EmbeddingBatch {
  if (response.model !== S.model || response.data.length !== count) throw new EmbeddingUnavailable("invalid_embedding_response");
  const vectors: number[][] = new Array(count);
  const seen = new Set<number>();
  for (const row of response.data) {
    if (!Number.isInteger(row.index) || row.index < 0 || row.index >= count || seen.has(row.index))
      throw new EmbeddingUnavailable("invalid_embedding_response");
    try { unitVector(row.embedding, S.dimensions); } catch { throw new EmbeddingUnavailable("invalid_embedding_response"); }
    seen.add(row.index);
    vectors[row.index] = row.embedding;
  }
  return { model: response.model, vectors, total_tokens: response.usage.total_tokens };
}

/** Server-side only; never logs keys, raw API errors or query contents. No implicit Azure/vision-model fallback. */
export const embedTexts: EmbedTexts = async (texts, timeoutMs = S.query_timeout_ms) => {
  if (!texts.length || texts.some(t => !t.trim() || Buffer.byteLength(t, "utf8") > S.max_input_bytes))
    throw new EmbeddingUnavailable("invalid_embedding_response");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new EmbeddingUnavailable("missing_credentials");
  try {
    const client = new OpenAI({ apiKey, baseURL: "https://api.openai.com/v1", timeout: timeoutMs, maxRetries: 0 });
    const response = await client.embeddings.create({ model: S.model, dimensions: S.dimensions,
      encoding_format: "float", input: texts });
    return decodeResponse(response, texts.length);
  } catch (error) {
    if (error instanceof EmbeddingUnavailable) throw error;
    throw new EmbeddingUnavailable("embedding_api_unavailable");
  }
};
