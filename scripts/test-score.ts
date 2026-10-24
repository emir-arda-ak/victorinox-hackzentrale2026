/* Offline sanity test for scoring + clarify with hand-written extractions (no API key needed).
   Run: npx tsx scripts/test-score.ts */
import { decide } from "@/lib/agent/pipeline";
import { AnswersSchema, type Extraction } from "@/lib/agent/schema";
import { score, type LearnedRule } from "@/lib/agent/score";
import { functionalCoverageScore } from "@/lib/agent/functional";
import { byId } from "@/lib/catalog";

const base: Extraction = {
  category: "SAK", category_confidence: 0.9, brand: null, brand_evidence: null, is_victorinox: null,
  model_guess: null, visible_sku: null, open_state: "open", tools_seen: [], tools_maybe: [],
  sheet_visible: true, length_zone: null, length_zone_alt: null, length_zone_confidence: 0.8,
  length_estimate_mm: null, scale_color: "rot", scale_material: "Cellidor", description: "", image_issues: [],
};

const cases: { name: string; expect: string[]; ex: Partial<Extraction>; ans?: object }[] = [
  { name: "Spartan, Victorinox erkannt", expect: ["1.3603"], ex: { brand: "Victorinox", is_victorinox: true, model_guess: "Spartan", length_zone: "91/93",
      tools_seen: ["blade_large", "blade_small", "corkscrew", "can_opener", "bottle_opener", "awl", "key_ring"] } },
  { name: "Spartan-Klon, Marke unbekannt", expect: ["1.3603", "1.3601.63", "1.3603.31P"], ex: { length_zone: "91/93",
      tools_seen: ["blade_large", "blade_small", "corkscrew", "can_opener", "bottle_opener", "awl", "key_ring"] } },
  { name: "Swiza-artig: Klinge, Schere, Kapselheber, Feile, Clip (93 mm Alox-artig)", expect: ["0.8226.20", "0.8216.20"], ex: { brand: "Swiza", is_victorinox: false,
      length_zone: "91/93", scale_material: "Metall", tools_seen: ["blade_large", "scissors", "bottle_opener", "nail_file", "clip"] } },
  { name: "Leatherman-artiges Multitool", expect: ["3.0323.L", "3.0327.L", "3.0338.L", "3.0224.L"], ex: { category: "MULTITOOL", brand: "Leatherman", is_victorinox: false,
      sheet_visible: false, length_zone_confidence: 0, scale_color: "silber", scale_material: "Metall",
      tools_seen: ["pliers", "wire_cutter", "blade_large", "blade_serrated", "saw_wood", "screwdriver", "can_opener", "bottle_opener", "awl"] } },
  { name: "Benchmade-artiges Einhandmesser", expect: ["0.9411.D20", "0.9415.DS23", "0.9415.D630", "0.9425.DS222", "0.9411.M3"], ex: { category: "ONEHAND", brand: "Benchmade", is_victorinox: false,
      sheet_visible: false, length_zone_confidence: 0, tools_seen: ["blade_large", "clip", "thumb_stud"] } },
  { name: "Swiss Champ voll aufgeklappt", expect: ["1.6795", "1.6791.63"], ex: { length_zone: "91/93",
      tools_seen: ["blade_large", "blade_small", "scissors", "saw_wood", "magnifier", "pliers", "fish_scaler", "corkscrew", "hook", "chisel", "nail_file", "phillips"] } },
  { name: "Zugeklappt -> Rückfrage Foto", expect: [], ex: { open_state: "closed", length_zone: "91/93", tools_seen: ["key_ring"] } },
  { name: "Ohne Messunterlage, Klinge+Schere+Säge", expect: [], ex: { sheet_visible: false, length_zone_confidence: 0,
      tools_seen: ["blade_large", "blade_small", "scissors", "saw_wood", "bottle_opener", "can_opener", "corkscrew"] } },
  { name: "Gleich, nach Antwort Länge 111", expect: [], ex: { sheet_visible: false, length_zone_confidence: 0,
      tools_seen: ["blade_large", "blade_small", "scissors", "saw_wood", "bottle_opener", "can_opener", "corkscrew"] }, ans: { length_zone: "111", rounds: 1 } },
  { name: "Kein Messer", expect: [], ex: { category: "NOT_A_KNIFE" } },
];

