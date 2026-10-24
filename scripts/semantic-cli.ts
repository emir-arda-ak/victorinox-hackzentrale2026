import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { AnswersSchema, ExtractionSchema } from "@/lib/agent/schema";
import { catalogDocuments, EMBEDDING_SETTINGS as S, dataVersion } from "@/lib/semantic/descriptions";
import { validateArtifact } from "@/lib/semantic/artifact";
import { generateArtifact } from "@/lib/semantic/generate";
import { embedTexts, EmbeddingUnavailable } from "@/lib/semantic/provider";
import { semanticSearch } from "@/lib/semantic/search";

export async function main(args: string[]) {
  const [command, ...flags] = args;
  const file = path.join(process.cwd(), "data", "catalog-embeddings.json");
  const documents = catalogDocuments();
  if (command === "generate") {
    if (flags.some(f => !["--force", "--dry-run"].includes(f))) throw new Error("invalid_arguments");
    if (flags.includes("--dry-run")) {
      console.log(JSON.stringify({ products: documents.length, model: S.model, dimensions: S.dimensions,
        data_version: dataVersion(documents), largest_input_bytes: Math.max(...documents.map(d => Buffer.byteLength(d.description))),
        sample: documents[0] }, null, 2));
      return;
    }
    let previous: unknown;
    try { previous = JSON.parse(await readFile(file, "utf8")); } catch { /* missing/corrupt index is regenerated */ }
    let result;
    try { result = await generateArtifact(documents, embedTexts, previous, flags.includes("--force")); }
    catch (error) {
      console.error(error instanceof EmbeddingUnavailable ? error.reason : "embedding_generation_failed");
      process.exitCode = 1;
      return;
    }
    const serialized = JSON.stringify(result.artifact) + "\n";
    // No rewrite (or new timestamp/API call) when the artifact is already current.
    if (JSON.stringify(previous) !== JSON.stringify(result.artifact)) {
      const temp = `${file}.${process.pid}.tmp`;
      try { await writeFile(temp, serialized, { flag: "wx" }); await rename(temp, file); }
      finally { await rm(temp, { force: true }); }
    }
    console.log(JSON.stringify({ products: documents.length, generated: result.generated, reused: result.reused,
      total_tokens: result.total_tokens, data_version: result.artifact.data_version, file }, null, 2));
  } else if (command === "check") {
    if (flags.length) throw new Error("invalid_arguments");
    const artifact = validateArtifact(JSON.parse(await readFile(file, "utf8")), documents);
    console.log(JSON.stringify({ status: "valid", products: artifact.entries.length, dimensions: artifact.dimensions,
      embedding_model: artifact.embedding_model, data_version: artifact.data_version }, null, 2));
  } else if (command === "search") {
    let input: string | undefined;
    let k = S.default_k;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === "--extraction") input = flags[++i];
      else if (flags[i] === "--k") k = Number(flags[++i]);
      else throw new Error("invalid_arguments");
    }
    if (!input) throw new Error("missing_extraction_file");
    const raw = JSON.parse(await readFile(input, "utf8"));
    const result = await semanticSearch(ExtractionSchema.parse(raw.extraction ?? raw), AnswersSchema.parse(raw.answers ?? {}), k);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "unavailable") process.exitCode = 1;
  } else throw new Error("usage: generate [--dry-run|--force], check, search --extraction FILE [--k N]");
}
