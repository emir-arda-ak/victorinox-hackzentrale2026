"""Eval gegen die echte API (misst genau, was die App tut).

Setup (einmal):
  pip install pillow pillow-heif

1) Voller Lauf (Vision + Scoring), speichert die Erkennung pro Bild in eval/cache/:
  python3 eval/run_eval.py --url https://<app>.vercel.app

2) Gewichte tunen OHNE neue Vision-Calls (schnell, gratis):
  npm run dev        # lokal, config/scoring.json wird live neu geladen
  python3 eval/run_eval.py --url http://localhost:3000 --rescore

3) Vollständig offline (kein Server, HTTP, Redis oder Vision):
  python3 eval/run_eval.py --offline --no-sku --out eval/offline-no-sku.csv

ground_truth.csv – eine Zeile pro Messer-Ordner unter eval/testset/ (alle Bilder darin zählen),
oder eine Zeile pro Bild (Spalte file statt folder). Semikolon = mehrere akzeptierte Modelle:
  folder,expected_ids,brand,path,notes
  Swiza Schweizer Messer D03,1.3603;1.3613,Swiza,competitor,...

Ausgewertet wird pro Foto UND pro Messer (alle Fotos eines Messers zu einer Erkennung kombiniert).
"""
import argparse, atexit, base64, csv, io, json, statistics, subprocess, sys, time, urllib.request, urllib.error
from collections import Counter
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = ImageOps = None
try:
    import pillow_heif  # iPhone-Fotos (.HEIC)
    pillow_heif.register_heif_opener()
except ImportError:
    pass  # Not needed for cached evaluation.

IMG_EXT = {".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp"}

ap = argparse.ArgumentParser()
ap.add_argument("--url", help="Basis-URL der App, z. B. https://product-match.vercel.app")
ap.add_argument("--offline", action="store_true", help="cached scoring in a local Node process; no HTTP, vision or Redis")
ap.add_argument("--scoring-root", default=str(Path(__file__).resolve().parents[1]), help="source snapshot to score with in --offline mode")
ap.add_argument("--images", default="eval/testset")
ap.add_argument("--truth", default="eval/ground_truth.csv")
ap.add_argument("--out", default="eval/results.csv")
ap.add_argument("--cache", default="eval/cache")
ap.add_argument("--rescore", action="store_true", help="gespeicherte Erkennungen neu bewerten (/api/score, kein LLM)")
ap.add_argument("--only", default="", help="nur Ordner/Dateien, deren Name diesen Text enthält")
ap.add_argument("--no-sku", action="store_true", help="erkannte Artikelnummern (z. B. Etiketten auf Testmessern) für die Bewertung ignorieren")
a = ap.parse_args()
if a.offline:
    a.rescore = True
    bridge = subprocess.Popen(["node", str(Path(__file__).resolve().parents[1] / "scripts/score-cached.cjs"), a.scoring_root],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    atexit.register(bridge.terminate)
elif not a.url:
    ap.error("--url or --offline is required")
root = Path(a.images)
cache = Path(a.cache); cache.mkdir(parents=True, exist_ok=True)

def data_url(path: Path) -> str:
    if Image is None:
        raise RuntimeError("Live vision requires pillow and pillow-heif; cached evaluation does not")
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((1280, 1280))
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

def post(path: str, payload: dict) -> dict:
    if a.offline:
        if path != "/api/score":
            raise RuntimeError("Offline evaluation only supports scoring cached extractions")
        bridge.stdin.write(json.dumps(payload) + "\n"); bridge.stdin.flush()
        line = bridge.stdout.readline()
        if not line:
            raise RuntimeError("Offline scorer exited unexpectedly")
        result = json.loads(line)
        if result.get("error"):
            raise RuntimeError(result["error"])
        return result
    req = urllib.request.Request(a.url.rstrip("/") + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:300]}")

def cache_file(rel: str) -> Path:
    return cache / (rel.replace("/", "__") + ".json")