let pass = 0;
for (const tc of cases) {
  const r = decide({ ...base, ...tc.ex } as Extraction, AnswersSchema.parse(tc.ans ?? {}));
  const top3 = r.ranking?.candidates.slice(0, 3) ?? [];
  const ok = tc.expect.length === 0 || top3.some((c) => tc.expect.includes(c.id));
  if (ok) pass++;
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${tc.name}  [${r.status}, ${r.path}]`);
  top3.forEach((c, i) => console.log(`  ${i + 1}. ${c.id} ${c.name} (${c.length_mm ?? "–"} mm) score=${c.score}  ${JSON.stringify(c.parts)}`));
  if (r.ranking) console.log(`  confidence=${r.ranking.confidence} (${r.ranking.level}) · ${r.ranking.reasons.join(" · ")}`);
  if (r.question) console.log(`  ? ${r.question.type}: ${r.question.text} — ${r.question.reason}`);
  if (top3[0]) console.log(`  » ${top3[0].explanation.join(" ")}`);
}
console.log(`\n${pass}/${cases.length} passed`);

// ---------- function-first regression tests (assertions) ----------
let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };
const A = (o: object = {}) => AnswersSchema.parse(o);
const boeker = { ...base, category: "ONEHAND", category_confidence: 0.785, brand: "Böker", is_victorinox: false, open_state: "open",
  tools_seen: ["blade_large", "clip", "corkscrew", "scissors"], tools_maybe: ["other", "saw_wood"], length_zone: "111",
  length_zone_confidence: 0.78, length_estimate_mm: 102.5, scale_color: "schwarz", scale_material: "Andere" } as Extraction;
const boekerAns = A({ tools_yes: ["thumb_stud"], tools_no: ["other"] });
const core = ["blade_large", "scissors", "corkscrew"];
const coversCore = (id: string) => { const c = byId.get(id)!; return core.every((t) => c.tools.includes(t as never)); };
const isEvoke = (id: string) => byId.get(id)!.name.startsWith("Evoke");
console.log("\n--- function-first ---");
{
  const r = score(boeker, boekerAns, []);
  const t = r.candidates[0];
  check("1 Böker ohne Regeln: Top-1 deckt Klinge+Schere+Korkenzieher", coversCore(t.id) && !isEvoke(t.id), `${t.id} ${t.name} ${JSON.stringify(t.parts)}`);
  check("1b Böker: Top-1 ohne fehlende bestätigte Arbeitsfunktion", (t.functional?.missing_working_tools.length ?? 1) === 0);
  check("1c Böker: Kategorie-Widerspruch -> nicht 'high'", r.level !== "high", `${r.confidence} ${r.level}`);
}
{
  const rule: LearnedRule = { brand: "Böker", model: null, category: "ONEHAND", zone: "111", tools: ["blade_large", "clip", "corkscrew", "scissors"], victorinox_id: "0.9415.DS23", count: 5 };
  const r = score(boeker, boekerAns, [rule]);
  const ev = r.candidates.find((c) => c.id === "0.9415.DS23");
  check("2 Böker + gelernte Evoke-Regel: Funktion schlägt Regel", coversCore(r.candidates[0].id), `${r.candidates[0].id}; Evoke learned=${ev?.parts.learned ?? "nicht in Top-10"}`);
}
{
  const ex = { ...base, category: "ONEHAND", brand: "Benchmade", is_victorinox: false, sheet_visible: false, length_zone_confidence: 0,
    tools_seen: ["blade_large", "clip", "thumb_stud"] } as Extraction;
  const r = score(ex, A(), []);
  check("3 Klinge+Clip+Daumenpin: Evoke bleibt plausibel (Top-3)", r.candidates.slice(0, 3).some((c) => isEvoke(c.id)), r.candidates.slice(0, 3).map((c) => c.name).join(", "));
}
{
  const r = score(boeker, A({ tools_yes: ["thumb_stud"], tools_no: ["corkscrew", "other"] }), []);
  const t = r.candidates[0];
  check("4a Nein-Antwort Korkenzieher: nicht als fehlend gezählt, Top-1 hat Klinge+Schere", !t.functional!.missing_working_tools.includes("Korkenzieher") && byId.get(t.id)!.tools.includes("scissors"), t.name);
  const onlyMaybe = score({ ...boeker, tools_seen: ["blade_large"], tools_maybe: ["scissors"] } as Extraction, A(), []);
  check("4b Unsicheres Werkzeug erscheint nie als 'fehlt'", onlyMaybe.candidates.every((c) => !c.functional!.missing_working_tools.includes("Schere")));
  const closed = score({ ...base, open_state: "closed", tools_seen: ["key_ring"], length_zone: "91/93" } as Extraction, A(), []);
  check("4c Zugeklappt (nur Ring): Funktionsabdeckung unbekannt, Teil = 0", closed.candidates.every((c) => c.functional!.coverage === null && c.parts.functional_coverage === 0));
  const nolen = score({ ...boeker, sheet_visible: false, length_zone: null, length_zone_confidence: 0, length_estimate_mm: null } as Extraction, boekerAns, []);
  check("4d Länge unbekannt: Längenteil überall 0", nolen.candidates.every((c) => c.parts.length === 0));
  const ev = score({ ...base, category: "ONEHAND", is_victorinox: false, tools_seen: ["blade_large", "clip", "thumb_stud"], length_estimate_mm: 100 } as Extraction, A(), []);
  const evoke = ev.candidates.find((c) => isEvoke(c.id));
  check("4e Katalog ohne Länge (Evoke): neutral, nicht perfekt", !!evoke && evoke.parts.length === 0, String(evoke?.parts.length));
  const nk = decide({ ...base, category: "NOT_A_KNIFE" } as Extraction, A());
  check("4f Kein Messer wird abgelehnt", nk.status === "rejected");
  const sku = score({ ...base, brand: "Victorinox", is_victorinox: true, visible_sku: "1.3603", tools_seen: ["blade_large"] } as Extraction, A(), []);
  check("4g Sichtbare Artikelnummer gewinnt (Victorinox-Pfad)", sku.candidates[0].id === "1.3603" && sku.confidence >= 0.95);
  const sw = functionalCoverageScore(byId.get("0.9411.D20")!, { ...base, tools_seen: ["blade_small"] } as Extraction, A());
  check("4h Kleine Klinge vs. nur grosse: Teilkredit, kein exakter Treffer", sw.coverage! > 0 && sw.coverage! < 1 && sw.partial.includes("blade_small"), String(sw.coverage));
  const mat = score({ ...boeker, scale_material: "Andere" } as Extraction, boekerAns, []);
  check("4i Material 'Andere' passt auf nichts", mat.candidates.every((c) => c.parts.material === 0));
}
{
  const inputs: [Extraction, ReturnType<typeof A>][] = [[boeker, boekerAns], [{ ...base } as Extraction, A()], [{ ...base, open_state: "closed" } as Extraction, A()],
    [{ ...base, category: "MULTITOOL", is_victorinox: false, tools_seen: ["pliers"] } as Extraction, A({ tools_no: ["scissors"] })]];
  let ok = true;
  for (const [ex, an] of inputs) {
    const r1 = score(ex, an, []), r2 = score(ex, an, []);
    ok &&= r1.confidence >= 0 && r1.confidence <= 1 && Number.isFinite(r1.confidence);
    ok &&= r1.candidates.every((c) => Number.isFinite(c.score) && Object.values(c.parts).every(Number.isFinite));
    ok &&= JSON.stringify(r1.candidates.map((c) => c.id)) === JSON.stringify(r2.candidates.map((c) => c.id));
  }
  check("5 Keine NaN, Konfidenz in [0,1], stabile Reihenfolge", ok);
}
console.log(`\nfunction-first: ${fails === 0 ? "alle bestanden" : fails + " fehlgeschlagen"}`);
if (fails || pass !== cases.length) process.exitCode = 1;
