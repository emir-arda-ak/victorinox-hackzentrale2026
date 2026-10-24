import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CATALOG } from "@/lib/catalog";
import { AnswersSchema, type Extraction } from "@/lib/agent/schema";
import { score } from "@/lib/agent/score";
import { POST } from "@/app/api/semantic-search/route";
import { catalogDocuments, dataVersion, extractionDescription, sha256, EMBEDDING_SETTINGS as S } from "@/lib/semantic/descriptions";
import { ExactCosineIndex, unitVector } from "@/lib/semantic/index";
import { generateArtifact } from "@/lib/semantic/generate";
import { validateArtifact, indexFromArtifact } from "@/lib/semantic/artifact";
import { decodeResponse, embedTexts, EmbeddingUnavailable, type EmbedTexts } from "@/lib/semantic/provider";
import { semanticSearch } from "@/lib/semantic/search";

const ex: Extraction = {
  category: "ONEHAND", category_confidence: 0.785, brand: "Böker", brand_evidence: null, is_victorinox: false,
  model_guess: null, visible_sku: null, open_state: "open", tools_seen: ["blade_large", "clip", "scissors", "corkscrew"],
  tools_maybe: ["saw_wood", "other"], sheet_visible: true, length_zone: "111", length_zone_alt: null,
  length_zone_confidence: 0.78, length_estimate_mm: 102.5, scale_color: "schwarz", scale_material: null,
  description: "DO NOT EMBED FREE VISION TEXT", image_issues: [],
};
const answers = AnswersSchema.parse({ tools_yes: ["thumb_stud"] });
const vector = (axis = 0) => Array.from({ length: S.dimensions }, (_, i) => i === axis ? 1 : 0);
const clone = <T,>(value: T): T => structuredClone(value);

