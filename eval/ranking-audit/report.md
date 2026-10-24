# Functional replacement ranking audit

2026-10-24. Local changes only; nothing merged, pushed or deployed.

The starting checkout (`d506c8b`) already contained a function-first change (`bf4a482`). This audit distinguishes the **legacy scorer** (`7f3702e`, before that change), the **starting checkout** (“before”), and the **final working tree** (“after”). Earlier report files were left intact; the results here were recomputed rather than copied.

The final change closes gaps in the existing implementation. It does **not** establish a general accuracy improvement: competitor photo Top-1 improves by one, aggregate Top-3 decreases, and combined-knife results and functional coverage are unchanged relative to the starting checkout. The functional contracts are protected by regression tests.

## Method and limits

- 123 frozen cached extractions, 15 distinct knives; same catalog and current ground truth for all three versions. Hashes are in `manifest.json`.
- 55 competitor photos / 8 knives; 65 current Victorinox photos / 6 knives; 3 photos / 1 discontinued Victorinox knife (`eol`, reported separately).
- Offline execution calls the real `decide()` pipeline through a persistent Node process. It validates the same extraction/answer schemas as the score route. No HTTP, vision, API, Redis, live feedback, or new extraction calls.
- The existing Python evaluator's merge and ground-truth acceptance rules are preserved. “Per knife” means all cached views merged into one extraction, not “at least one photo got it right.” Photo and knife outcomes are correlated, not independent trials.
- `--no-sku` is primary: the ground truth records an incorrectly labelled Classic SD. SKU-enabled results are a separate sensitivity check.
- Cross-reference data contains only an ignored placeholder; learned rules are fixed to empty. Their safety properties are tested with adversarial synthetic fixtures, not inferred from this dataset.
- Fixed diagnostic: visibility-weighted **exact confirmed working-tool recall** of Top-1. Main and subtools count as present; blade substitutions get no credit in this evaluation metric. Maybe-tools, handling and `other` are excluded. Rows without working-tool evidence are excluded, never assigned 100%. This differs deliberately from the scorer's partial-credit coverage.
- Two exploratory weight configurations were checked. A very weak complexity preference let oversized candidates win for small extra coverage gains. The final bounded complexity weight and weaker ring/lanyard evidence retained the starting per-knife accuracy. No per-SKU or per-brand overrides, fitted weights or statistical generalization claims.

## Before / after metrics

Counts and percentages below use the same denominators.

### Ignoring visible SKU (primary)

| Unit / truth group | Legacy Top-1 / Top-3 | Before Top-1 / Top-3 | After Top-1 / Top-3 |
|---|---|---|---|
| Photo / all | 27/123 (22.0%) / 43/123 (35.0%) | 27/123 (22.0%) / 45/123 (36.6%) | 28/123 (22.8%) / 43/123 (35.0%) |
| Photo / competitor | 19/55 (34.5%) / 26/55 (47.3%) | 20/55 (36.4%) / 28/55 (50.9%) | 21/55 (38.2%) / 28/55 (50.9%) |
| Photo / victorinox | 5/65 (7.7%) / 14/65 (21.5%) | 4/65 (6.2%) / 14/65 (21.5%) | 4/65 (6.2%) / 12/65 (18.5%) |
| Photo / eol | 3/3 (100.0%) / 3/3 (100.0%) | 3/3 (100.0%) / 3/3 (100.0%) | 3/3 (100.0%) / 3/3 (100.0%) |
| Combined knife / all | 11/15 (73.3%) / 13/15 (86.7%) | 12/15 (80.0%) / 13/15 (86.7%) | 12/15 (80.0%) / 13/15 (86.7%) |
| Combined knife / competitor | 5/8 (62.5%) / 7/8 (87.5%) | 6/8 (75.0%) / 7/8 (87.5%) | 6/8 (75.0%) / 7/8 (87.5%) |
| Combined knife / victorinox | 5/6 (83.3%) / 5/6 (83.3%) | 5/6 (83.3%) / 5/6 (83.3%) | 5/6 (83.3%) / 5/6 (83.3%) |
| Combined knife / eol | 1/1 (100.0%) / 1/1 (100.0%) | 1/1 (100.0%) / 1/1 (100.0%) | 1/1 (100.0%) / 1/1 (100.0%) |

### Using cached visible SKU

