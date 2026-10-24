import { compareIds } from "./descriptions";

export type SemanticHit = { product_id: string; similarity: number };
export type VectorRecord = { id: string; embedding: number[] };

/** Validates dimensions, finite entries and nonzero norm; copied vectors cannot be mutated by callers. */
export function unitVector(vector: unknown, dimensions: number): number[] {
  if (!Number.isInteger(dimensions) || dimensions < 1 || !Array.isArray(vector) || vector.length !== dimensions ||
      !vector.every(x => typeof x === "number" && Number.isFinite(x))) throw new Error("invalid_vector");
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new Error("invalid_vector");
  return vector.map(x => x / norm);
}

/** Full scan, O(N × dimensions). No ANN library or approximate pruning for this small catalog. */
export class ExactCosineIndex {
  private readonly vectors: { id: string; unit: number[] }[];
  constructor(records: VectorRecord[], readonly dimensions: number, allowedIds: ReadonlySet<string>) {
    if (!Number.isInteger(dimensions) || dimensions < 1) throw new Error("invalid_dimensions");
    const seen = new Set<string>();
    this.vectors = records.map(record => {
      if (!allowedIds.has(record.id) || seen.has(record.id)) throw new Error("invalid_product_id");
      seen.add(record.id);
      return { id: record.id, unit: unitVector(record.embedding, dimensions) };
    });
  }
  search(query: number[], k: number): SemanticHit[] {
    if (!Number.isInteger(k) || k < 1) throw new Error("invalid_k");
    const unit = unitVector(query, this.dimensions);
    return this.vectors.map(record => ({ product_id: record.id,
      similarity: Math.max(-1, Math.min(1, record.unit.reduce((sum, value, i) => sum + value * unit[i], 0))) }))
      .sort((a, b) => b.similarity - a.similarity || compareIds(a.product_id, b.product_id))
      .slice(0, k);
  }
}
