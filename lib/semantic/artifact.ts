import { z } from "zod";
import { DESCRIPTION_VERSION, EMBEDDING_SETTINGS as S, dataVersion, type ProductDocument } from "./descriptions";
import { ExactCosineIndex, unitVector } from "./index";

export const ARTIFACT_VERSION = 1;
const entrySchema = z.object({ id: z.string().min(1), description: z.string().min(1),
  description_sha256: z.string().length(64), embedding: z.array(z.number()) });
export const ArtifactSchema = z.object({
  schema_version: z.literal(ARTIFACT_VERSION), description_version: z.string(),
  embedding_model: z.string(), dimensions: z.number().int().positive(),
  data_version: z.string().length(64), generated_at: z.string().datetime(),
  entries: z.array(entrySchema),
});
export type EmbeddingArtifact = z.infer<typeof ArtifactSchema>;

/** Fail closed on stale, incomplete, duplicated or mismatched data; never silently search a partial catalog. */
export function validateArtifact(raw: unknown, documents: ProductDocument[]): EmbeddingArtifact {
  const artifact = ArtifactSchema.parse(raw);
  if (artifact.embedding_model !== S.model || artifact.dimensions !== S.dimensions ||
      artifact.description_version !== DESCRIPTION_VERSION || artifact.data_version !== dataVersion(documents))
    throw new Error("stale_embedding_index");
  const expected = new Map(documents.map(d => [d.id, d]));
  if (artifact.entries.length !== expected.size) throw new Error("incomplete_embedding_index");
  const seen = new Set<string>();
  for (const row of artifact.entries) {
    const doc = expected.get(row.id);
    if (!doc || seen.has(row.id) || row.description !== doc.description || row.description_sha256 !== doc.description_sha256)
      throw new Error("invalid_embedding_entry");
    seen.add(row.id);
    unitVector(row.embedding, artifact.dimensions);
  }
  return artifact;
}

export function indexFromArtifact(raw: unknown, documents: ProductDocument[]) {
  const artifact = validateArtifact(raw, documents);
  return { artifact, index: new ExactCosineIndex(artifact.entries, artifact.dimensions, new Set(documents.map(d => d.id))) };
}
