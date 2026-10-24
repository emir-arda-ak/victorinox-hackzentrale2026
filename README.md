# Product Match – Victorinox Challenge (ZentralHack 2026)

Foto eines Taschenmessers → passendes, aktuelles Victorinox-Modell mit Werkzeugvergleich, Konfidenz und Katalogquelle.

## Setup (lokal)

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY eintragen
npm run dev                  # http://localhost:3000
npm test                     # Scoring-Tests ohne API-Key
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

Gespeicherte Erkennungen vollständig offline auswerten (kein API-Key, HTTP, Vision oder Redis):

```bash
python3 eval/run_eval.py --offline --no-sku --out eval/offline-no-sku.csv
python3 eval/run_eval.py --offline --out eval/offline-with-sku.csv
```

`--scoring-root /absoluter/pfad` bewertet mit einem anderen Source-Snapshot (`lib`, `data`, `config` und Zugriff auf `node_modules`).
Verglichen werden Fotos und kombinierte Messer, getrennt nach Ground-Truth-Pfad, sowie die exakte Abdeckung sicher erkannter Arbeitsfunktionen.
`--no-sku` ist hier der primäre Vergleich, weil der Testdatensatz ein falsch beschriftetes Classic SD enthält.
Die Zuverlässigkeit ist eine Heuristik, keine kalibrierte Wahrscheinlichkeit. Details, Gewichte, Vorher/Nachher-Zahlen und Regressionen: [Ranking-Audit](eval/ranking-audit/report.md).

## Separate semantische Katalogsuche

Für alle 149 Modelle liegen echte `text-embedding-3-small`-Vektoren mit 1536 Dimensionen in
`data/catalog-embeddings.json` vor. Die exakte Cosine-Suche ist ein separater Testpfad und verändert die bisherige Rangliste nicht.

```bash
npm run embeddings:check                    # Offline: IDs, Version, Vollständigkeit, Dimensionen
npm run test:embeddings                     # Offline-Tests, keine API-Aufrufe
npm run embeddings:generate -- --dry-run    # Beschreibungen/Datenversion prüfen, keine API-Aufrufe
npm run embeddings:generate                 # Nur fehlende/geänderte Vektoren erzeugen
npm run embeddings:search -- --extraction eval/semantic-search/competitor-example.json --k 5
```

`OPENAI_API_KEY` kommt ausschliesslich aus der Umgebung bzw. den ignorierten `.env`-/`.env.local`-Dateien.
Der zusätzliche HTTP-Endpunkt `POST /api/semantic-search` ist standardmässig deaktiviert; für Tests
`SEMANTIC_SEARCH_ENABLED=1` setzen. CLI-Suchaufrufe sind explizit und benötigen diesen Schalter nicht.

[Format, Aktualisierung, API und Fallback](docs/semantic-search.md) · [Testbericht und Einschränkungen](eval/semantic-search/report.md)

## Weitere Arbeiten

- [ ] Feedback 👍/👎 + gelernte Regeln (Redis via Vercel Marketplace) → `score(…, learned)` ist vorbereitet
- [ ] Korrigierbare Chips (Werkzeuge an/aus → `/api/score`)
- [ ] Agenten-Schritte streamen
- [ ] Text-Embeddings als zusätzlicher Score-Bestandteil
- [ ] LLM-Rerank der Top-10 (nur bei knappen Fällen)
- [ ] UI nach Hainings Design