export async function main() {
  let passed = 0;
  const test = async (name: string, run: () => void | Promise<void>) => { await run(); passed++; console.log(`PASS ${name}`); };
  const docs = catalogDocuments();
  await test("149 unique catalog IDs, complete structured descriptions", () => {
    assert.equal(docs.length, 149); assert.equal(new Set(docs.map(d => d.id)).size, 149);
    for (const d of docs) {
      for (const field of ["Modell:", "Kategorie:", "Grifflänge:", "Arbeitsfunktionen:", "Handhabung:"])
        assert.ok(d.description.includes(field));
      assert.equal(d.description_sha256, sha256(d.description));
    }
  });
  await test("catalog order/tool duplicates do not alter descriptions or version", () => {
    assert.deepEqual(catalogDocuments([...CATALOG].reverse().map(c => ({ ...c, tools: [...c.tools, ...c.tools].reverse() }))), docs);
    assert.equal(dataVersion([...docs].reverse()), dataVersion(docs));
  });
  await test("unknown lengths are unknown; relevant edits change data version", () => {
    const unknown = CATALOG.find(c => c.length_mm === null)!;
    assert.match(catalogDocuments([unknown])[0].description, /Grifflänge: unbekannt/);
    const edited = CATALOG.map(c => ({ ...c })); edited[0].length_mm = 123;
    assert.notEqual(dataVersion(catalogDocuments(edited)), dataVersion(docs));
    assert.throws(() => catalogDocuments([CATALOG[0], CATALOG[0]]));
    assert.throws(() => catalogDocuments([]));
  });
  await test("query uses common fields, canonical tool order and no free prose", () => {
    const text = extractionDescription(ex, answers)!;
    assert.ok(text.includes("Arbeitsfunktionen: Grosse Klinge, Korkenzieher, Schere"));
    assert.ok(text.includes("Handhabung: Trageclip, Daumenpin"));
    assert.ok(text.includes("Unsichere Arbeitsfunktionen: Holzsäge"));
    assert.ok(!text.includes(ex.description)); assert.ok(!text.includes("Sonstiges"));
    assert.equal(text, extractionDescription({ ...ex, tools_seen: [...ex.tools_seen].reverse() }, answers));
  });
  await test("explicit no wins over yes/vision; maybe remains uncertain", () => {
    const text = extractionDescription(ex, AnswersSchema.parse({ tools_yes: ["scissors"], tools_no: ["scissors"] }))!;
    assert.ok(!text.split("\n").find(l => l.startsWith("Arbeitsfunktionen:"))!.includes("Schere"));
    assert.ok(text.includes("Ausdrücklich verneinte Merkmale: Schere"));
  });
  await test("empty/non-knife input does not become a placeholder-only query", () => {
    assert.equal(extractionDescription({ ...ex, category: "NOT_A_KNIFE" }, AnswersSchema.parse({})), null);
    assert.equal(extractionDescription({ ...ex, category: "OTHER_KNIFE", tools_seen: [], tools_maybe: [], length_estimate_mm: null, length_zone: null }, AnswersSchema.parse({})), null);
    assert.throws(() => extractionDescription({ ...ex, model_guess: "x".repeat(S.max_input_bytes) }, answers));
  });
  await test("actual cosine values, including negative similarity", () => {
    const index = new ExactCosineIndex([{ id: "positive", embedding: [3, 0] }, { id: "negative", embedding: [-5, 0] },
      { id: "orthogonal", embedding: [0, 2] }], 2, new Set(["positive", "negative", "orthogonal"]));
    assert.deepEqual(index.search([7, 0], 10), [
      { product_id: "positive", similarity: 1 }, { product_id: "orthogonal", similarity: 0 }, { product_id: "negative", similarity: -1 },
    ]);
    assert.equal(index.search([0, 3], 1)[0].product_id, "orthogonal");
  });
  await test("ties use product ID, independent of insertion order and repeated calls", () => {
    const records = [{ id: "b", embedding: [1, 1] }, { id: "a", embedding: [2, 2] }];
    const allowed = new Set(["a", "b"]);
    const index = new ExactCosineIndex(records, 2, allowed);
    const result = index.search([1, 1], 2);
    assert.equal(result[0].product_id, "a");
    assert.deepEqual(result, new ExactCosineIndex([...records].reverse(), 2, allowed).search([1, 1], 2));
    records[0].embedding[0] = -50;
    assert.deepEqual(result, index.search([1, 1], 2));
  });
  await test("invalid dimensions, NaN, infinity, zero vectors and invalid k rejected", () => {
    for (const bad of [[], [1], [0, 0], [NaN, 0], [Infinity, 0], ["1", 0]]) assert.throws(() => unitVector(bad, 2));
    const index = new ExactCosineIndex([{ id: "a", embedding: [1, 0] }], 2, new Set(["a"]));
    assert.throws(() => index.search([1], 1));
    for (const k of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => index.search([1, 0], k));
  });
  await test("empty index is safe; duplicate and unknown product IDs rejected", () => {
    assert.deepEqual(new ExactCosineIndex([], 2, new Set()).search([1, 0], 3), []);
    assert.throws(() => new ExactCosineIndex([{ id: "foreign", embedding: [1, 0] }], 2, new Set(["a"])));
    assert.throws(() => new ExactCosineIndex([{ id: "a", embedding: [1, 0] }, { id: "a", embedding: [1, 0] }], 2, new Set(["a"])));
  });

  const calls: string[][] = [];
  const fakeEmbed: EmbedTexts = async texts => {
    calls.push(texts);
    return { model: S.model, vectors: texts.map(t => vector(parseInt(sha256(t).slice(0, 4), 16) % S.dimensions)), total_tokens: texts.length };
  };
  const generated = await generateArtifact(docs, fakeEmbed);
  const artifact = generated.artifact;
  await test("generation batches all 149 IDs and validates every vector", () => {
    assert.equal(generated.generated, 149); assert.equal(calls.length, Math.ceil(149 / S.batch_size));
    assert.ok(calls.every(c => c.length <= S.batch_size));
    assert.equal(validateArtifact(artifact, docs).entries.length, 149);
    assert.ok(artifact.entries.every(e => e.embedding.length === S.dimensions));
  });
  await test("unchanged rebuild is byte-identical and makes zero API calls", async () => {
    const result = await generateArtifact(docs, async () => { throw new Error("should not call API"); }, artifact);
    assert.equal(result.generated, 0); assert.equal(result.reused, 149);
    assert.equal(JSON.stringify(result.artifact), JSON.stringify(artifact));
  });
  await test("one changed description regenerates exactly one vector", async () => {
    const changed = clone(docs); changed[0].description += "\nTest"; changed[0].description_sha256 = sha256(changed[0].description);
    const result = await generateArtifact(changed, fakeEmbed, artifact);
    assert.equal(result.generated, 1); assert.equal(result.reused, 148);
    assert.notEqual(result.artifact.data_version, artifact.data_version);
  });
  await test("force/model mismatch regenerate all; interrupted generation never mutates old artifact", async () => {
    assert.equal((await generateArtifact(docs, fakeEmbed, artifact, true)).generated, 149);
    assert.equal((await generateArtifact(docs, fakeEmbed, { ...artifact, embedding_model: "different" })).generated, 149);
    const original = JSON.stringify(artifact);
    let n = 0;
    await assert.rejects(generateArtifact(docs, async texts => { if (++n > 1) throw new Error("offline"); return fakeEmbed(texts); }, artifact, true));
    assert.equal(JSON.stringify(artifact), original);
  });
  await test("missing/extra/duplicate product entries, stale data, wrong dimensions and corrupt vectors rejected", () => {
    const cases = [undefined, {}, { ...artifact, entries: artifact.entries.slice(1) }, { ...artifact, data_version: "0".repeat(64) },
      { ...artifact, dimensions: 2 }, { ...artifact, embedding_model: "other" }, { ...artifact, description_version: "old" }];
    for (const bad of cases) assert.throws(() => validateArtifact(bad, docs));
    for (const mutate of [
      (x: typeof artifact) => { x.entries[0].id = "foreign"; },
      (x: typeof artifact) => { x.entries[0] = x.entries[1]; },
      (x: typeof artifact) => { x.entries[0].embedding = [1]; },
      (x: typeof artifact) => { x.entries[0].embedding = new Array(S.dimensions).fill(0); },
      (x: typeof artifact) => { x.entries[0].description += "changed"; },
    ]) { const bad = clone(artifact); mutate(bad); assert.throws(() => validateArtifact(bad, docs)); }
  });
  await test("API response indices are reordered safely; model/count/index errors rejected", () => {
    const response = { model: S.model, object: "list" as const, usage: { total_tokens: 2, prompt_tokens: 2 },
      data: [{ index: 1, object: "embedding" as const, embedding: vector(1) }, { index: 0, object: "embedding" as const, embedding: vector(0) }] };
    assert.deepEqual(decodeResponse(response, 2).vectors, [vector(0), vector(1)]);
    assert.throws(() => decodeResponse(response, 3));
    assert.throws(() => decodeResponse({ ...response, model: "other" }, 2));
    assert.throws(() => decodeResponse({ ...response, data: [response.data[0], response.data[0]] }, 2));
    assert.throws(() => decodeResponse({ ...response, data: [{ ...response.data[0], index: 4 }, response.data[1]] }, 2));
  });
  const snapshot = indexFromArtifact(artifact, docs);
  const deps = { loadIndex: async () => snapshot, embed: fakeEmbed };
  await test("semantic service returns configurable top-k with only valid catalog IDs", async () => {
    const result = await semanticSearch(ex, answers, 7, deps);
    assert.equal(result.status, "ok"); assert.equal(result.results.length, 7);
    assert.ok(result.results.every(r => CATALOG.some(c => c.id === r.product_id) && Number.isFinite(r.similarity) && Math.abs(r.similarity) <= 1));
    assert.deepEqual(result, await semanticSearch(ex, answers, 7, deps));
  });
  await test("empty query and missing index skip the embedding API", async () => {
    const never: EmbedTexts = async () => { throw new Error("must not be reached"); };
    const before = calls.length;
    assert.equal((await semanticSearch({ ...ex, category: "NOT_A_KNIFE" }, answers, 3, { ...deps, embed: never })).status, "empty");
    const result = await semanticSearch(ex, answers, 3, { loadIndex: async () => { throw new Error("ENOENT"); }, embed: fakeEmbed });
    assert.equal(result.status, "unavailable"); assert.equal(calls.length, before);
  });
  await test("API failure, timeout and dimension errors degrade without leaking raw errors", async () => {
    for (const failure of [new EmbeddingUnavailable("embedding_api_unavailable"), new Error("timeout secret-token")]) {
      const result = await semanticSearch(ex, answers, 3, { ...deps, embed: async () => { throw failure; } });
      assert.equal(result.status, "unavailable"); assert.ok(!JSON.stringify(result).includes("secret-token"));
    }
    assert.equal((await semanticSearch(ex, answers, 3, { ...deps, embed: async () => ({ model: S.model, vectors: [[1]], total_tokens: 1 }) })).status, "unavailable");
    assert.equal((await semanticSearch(ex, answers, 0, deps)).status, "unavailable");
  });
  await test("existing deterministic ranking is identical before and after optional search failures", async () => {
    const before = score(ex, answers);
    await semanticSearch(ex, answers, 10, deps);
    await semanticSearch(ex, answers, 10, { ...deps, embed: async () => { throw new Error("unavailable"); } });
    assert.deepEqual(score(ex, answers), before);
  });
  await test("no credentials => safe failure without a network request", async () => {
    const original = process.env.OPENAI_API_KEY;
    try {
      delete process.env.OPENAI_API_KEY;
      await assert.rejects(embedTexts(["Test"]), { message: "missing_credentials" });
      await assert.rejects(embedTexts([""]), { message: "invalid_embedding_response" });
    } finally { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; }
  });
  await test("separate endpoint is disabled by default and validates malformed/empty input", async () => {
    const previous = process.env.SEMANTIC_SEARCH_ENABLED;
    try {
      delete process.env.SEMANTIC_SEARCH_ENABLED;
      assert.equal((await (await POST(new Request("http://localhost/api/semantic-search", { method: "POST" }))).json()).reason, "disabled");
      process.env.SEMANTIC_SEARCH_ENABLED = "1";
      for (const body of ["", "{}", JSON.stringify({ extraction: ex, k: 0 }), JSON.stringify({ extraction: ex, k: 150 })]) {
        assert.equal((await POST(new Request("http://localhost/api/semantic-search", { method: "POST", body }))).status, 400);
      }
      const empty = await POST(new Request("http://localhost/api/semantic-search", { method: "POST", body: JSON.stringify({ extraction: { ...ex, category: "NOT_A_KNIFE" } }) }));
      assert.equal((await empty.json()).status, "empty");
    } finally { if (previous === undefined) delete process.env.SEMANTIC_SEARCH_ENABLED; else process.env.SEMANTIC_SEARCH_ENABLED = previous; }
  });
  // Optional fixture check: real generated vectors are checked without spending API tokens.
  try {
    const real = JSON.parse(await readFile("data/catalog-embeddings.json", "utf8"));
    await test("generated real artifact: 149 dimensions/IDs validated, each self-query has cosine 1", () => {
      const actual = indexFromArtifact(real, docs);
      assert.equal(actual.artifact.entries.length, 149);
      for (const row of actual.artifact.entries) {
        const hits = actual.index.search(row.embedding, S.max_k);
        assert.ok(Math.abs(hits.find(h => h.product_id === row.id)!.similarity - 1) < 1e-12);
        assert.equal(hits.length, 149);
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.log("SKIP real artifact not generated yet (all synthetic contract tests ran)");
  }
  console.log(`\n${passed} embedding tests passed (no API calls).`);
}