| Unit / truth group | Legacy Top-1 / Top-3 | Before Top-1 / Top-3 | After Top-1 / Top-3 |
|---|---|---|---|
| Photo / all | 31/123 (25.2%) / 47/123 (38.2%) | 32/123 (26.0%) / 48/123 (39.0%) | 33/123 (26.8%) / 47/123 (38.2%) |
| Photo / competitor | 19/55 (34.5%) / 26/55 (47.3%) | 20/55 (36.4%) / 28/55 (50.9%) | 21/55 (38.2%) / 28/55 (50.9%) |
| Photo / victorinox | 9/65 (13.8%) / 18/65 (27.7%) | 9/65 (13.8%) / 17/65 (26.2%) | 9/65 (13.8%) / 16/65 (24.6%) |
| Photo / eol | 3/3 (100.0%) / 3/3 (100.0%) | 3/3 (100.0%) / 3/3 (100.0%) | 3/3 (100.0%) / 3/3 (100.0%) |
| Combined knife / all | 11/15 (73.3%) / 14/15 (93.3%) | 12/15 (80.0%) / 14/15 (93.3%) | 12/15 (80.0%) / 14/15 (93.3%) |
| Combined knife / competitor | 5/8 (62.5%) / 7/8 (87.5%) | 6/8 (75.0%) / 7/8 (87.5%) | 6/8 (75.0%) / 7/8 (87.5%) |
| Combined knife / victorinox | 5/6 (83.3%) / 6/6 (100.0%) | 5/6 (83.3%) / 6/6 (100.0%) | 5/6 (83.3%) / 6/6 (100.0%) |
| Combined knife / eol | 1/1 (100.0%) / 1/1 (100.0%) | 1/1 (100.0%) / 1/1 (100.0%) | 1/1 (100.0%) / 1/1 (100.0%) |

### Confirmed functional coverage of Top-1 (primary run)

| Unit / truth group | Evidence rows | Legacy | Before | After |
|---|---:|---:|---:|---:|
| foto / all | 91 | 97.25% | 97.80% | 97.80% |
| foto / competitor | 37 | 97.30% | 98.65% | 98.65% |
| foto / victorinox | 51 | 97.06% | 97.06% | 97.06% |
| messer / all | 15 | 87.78% | 90.00% | 90.00% |
| messer / competitor | 8 | 84.23% | 88.39% | 88.39% |
| messer / victorinox | 6 | 90.48% | 90.48% | 90.48% |

## Every distinct knife (primary run)

| Knife | Before Top-1 | After Top-1 | Before → after Top-1 / Top-3 hits | Photo Top-1 before → after | Photo Top-3 before → after |
|---|---|---|---|---|---|
| Victorinox Camper | Camper (`1.3613`) | Camper (`1.3613`) | 1/1 → 1/1 | 0/10 → 0/10 | 4/10 → 3/10 |
| Victorinox Classic SD (58mm) | Classic Sd (`0.6223`) | Classic Sd (`0.6223`) | 1/1 → 1/1 | 1/9 → 1/9 | 4/9 → 3/9 |
| Victorinox Outrider | Outrider (`0.8513`) | Outrider (`0.8513`) | 1/1 → 1/1 | 0/9 → 0/9 | 2/9 → 2/9 |
| Victorinox Ranger 57 M Grip | Ranger 55 Grip (`0.9563.C`) | Ranger 55 Grip (`0.9563.C`) | 0/0 → 0/0 | 0/8 → 0/8 | 0/8 → 0/8 |
| Victorinox SwissTool | Swiss Tool Spirit X Plus (`3.0235.L`) | Swiss Tool Spirit X Plus (`3.0235.L`) | 1/1 → 1/1 | 0/12 → 0/12 | 0/12 → 0/12 |
| Victorinox SwissTool Spirit | Swiss Tool (`3.0323.L`) | Swiss Tool (`3.0323.L`) | 1/1 → 1/1 | 3/17 → 3/17 | 4/17 → 4/17 |
| Victorinox Hunter Pro Alox | Evoke Alox (`0.9411.D20`) | Evoke Alox (`0.9411.D20`) | 1/1 → 1/1 | 3/3 → 3/3 | 3/3 → 3/3 |
| Böker Plus Tech-Tool Carbon 3 01BO823 | Climber (`1.3703`) | Climber (`1.3703`) | 1/1 → 1/1 | 1/10 → 1/10 | 2/10 → 1/10 |
| Gerber Gear ARMBAR DRIVE | Cyber Tool M (`1.7725.T`) | Cyber Tool M (`1.7725.T`) | 1/1 → 1/1 | 1/6 → 1/6 | 1/6 → 1/6 |
| Gerber Gear Suspension Multi-Plier | Swiss Tool Spirit X (`3.0224.L`) | Swiss Tool Spirit X (`3.0224.L`) | 1/1 → 1/1 | 7/10 → 8/10 | 8/10 → 8/10 |
| Leatherman Crater C33SX | Evoke Bs Alox (`0.9415.DS23`) | Evoke Bs Alox (`0.9415.DS23`) | 0/1 → 0/1 | 0/6 → 0/6 | 4/6 → 4/6 |
| Leatherman REV | Swiss Tool (`3.0323.L`) | Swiss Tool (`3.0323.L`) | 1/1 → 1/1 | 9/11 → 10/11 | 10/11 → 11/11 |
| Spyderco C94GP UK Pen Knife | Evoke Bs Alox (`0.9415.DS23`) | Evoke Bs Alox (`0.9415.DS23`) | 0/0 → 0/0 | 0/3 → 0/3 | 0/3 → 0/3 |
| Swiza Schweizer Messer D03 | Spartan (`1.3603`) | Spartan Wood (`1.3601.63`) | 1/1 → 1/1 | 1/6 → 0/6 | 2/6 → 1/6 |
| The James Brand The Pike, Rosewood KN110142-00 | Onefold Alox (`0.8006.20`) | Onefold Alox (`0.8006.20`) | 1/1 → 1/1 | 1/3 → 1/3 | 1/3 → 2/3 |

