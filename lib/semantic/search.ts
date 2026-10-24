import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Answers, Extraction } from "@/lib/agent/schema";
import { indexFromArtifact } from "./artifact";
import { catalogDocuments, EMBEDDING_SETTINGS as S, extractionDescription } from "./descriptions";
import { embedTexts, EmbeddingUnavailable, type EmbedTexts } from "./provider";
import type { SemanticHit } from "./index";

export type SearchResult = {
  status: "ok"; results: SemanticHit[]; embedding_model: string; dimensions: number;
  data_version: string; query_description: string;
} | {
  status: "empty" | "unavailable"; results: []; reason: string; fallback: "existing_matching";
};
type Snapshot = ReturnType<typeof indexFromArtifact>;
export type SearchDependencies = { loadIndex: () => Promise<Snapshot>; embed: EmbedTexts };
let cached: Snapshot | undefined;
let loading: Promise<Snapshot> | undefined;
export const fallbackResult = (reason: string): SearchResult => ({ status: "unavailable", results: [], reason, fallback: "existing_matching" });

/** A successful snapshot is cached until process restart; failures are retried on the next explicit request. */
export async function loadIndex(): Promise<Snapshot> {
  if (cached) return cached;
  if (loading) return loading;
  loading = (async () => {
    const raw = await readFile(path.join(process.cwd(), "data", "catalog-embeddings.json"), "utf8");
    cached = indexFromArtifact(JSON.parse(raw), catalogDocuments());
    return cached;
  })();
  try { return await loading; } finally { loading = undefined; }
}

/** Optional side channel only: never calls, mutates, combines with, or reorders the deterministic scorer. */
export async function semanticSearch(ex: Extraction, ans: Answers, k = S.default_k,
  deps: SearchDependencies = { loadIndex, embed: embedTexts }): Promise<SearchResult> {
  if (!Number.isInteger(k) || k < 1 || k > S.max_k) return fallbackResult("invalid_k");
  let description: string | null;
  try { description = extractionDescription(ex, ans); } catch { return fallbackResult("invalid_query"); }
  if (!description) return { status: "empty", results: [], reason: "no_searchable_features", fallback: "existing_matching" };
  let snapshot: Snapshot;
  try { snapshot = await deps.loadIndex(); } catch { return fallbackResult("index_missing_or_invalid"); }
  try {
    const response = await deps.embed([description]);
    if (response.model !== S.model || response.vectors.length !== 1) return fallbackResult("invalid_embedding_response");
    return { status: "ok", results: snapshot.index.search(response.vectors[0], k),
      embedding_model: snapshot.artifact.embedding_model, dimensions: snapshot.artifact.dimensions,
      data_version: snapshot.artifact.data_version, query_description: description };
  } catch (error) {
    return fallbackResult(error instanceof EmbeddingUnavailable ? error.reason : "embedding_search_unavailable");
  }
}
