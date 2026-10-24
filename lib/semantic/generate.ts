import { ARTIFACT_VERSION, ArtifactSchema, validateArtifact, type EmbeddingArtifact } from "./artifact";
import { DESCRIPTION_VERSION, EMBEDDING_SETTINGS as S, dataVersion, type ProductDocument } from "./descriptions";
import { unitVector } from "./index";
import type { EmbedTexts } from "./provider";

/** Build in memory; caller publishes atomically only after all batches have passed validation. */
export async function generateArtifact(documents: ProductDocument[], embed: EmbedTexts, previous?: unknown, force = false) {
  if (!documents.length || new Set(documents.map(d => d.id)).size !== documents.length) throw new Error("invalid_catalog_ids");
  const old = ArtifactSchema.safeParse(previous);
  const reusable = old.success && !force && old.data.embedding_model === S.model && old.data.dimensions === S.dimensions &&
    old.data.description_version === DESCRIPTION_VERSION && new Set(old.data.entries.map(e => e.id)).size === old.data.entries.length;
  const entries = new Map<string, EmbeddingArtifact["entries"][number]>();
  if (reusable && old.success) {
    const oldEntries = new Map(old.data.entries.map(e => [e.id, e]));
    for (const doc of documents) {
      const row = oldEntries.get(doc.id);
      if (!row || row.description_sha256 !== doc.description_sha256 || row.description !== doc.description) continue;
      try { unitVector(row.embedding, S.dimensions); entries.set(doc.id, row); } catch { /* regenerate invalid vector */ }
    }
  }
  const pending = documents.filter(d => !entries.has(d.id));
  let tokens = 0;
  for (let i = 0; i < pending.length; i += S.batch_size) {
    const batch = pending.slice(i, i + S.batch_size);
    const response = await embed(batch.map(d => d.description), S.generation_timeout_ms);
    if (response.model !== S.model || response.vectors.length !== batch.length) throw new Error("invalid_embedding_response");
    response.vectors.forEach(vector => unitVector(vector, S.dimensions));
    batch.forEach((doc, index) => entries.set(doc.id, { ...doc, embedding: response.vectors[index] }));
    tokens += response.total_tokens;
  }
  const artifact: EmbeddingArtifact = {
    schema_version: ARTIFACT_VERSION, description_version: DESCRIPTION_VERSION, embedding_model: S.model,
    dimensions: S.dimensions, data_version: dataVersion(documents),
    generated_at: !pending.length && old.success ? old.data.generated_at : new Date().toISOString(),
    entries: documents.map(d => entries.get(d.id)!),
  };
  validateArtifact(artifact, documents);
  return { artifact, generated: pending.length, reused: documents.length - pending.length, total_tokens: tokens };
}