No combined-knife Top-1 or Top-3 regressions versus the starting checkout in either SKU setting. Ranger 57 M Grip and Spyderco remain outside Top-3 in the primary run; Leatherman Crater remains Top-3 but not Top-1. The cached Ranger extraction lacks the distinctive gutting blade. Locking/slipjoint behavior is not represented in the current tool vocabulary, limiting the Spyderco replacement comparison.

## Explicit regressions versus the starting checkout

| Photo | Lost metric | SKU settings | Before Top-3 → after Top-3 |
|---|---|---|---|
| `Victorinox Camper/vic_camper_oeffner_offen_02_unterlage.heic` | hit3 | no-sku, with-sku | `1.3603;1.3405;1.3613` → `1.3603;1.3405;0.3303` |
| `Victorinox Classic SD (58mm)/vic_classic_sd_geschlossen_rueckseite_unterlage.heic` | hit3 | no-sku | `0.6123;0.6263;0.6223` → `0.6123;0.6263;0.6221.35` |
| `Böker Plus Tech-Tool Carbon 3 01BO823/boeker_tech_tool_carbon3_geschlossen_rueckseite_unterlage.heic` | hit3 | no-sku, with-sku | `1.3603;1.3603.31P;1.3703` → `1.3601.63;1.3603;1.3603.31P` |
| `Swiza Schweizer Messer D03/swiza_d03_geschlossen_unterlage.heic` | hit1 | no-sku, with-sku | `1.3603;1.3613;1.3703` → `0.8341.MC9;1.3603;0.8353` |
| `Swiza Schweizer Messer D03/swiza_d03_korkenzieher_offen_unterlage.heic` | hit3 | no-sku, with-sku | `0.8353;0.8313.W;1.3603` → `0.8341.MC9;0.8313.W;0.8361.MC` |

Interpretation: the Camper photo has only a confirmed ring plus uncertain corkscrew/`other`; ignoring `other` in identification changes its third place. The Classic SD back photo has only a ring and unknown brand, so weak handling evidence and the new complexity preference change the tie ordering. The Böker back and Swiza views have sparse working evidence; removing unseen-tool penalties and rebalancing length/complexity changes accepted alternatives. These losses are retained and reported, not hidden with fixture-specific exceptions.

Relative to the legacy scorer, Top-1 on the closed Classic SD back photo (`vic_classic_sd_geschlossen_rueckseite_unterlage.heic`) is still a regression inherited from the previous function-first version. Detailed legacy transitions can be read from the same row keys in the legacy CSVs. The table below enumerates every legacy-to-final accuracy loss as well.

| Photo / knife | Lost metric | SKU settings |
|---|---|---|
| `Victorinox Camper/vic_camper_oeffner_offen_02_unterlage.heic` | hit3 | no-sku, with-sku |
| `Victorinox Classic SD (58mm)/vic_classic_sd_geschlossen_rueckseite_unterlage.heic` | hit1, hit3 | no-sku, with-sku |
| `Böker Plus Tech-Tool Carbon 3 01BO823/boeker_tech_tool_carbon3_geschlossen_rueckseite_unterlage.heic` | hit3 | no-sku, with-sku |
| `Swiza Schweizer Messer D03/swiza_d03_korkenzieher_offen_unterlage.heic` | hit3 | no-sku, with-sku |

## Supplied Böker example

