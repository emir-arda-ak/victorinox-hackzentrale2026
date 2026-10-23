"""Eval gegen die echte API (misst genau, was die App tut).

Usage:
  pip install pillow
  python eval/run_eval.py --url https://<app>.vercel.app --images eval/testset --truth eval/ground_truth.csv

ground_truth.csv (Semikolon in expected_ids = mehrere akzeptierte Modelle):
  file,expected_ids,brand,notes
  swiza_d03_offen.jpg,1.3603;1.3613,Swiza,auf Messunterlage
"""
import argparse, base64, csv, io, json, statistics, sys, time, urllib.request
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Bitte zuerst: pip install pillow")

ap = argparse.ArgumentParser()
ap.add_argument("--url", required=True)
ap.add_argument("--images", default="eval/testset")
ap.add_argument("--truth", default="eval/ground_truth.csv")
ap.add_argument("--out", default="eval/results.csv")
a = ap.parse_args()

def data_url(path: Path) -> str:
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((1280, 1280))
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

rows = list(csv.DictReader(open(a.truth, encoding="utf-8")))
out, lat = [], []
for i, r in enumerate(rows, 1):
    exp = [x.strip() for x in r["expected_ids"].split(";") if x.strip()]
    t0 = time.time()
    try:
        req = urllib.request.Request(a.url.rstrip("/") + "/api/match", data=json.dumps({"image": data_url(Path(a.images) / r["file"])}).encode(),
                                     headers={"Content-Type": "application/json"})
        res = json.load(urllib.request.urlopen(req, timeout=180))
    except Exception as e:
        print(f"[{i}/{len(rows)}] {r['file']}: FEHLER {e}"); out.append({**r, "error": str(e)}); continue
    dt = time.time() - t0; lat.append(dt)
    cands = [c["id"] for c in (res.get("ranking") or {}).get("candidates", [])]
    rk = res.get("ranking") or {}
    hit1 = bool(cands[:1]) and cands[0] in exp
    hit3 = any(c in exp for c in cands[:3])
    ex = res.get("extraction", {})
    out.append({**r, "top1": cands[0] if cands else "", "top3": ";".join(cands[:3]), "hit1": int(hit1), "hit3": int(hit3),
                "confidence": rk.get("confidence"), "level": rk.get("level"), "question": (res.get("question") or {}).get("type", ""),
                "brand_seen": ex.get("brand"), "zone": ex.get("length_zone"), "tools_seen": ",".join(ex.get("tools_seen", [])),
                "latency_s": round(dt, 1), "error": ""})
    print(f"[{i}/{len(rows)}] {r['file']}: {'✓' if hit1 else ('~' if hit3 else '✗')} top3={cands[:3]} erwartet={exp} conf={rk.get('confidence')} {dt:.1f}s")

ok = [o for o in out if not o.get("error")]
if ok:
    n = len(ok)
    print(f"\nTop-1: {sum(o['hit1'] for o in ok)}/{n} = {100*sum(o['hit1'] for o in ok)/n:.0f} %")
    print(f"Top-3: {sum(o['hit3'] for o in ok)}/{n} = {100*sum(o['hit3'] for o in ok)/n:.0f} %")
    print(f"Latenz: median {statistics.median(lat):.1f}s, max {max(lat):.1f}s")
    for lvl in ("high", "medium", "low"):
        g = [o for o in ok if o["level"] == lvl]
        if g: print(f"Stufe {lvl}: {len(g)} Bilder, Top-1 korrekt in {100*sum(o['hit1'] for o in g)/len(g):.0f} %  (für die Konfidenz-Kalibrierung)")
keys = sorted({k for o in out for k in o})
with open(a.out, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(out)
print(f"\nDetails: {a.out}")
