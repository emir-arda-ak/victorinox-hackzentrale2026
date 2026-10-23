# Product Match – Victorinox Challenge (ZentralHack 2026)

Foto eines Taschenmessers → passendes, aktuelles Victorinox-Modell mit Werkzeugvergleich, Konfidenz und Katalogquelle.

## Setup (lokal)

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY eintragen
npm run dev                  # http://localhost:3000
npx tsx scripts/test-score.ts   # Scoring-Tests ohne API-Key
```

Die Kamera am Handy braucht HTTPS → vom Handy immer gegen die Vercel-URL testen.

## Deploy (Vercel)

1. Repo auf GitHub pushen (öffentlich), auf vercel.com „Add New → Project“, Repo wählen.
2. Environment Variables: `OPENAI_API_KEY`, `OPENAI_VISION_MODEL` (siehe `.env.example`).
3. Deploy. Jeder Push auf `main` deployt automatisch.

## Architektur

```
Foto ─► /api/match ─► extract.ts (1 Vision-Call, zod Structured Output)
                     └► pipeline.decide(): Router ─► score.ts (deterministisch) ─► clarify.ts (berechnete Rückfrage)
                                                                                 └► explain.ts (Begründung aus Daten)
Antwort/Korrektur ─► /api/score ─► gleiche decide()-Logik, ohne LLM (Millisekunden)
```

| Pfad | Inhalt |
| --- | --- |
| `data/catalog.json` | 149 Modelle aus dem Katalog 2026 (Parser: separates Paket) |
| `data/tools.json` | kanonisches Werkzeugvokabular + Sichtbarkeit |
| `data/zones.json` | Grössenzonen der Messunterlage |
| `data/crossref.json` | Konkurrenzprodukte + Cross-Reference-Regeln (Andrin füllt) |
| `config/scoring.json` | **alle Gewichte und Schwellen** (Alexandra tunt hier) |
| `lib/agent/*` | schema, prompt, extract, score, clarify, explain, pipeline |
| `app/page.tsx` | Prototyp-UI (M1), wird durch Hainings Design ersetzt |
| `public/catalog/*.webp` | Produktbilder, `public/messunterlage.pdf` |
| `eval/run_eval.py` | Top-1/Top-3 gegen die deployte API |

Provider-Wechsel: `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY` setzen → gleiche App läuft auf Azure OpenAI.

## Eval (Alexandra)

```bash
pip install pillow
# Bilder nach eval/testset/, Zeilen in eval/ground_truth.csv
python eval/run_eval.py --url https://<app>.vercel.app
```
Gibt Top-1, Top-3, Latenz und Trefferquote pro Konfidenzstufe aus (für die Kalibrierung in `config/scoring.json`).

## Offen für M2

- [ ] Feedback 👍/👎 + gelernte Regeln (Redis via Vercel Marketplace) → `score(…, learned)` ist vorbereitet
- [ ] Korrigierbare Chips (Werkzeuge an/aus → `/api/score`)
- [ ] Agenten-Schritte streamen
- [ ] Text-Embeddings als zusätzlicher Score-Bestandteil
- [ ] LLM-Rerank der Top-10 (nur bei knappen Fällen)
- [ ] UI nach Hainings Design