The prompt omits some schema fields. The reproducible fixture in `example-comparison.json` uses the existing test's defaults: sheet visible, length confidence 0.78, no model guess/SKU, material `Andere`, thumb stud explicitly confirmed. This synthetic `ONEHAND` case is separate from the cached multi-photo Böker extraction, whose merged category is SAK and includes a serrated blade.

| Scorer | Top-1 without a learned rule | Top-1 with a strong learned Evoke rule | Reliability without / with rule |
|---|---|---|---|
| Legacy | Evoke BS Alox, 2.59 | Evoke BS Alox, 6.59 | 0.42 / 0.60 |
| Starting checkout | Outrider, 5.74 | Outrider, 5.74 | 0.74 / 0.74 |
| Final | Outrider, 5.64 | Outrider, 5.64 | 0.40 / 0.40 |

Legacy Evoke parts: tools **+0.12**, category **+1.96**, color **+0.50**, and **+4.00** crossref when the learned rule is present. It covers only one of the three confirmed working functions.

Final Outrider parts: functional coverage **+5.50**, handling **0**, explicit negatives (`tools`) **0**, complexity **−0.77**, length **+0.31**, category **+0.39**, color **+0.20**. It covers the large blade, scissors and corkscrew, and also has the uncertain saw. Its competitors have similar functional fit, so its heuristic reliability is only 0.40. Totals are computed before rounding individual parts.

For a source containing only large blade + clip + thumb stud, Evoke-style products remain in the Top-3. Synthetic fixtures verify this is based on attributes, not product identifiers. The catalog reference agrees with these tool distinctions (printed pages 47, 49 and 80; PDF pages 49, 51 and 82). No catalog data was altered.

## Final formula

For competitor/unknown replacement, add:

```text
5.5 × (2 × weighted functional coverage − 1)
+ 0.75 × handling similarity
+ 1.0 × length fit
+ (1.0 to 1.5) × category fit × category confidence × category trust
+ 0.75 × crossref match × coverage gate
+ 0.75 × learned match × coverage gate
+ 0.25 × material match + 0.20 × color match
− 1.5 × explicit-negative conflict fraction
− up to 2.0 for disproportionate complexity
```

- Functional coverage is weighted recall, not intersection-over-union. Missing confirmed functions lower it. Extra unseen tools do not enter its denominator. `other` never enters functional evidence.
- Tool evidence: user-confirmed 1.25, seen 1, maybe 0.4; multiplied by existing visibility weights (prominent 1, normal 0.6, hidden 0.25). Explicit no wins over yes/vision if inputs conflict. A profile containing only maybe-tools gets only 0.4 of the functional score; no evidence gives zero, not a perfect match.
- Credit: main tool 1, subtool 0.6, alternate blade size 0.8, generic blade substituting for serrated/hook blade 0.6. Partial credit is separately exposed and never called a full match.
- Handling covers clip, thumb stud, lanyard hole and ring separately. Clip/stud evidence weight 1; ring/lanyard 0.25. Weighted overlap is divided by at least 1 so a lone ring does not earn the same bonus as a clip.
- Negative conflicts check main tools **and** subtools, including handling. The backward-compatible `parts.tools` holds this explicit-negative penalty in replacement mode. Direct Victorinox identification retains legacy net tool fit there.
- Complexity is the existing bounded logarithmic size-ratio preference: `−2 × clamp(log2(max(1, candidate working count / max(4, 1.5 × confirmed working count))) / 3, 0, 1)`. A few extras incur little or no penalty; the maximum is smaller than the 11-point functional score span. It is a preference for proportional replacements, not a claim that unseen tools are absent.
- Category weight falls from 1.5 with no confirmed work functions to 1.0 at three. A single-blade category plus at least two confirmed non-blade functions is scored as SAK (or MULTITOOL with confirmed, non-denied pliers) at half trust. This correction is scoring-only and explained in reasons. User category answers override it; the extraction is not silently rewritten.
- Both reference bonuses use `min(total coverage, confirmed coverage)^2`; absent confirmed coverage falls back to total coverage, and no coverage gives no bonus. Combined support is capped at 1.5 before the gate. Stored recommendations do not count as product truth.
- Unknown catalog lengths score exactly zero in every category. Missing source length also scores zero.
- Direct Victorinox identification keeps tool/category/name/SKU ranking weights of 3 / 2.5 / 3 / 10. Exact model/variant SKU recognition is tested; exact Victorinox SKU reliability retains a 0.95 floor. Competitor article numbers cannot receive a Victorinox SKU bonus. Unknown-brand inputs may still use SKU evidence for ranking, but do not receive the exact-Victorinox reliability floor.

