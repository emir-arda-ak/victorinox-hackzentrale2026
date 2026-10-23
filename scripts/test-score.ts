/* Offline sanity test for scoring + clarify with hand-written extractions (no API key needed).
   Run: npx tsx scripts/test-score.ts */
import { decide } from "@/lib/agent/pipeline";
import { AnswersSchema, type Extraction } from "@/lib/agent/schema";

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
