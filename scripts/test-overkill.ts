import assert from "node:assert/strict";
import { CATALOG, byId, SCORING, TOOL_META } from "@/lib/catalog";
import { AnswersSchema, type Extraction } from "@/lib/agent/schema";
import { score } from "@/lib/agent/score";
import { clarify } from "@/lib/agent/clarify";
import { runAgent, type AgentEvent } from "@/lib/agent/orchestrator";
import type { ToolId } from "@/lib/catalog.types";

const core: ToolId[] = ["blade_large", "scissors", "corkscrew"];
const boeker: Extraction = {
  category: "SAK", category_confidence: 0.9, brand: "Böker", brand_evidence: null,
  is_victorinox: false, model_guess: null, visible_sku: null, open_state: "open",
  tools_seen: [...core, "blade_serrated", "fish_scaler", "chisel"], tools_maybe: [],
  sheet_visible: true, length_zone: "91/93", length_zone_alt: null, length_zone_confidence: 0.9,
  length_estimate_mm: 91, scale_color: null, scale_material: null, description: "", image_issues: [],
};
const A = (overrides: object = {}) => AnswersSchema.parse(overrides);
const compactCore = (id: string) => {
  const c = byId.get(id)!;
  return c.function_count <= 17 && core.every(t => c.tools.includes(t));
};

export async function main() {
  let count = 0;
  const test = (name: string, run: () => void) => { run(); count++; console.log(`PASS ${name}`); };
  test("uncertain extras cannot force Swiss Champ in competitor or unknown mode", () => {
    for (const is_victorinox of [false, null]) {
      const r = score({ ...boeker, is_victorinox, tools_seen: core,
        tools_maybe: ["saw_wood", "pliers", "magnifier", "fish_scaler"] }, A());
      assert.ok(compactCore(r.candidates[0].id));
      assert.ok(r.candidates.every(c => c.parts.uncertain_tools <= SCORING.functional.maybe_bonus));
    }
  });
  test("one blade plus many maybes stays a small replacement", () => {
    const r = score({ ...boeker, tools_seen: ["blade_large"],
      tools_maybe: ["scissors", "saw_wood", "pliers", "magnifier", "fish_scaler", "bits", "phillips", "screwdriver"] }, A());
    assert.ok(byId.get(r.candidates[0].id)!.function_count <= 10);
  });
  test("Böker corrections prefer compact core and disclose partial serrated-blade match", () => {
    const r = score(boeker, A({ tools_no: ["fish_scaler", "chisel"] }));
    assert.ok(compactCore(r.candidates[0].id));
    assert.ok(r.candidates[0].functional!.partially_matched_working_tools.includes(TOOL_META.blade_serrated.label));
    assert.deepEqual(r, score(boeker, A({ tools_no: ["fish_scaler", "chisel"] })));
  });
  test("explicit demand for bits still selects a model with bits", () => {
    const r = score({ ...boeker, tools_seen: ["blade_large", "scissors", "bits"] }, A({ tools_yes: ["bits"] }));
    assert.ok(byId.get(r.candidates[0].id)!.tools.includes("bits"));
  });
  test("explicit fish scaler and chisel requirements still justify larger models", () => {
    for (const tool of ["fish_scaler", "chisel"] as const) {
      const tools_seen = [...core, tool];
      const r = score({ ...boeker, tools_seen }, A({ tools_yes: tools_seen }));
      assert.ok(byId.get(r.candidates[0].id)!.tools.includes(tool));
      assert.deepEqual(r.candidates[0].functional!.missing_working_tools, []);
    }
  });
  test("genuine full Swiss Champ and XXL profiles retain functional matches", () => {
    for (const id of ["1.6795", "1.6795.XXL"]) {
      const c = byId.get(id)!;
      const r = score({ ...boeker, tools_seen: c.tools }, A({ tools_yes: c.tools }));
      const top = byId.get(r.candidates[0].id)!;
      assert.ok(c.tools.every(t => top.tools.includes(t) || top.subtools.includes(t)), top.name);
    }
  });
  test("vision-only fish scaler and chisel are rechecked even at high confidence", () => {
    const r = score(boeker, A());
    const q = clarify(boeker, A(), { ...r, confidence: 1, level: "high" });
    assert.equal(q?.type === "tool" && q.tool, "fish_scaler");
    const ans = A({ tools_no: ["fish_scaler"] });
    const next = clarify(boeker, ans, score(boeker, ans));
    assert.equal(next?.type === "tool" && next.tool, "chisel");
  });
  test("confirmed or denied features are never challenged; round limit and identification stay intact", () => {
    for (const ans of [A({ tools_yes: boeker.tools_seen }), A({ tools_no: ["fish_scaler", "chisel"] })]) {
      const q = clarify(boeker, ans, score(boeker, ans));
      assert.ok(q?.type !== "tool" || ![...ans.tools_yes, ...ans.tools_no].includes(q.tool));
    }
    assert.equal(clarify(boeker, A({ rounds: 2 }), score(boeker, A())), null);
    const identified = { ...boeker, is_victorinox: true, visible_sku: "1.6795" };
    const r = score(identified, A());
    assert.equal(r.candidates[0].id, "1.6795");
    assert.equal(clarify(identified, A(), { ...r, confidence: 1, level: "high" }), null);
  });
  for (const answer of ["no", "yes", "weak-no", "unclear", "failure"] as const) {
    const events: AgentEvent[] = [];
    const snapshot = JSON.stringify(boeker);
    await runAgent({ photos: ["mock-photo"], previous: [boeker], answers: A() }, e => events.push(e), {
      extract: async () => { throw new Error("Should reuse cached extraction"); },
      getLearnedRules: async () => [],
      verifyTool: async (_photos, label) => {
        if (answer !== "yes") assert.ok([TOOL_META.fish_scaler.label, TOOL_META.chisel.label].includes(label));
        if (answer === "failure") throw new Error("Mock unavailable");
        return { answer: answer === "weak-no" ? "no" : answer, confidence: answer === "weak-no" ? 0.8 : 1, evidence: "Mock verification", ms: 0 };
      },
    });
    const result = events.find(e => e.type === "result");
    assert.ok(result?.type === "result");
    assert.equal(JSON.stringify(boeker), snapshot);
    if (answer === "no") {
      assert.deepEqual(result.result.answers.tools_no, ["fish_scaler", "chisel"]);
      assert.ok(compactCore(result.result.ranking!.candidates[0].id));
      assert.equal(result.result.agent_checks.length, 2);
    } else if (answer === "yes") {
      assert.ok(result.result.answers.tools_yes.includes("fish_scaler"));
      assert.deepEqual(result.result.answers.tools_no, []);
      assert.ok(byId.get(result.result.ranking!.candidates[0].id)!.tools.includes("fish_scaler"));
    } else {
      assert.deepEqual(result.result.answers.tools_no, []);
      assert.equal(result.result.question?.type === "tool" && result.result.question.tool, "fish_scaler");
    }
    count++;
    console.log(`PASS agent verification ${answer}: corrections or user follow-up, no silent evidence removal`);
  }
  test("empty evidence stays finite with valid IDs and bounded confidence", () => {
    const r = score({ ...boeker, tools_seen: [], tools_maybe: [] }, A());
    assert.ok(r.candidates.every(c => CATALOG.some(m => m.id === c.id) && Number.isFinite(c.score)));
    assert.ok(r.confidence >= 0 && r.confidence <= SCORING.confidence.no_confirmed_max);
  });
  console.log(`\n${count} overkill regression tests passed (no API calls).`);
}
