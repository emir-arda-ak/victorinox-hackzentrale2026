// JSON-lines bridge for eval/run_eval.py --offline. No HTTP, vision, or learned-rule storage.
/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS bridge loads historical source snapshots. */
const path = require('node:path');
const readline = require('node:readline');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const jiti = require('jiti').createJiti(__filename, { alias: { '@': root }, moduleCache: false });
const { decide } = jiti(path.join(root, 'lib/agent/pipeline.ts'));
const { ExtractionSchema, AnswersSchema } = jiti(path.join(root, 'lib/agent/schema.ts'));
const catalog = require(path.join(root, 'data/catalog.json'));
const meta = require(path.join(root, 'data/tools.json'));
const handling = new Set(['clip', 'thumb_stud', 'lanyard_hole', 'key_ring', 'other']);
const visibility = { prominent: 1, normal: 0.6, hidden: 0.25 };
readline.createInterface({ input: process.stdin }).on('line', line => {
  try {
    const payload = JSON.parse(line);
    const ex = ExtractionSchema.parse(payload.extraction);
    const ans = AnswersSchema.parse(payload.answers || {});
    const res = decide(ex, ans, payload.learned || []);
    // Fixed, scorer-independent diagnostic: exact confirmed working-tool recall.
    // Uncertain tools, blade substitutions and subtool discounts do not alter this metric.
    const c = catalog.find(c => c.id === res.ranking?.candidates[0]?.id);
    const observed = [...new Set([...ex.tools_seen, ...ans.tools_yes])]
      .filter(t => !handling.has(t) && !ans.tools_no.includes(t));
    const provided = new Set(c ? [...c.tools, ...c.subtools] : []);
    const weight = t => visibility[meta[t]?.visibility] || 0.6;
    const denominator = observed.reduce((s, t) => s + weight(t), 0);
    res.evaluation = {
      confirmed_coverage: c && denominator ? observed.reduce((s, t) => s + (provided.has(t) ? weight(t) : 0), 0) / denominator : null,
      missing_confirmed: c ? observed.filter(t => !provided.has(t)) : [],
    };
    process.stdout.write(JSON.stringify(res) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error) }) + '\n');
  }
});