def merge(exs: list[dict]) -> dict:
    """Kombiniert die Erkennungen mehrerer Fotos desselben Messers (Union der Werkzeuge, beste Längenmessung)."""
    def mode(key):
        vals = [e.get(key) for e in exs if e.get(key) not in (None, "")]
        return Counter(vals).most_common(1)[0][0] if vals else None
    cats = Counter()
    for e in exs:
        if e["category"] != "NOT_A_KNIFE":
            cats[e["category"]] += e.get("category_confidence", 0.5)
    seen = sorted({t for e in exs for t in e.get("tools_seen", [])})
    maybe = sorted({t for e in exs for t in e.get("tools_maybe", [])} - set(seen))
    best_len = max(exs, key=lambda e: e.get("length_zone_confidence") or 0)
    est = [e["length_estimate_mm"] for e in exs if e.get("length_estimate_mm")]
    states = {e.get("open_state") for e in exs}
    vic = [e.get("is_victorinox") for e in exs if e.get("is_victorinox") is not None]
    return {
        "category": cats.most_common(1)[0][0] if cats else exs[0]["category"],
        "category_confidence": round(statistics.mean(e.get("category_confidence", 0.5) for e in exs), 2),
        "brand": mode("brand"), "brand_evidence": mode("brand_evidence"),
        "is_victorinox": (sum(vic) > len(vic) / 2) if vic else None,
        "model_guess": mode("model_guess"), "visible_sku": mode("visible_sku"),
        "open_state": "open" if any(e.get("open_state") == "open" and len(e.get("tools_seen", [])) >= 3 for e in exs) else ("partly" if states & {"open", "partly"} else "closed"),
        "tools_seen": seen, "tools_maybe": maybe,
        "sheet_visible": any(e.get("sheet_visible") for e in exs),
        "length_zone": best_len.get("length_zone"), "length_zone_alt": best_len.get("length_zone_alt"),
        "length_zone_confidence": best_len.get("length_zone_confidence") or 0,
        "length_estimate_mm": statistics.median(est) if est else None,
        "scale_color": mode("scale_color"), "scale_material": mode("scale_material"),
        "description": " / ".join(e["description"] for e in exs[:2] if e.get("description")),
        "image_issues": [],
    }

# ---------- Testfälle aus ground_truth.csv ----------
items = []  # (rel_path, knife, truth_row)
for r in csv.DictReader(open(a.truth, encoding="utf-8")):
    if r.get("folder"):
        d = root / r["folder"]
        if not d.is_dir():
            print(f"WARNUNG: Ordner fehlt: {d}"); continue
        for p in sorted(d.iterdir()):
            if p.suffix.lower() in IMG_EXT:
                items.append((f"{r['folder']}/{p.name}", r["folder"], r))
    elif r.get("file") and not r["file"].startswith("BEISPIEL"):
        items.append((r["file"], r.get("knife") or r["file"], r))
if a.only:
    items = [i for i in items if a.only.lower() in i[0].lower()]
if not items:
    sys.exit(f"Keine Bilder gefunden ({a.truth}, {root}).")
print(f"{len(items)} Bilder von {len({k for _, k, _ in items})} Messern" + (" · Artikelnummern ignoriert (--no-sku)" if a.no_sku else "") + "\n")

out, lat, by_knife = [], [], {}
for i, (rel, knife, r) in enumerate(items, 1):
    exp = [x.strip() for x in r["expected_ids"].split(";") if x.strip()]
    cf = cache_file(rel)
    t0 = time.time()
    try:
        if a.rescore:
            if not cf.exists():
                raise RuntimeError("keine gespeicherte Erkennung – zuerst ohne --rescore laufen lassen")
            ex0 = json.loads(cf.read_text())
            if a.no_sku: ex0["visible_sku"] = None
            res = post("/api/score", {"extraction": ex0})
        else:
            res = post("/api/match", {"image": data_url(root / rel)})
            if i == 1 or not globals().get("_ver_shown"):
                print(f"   API: Modell={res.get('model')} Prompt={res.get('prompt_version', 'ALT (ohne Version)')} Reasoning={res.get('reasoning_effort')}")
                globals()["_ver_shown"] = True
            if res.get("extraction"):
                cf.write_text(json.dumps(res["extraction"], ensure_ascii=False, indent=1))
    except Exception as e:
        print(f"[{i}/{len(items)}] {rel}: FEHLER {e}"); out.append({"level_of": "foto", "file": rel, "knife": knife, "error": str(e)}); continue
    dt = time.time() - t0; lat.append(dt)
    rk = res.get("ranking") or {}
    cands = [c["id"] for c in rk.get("candidates", [])]
    hit1, hit3 = bool(cands) and cands[0] in exp, any(c in exp for c in cands[:3])
    ex = res.get("extraction", {})
    by_knife.setdefault(knife, {"exp": exp, "row": r, "exs": []})["exs"].append(ex)
    out.append({"level_of": "foto", "file": rel, "knife": knife, "expected_ids": r["expected_ids"], "path": r.get("path", ""),
                "top1": cands[0] if cands else "", "top3": ";".join(cands[:3]), "hit1": int(hit1), "hit3": int(hit3),
                "confidence": rk.get("confidence"), "level": rk.get("level"), "question": (res.get("question") or {}).get("type", ""),
                "category_seen": ex.get("category"), "brand_seen": ex.get("brand"), "zone": ex.get("length_zone"),
                "open_state": ex.get("open_state"), "tools_seen": ",".join(ex.get("tools_seen", [])), "latency_s": round(dt, 1),
                "confirmed_coverage": res.get("evaluation", {}).get("confirmed_coverage"),
                "missing_confirmed": ";".join(res.get("evaluation", {}).get("missing_confirmed", [])), "error": ""})
    print(f"[{i}/{len(items)}] {'✓' if hit1 else ('~' if hit3 else '✗')} {rel}: top3={cands[:3]} zone={ex.get('length_zone')} {dt:.1f}s")