Reliability is bounded to [0,1], combines fit, separation and observed evidence, and discounts missing confirmed functions. Category, color/material and reference bonuses are excluded from both fit and separation in **all** modes. Replacement reliability is capped by confirmed coverage, or 0.45 without confirmed work functions. Exact SKU is the deliberate direct-identification exception. The UI now calls the value heuristic reliability out of 100, not a probability.

Diagnostics separate confirmed full matches, partial matches, uncertain matches, missing confirmed functions and confirmed handling matches. Tools present only in the catalog remain “unknown on the photo”; “only Victorinox” is used only after an explicit no answer.

## Files changed and why

| File | Purpose |
|---|---|
| `lib/agent/score.ts` | Separate replacement negatives/coverage, gate both reference types, neutral missing lengths, protect SKU identification, support-free reliability, honest tool rows and diagnostics. |
| `lib/agent/functional.ts` | Consistent no-answer precedence, confirmed/uncertain/partial coverage, negative conflict helper, differentiated handling evidence. |
| `config/scoring.json` | Configurable replacement weights and confidence bounds; remove obsolete unknown-length penalty and unused option. |
| `lib/agent/explain.ts` | Explain full/partial/uncertain functions accurately; stored reference is support rather than verification. |
| `app/page.tsx` | Label reliability as a heuristic score, not percentage probability. |
| `lib/agent/orchestrator.ts` | Use the same reliability wording in agent progress. |
| `scripts/test-score.ts` | Attribute-based regression fixtures covering manual/learned support, negatives, uncertain tools, unknown lengths, exact identity, deterministic finite results and extraction immutability. |
| `scripts/test-score.cjs` | Offline runner for the existing TypeScript suite. |
| `scripts/score-cached.cjs` | Persistent JSON-lines scoring bridge and fixed independent coverage diagnostic; no storage/network calls. |
| `eval/run_eval.py` | Reuse cached-evaluation/merge infrastructure offline; truth-group summaries, coverage columns and failure exit status. |
| `package.json` | `npm test` and an explicit dev dependency on the already installed Jiti runtime. |
| `package-lock.json` | Record that direct dev dependency; existing version/integrity unchanged. |
| `README.md` | Offline commands and reliability/evaluation limits. |
| `eval/ranking-audit/legacy-no-sku.csv` | Recomputed legacy primary results. |
| `eval/ranking-audit/legacy-with-sku.csv` | Recomputed legacy SKU sensitivity results. |
| `eval/ranking-audit/before-no-sku.csv` | Starting-checkout primary baseline captured before algorithm edits. |
| `eval/ranking-audit/before-with-sku.csv` | Starting-checkout SKU sensitivity baseline. |
| `eval/ranking-audit/after-no-sku.csv` | Final primary evaluation with row-level diagnostics. |
| `eval/ranking-audit/after-with-sku.csv` | Final SKU sensitivity evaluation. |
| `eval/ranking-audit/example-comparison.json` | Exact Böker input/defaults, learned rule and three-version output. |
| `eval/ranking-audit/manifest.json` | Source revisions, data hashes and empty-feedback policy. |
| `eval/ranking-audit/report.md` | This reviewable report. |

## Validation and reproduction

Before changes: 10 smoke cases + 16 assertions passed using the installed Jiti runtime (the README's `tsx` was not installed). TypeScript passed; lint had one pre-existing unused `_add` warning at `app/page.tsx:260`.

After changes: **49 cases/assertions pass**, including all original tests, synthetic catalogs, and deterministic/finite checks across every tool ID and malformed numeric evidence. TypeScript and lint pass (the same existing warning). Six complete cached evaluations ran, with 123 photo rows and 15 combined-knife rows each and zero errors.

Production build could not finish: Turbopack's CSS worker failed to bind an internal port (`Operation not permitted`), both in the sandbox and on a requested elevated retry. This is a remaining environment-level build verification limitation; no successful production build is claimed. A lockfile-only offline install also encountered an unrelated uncached Tailwind platform package; the existing installed Jiti runtime was used, and its already resolved lockfile entry was kept unchanged.

```bash
npm test
npx --no-install tsc --noEmit
npm run lint
python3 eval/run_eval.py --offline --no-sku --out eval/ranking-audit/after-no-sku.csv
python3 eval/run_eval.py --offline --out eval/ranking-audit/after-with-sku.csv
```

For historical versions, export `lib`, `data`, `config` from `d506c8b` or `7f3702e` into a temporary directory and link that directory's `node_modules` to the installed repository dependencies. Pass it as `--scoring-root /absolute/snapshot` to the same evaluator. Use the **current** truth/cache paths and the same SKU setting for every comparison.

No merge, push, deployment, new API extraction, or live feedback mutation was performed.