def summary(rows, title):
    ok = [o for o in rows if not o.get("error")]
    if not ok: return
    n = len(ok)
    print(f"\n== {title}: Top-1 {sum(o['hit1'] for o in ok)}/{n} = {100*sum(o['hit1'] for o in ok)/n:.0f} %   "
          f"Top-3 {sum(o['hit3'] for o in ok)}/{n} = {100*sum(o['hit3'] for o in ok)/n:.0f} %")
    for lvl in ("high", "medium", "low"):
        g = [o for o in ok if o["level"] == lvl]
        if g: print(f"   Stufe {lvl:6}: {len(g):3}, davon Top-1 korrekt {100*sum(o['hit1'] for o in g)/len(g):.0f} %")
    for path in sorted({o.get("path", "") for o in ok}):
        g = [o for o in ok if o.get("path", "") == path]
        print(f"   {path}: Top-1 {sum(o['hit1'] for o in g)}/{len(g)}, Top-3 {sum(o['hit3'] for o in g)}/{len(g)}")
    cov = [o["confirmed_coverage"] for o in ok if o.get("confirmed_coverage") is not None]
    if cov: print(f"   Exact confirmed functional coverage: {statistics.mean(cov):.3f} ({len(cov)} rows with evidence)")

summary(out, "Pro Foto")
if not a.rescore and lat:
    print(f"   Latenz: median {statistics.median(lat):.1f}s, max {max(lat):.1f}s")

# ---------- pro Messer: alle Fotos kombiniert ----------
knife_rows = []
print("\nPro Messer (alle Fotos kombiniert):")
for knife, k in by_knife.items():
    try:
        mx = merge(k["exs"])
        if a.no_sku: mx["visible_sku"] = None
        res = post("/api/score", {"extraction": mx})
    except Exception as e:
        print(f"  {knife}: FEHLER {e}")
        knife_rows.append({"level_of": "messer", "knife": knife, "error": str(e)})
        continue
    rk = res.get("ranking") or {}
    cands = [c["id"] for c in rk.get("candidates", [])]
    hit1, hit3 = bool(cands) and cands[0] in k["exp"], any(c in k["exp"] for c in cands[:3])
    ex = res.get("extraction", {})
    knife_rows.append({"level_of": "messer", "file": f"{len(k['exs'])} Fotos", "knife": knife, "expected_ids": k["row"]["expected_ids"],
                       "path": k["row"].get("path", ""), "top1": cands[0] if cands else "", "top3": ";".join(cands[:3]),
                       "hit1": int(hit1), "hit3": int(hit3), "confidence": rk.get("confidence"), "level": rk.get("level"),
                       "category_seen": ex.get("category"), "brand_seen": ex.get("brand"), "zone": ex.get("length_zone"),
                       "tools_seen": ",".join(ex.get("tools_seen", [])),
                       "confirmed_coverage": res.get("evaluation", {}).get("confirmed_coverage"),
                       "missing_confirmed": ";".join(res.get("evaluation", {}).get("missing_confirmed", [])), "error": ""})
    print(f"  {'✓' if hit1 else ('~' if hit3 else '✗')} {knife[:45]:45} top3={cands[:3]} erwartet={k['exp']} conf={rk.get('confidence')}")
summary(knife_rows, "Pro Messer")
miss = [o for o in knife_rows if not o.get("error") and not o["hit3"]]
if miss:
    print("\nMesser nicht in den Top-3 – zuerst in results.csv prüfen, ob category_seen / zone / tools_seen stimmen:")
    for o in miss: print(f"  {o['knife']}: erwartet {o['expected_ids']}, bekam {o['top3']}  (Werkzeuge: {o['tools_seen']})")

rows = out + knife_rows
keys = list(dict.fromkeys(k for o in rows for k in o))
with open(a.out, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(rows)
print(f"\nDetails: {a.out}")
if any(o.get("error") for o in rows):
    sys.exit("Evaluation incomplete: see error rows")
