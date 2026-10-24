# Text-Embeddings und exakte Vektorsuche

Die Suche ist ein **separater experimenteller Pfad**. `score.ts`, `decide()`, der Agenten-Orchestrator und die bestehenden Matching-Endpunkte werden weder aufgerufen noch umsortiert. Ein Ausfall der Embedding-Suche beeinflusst das normale Matching daher nicht.

## Modell und Daten

- Modell: `text-embedding-3-small`, explizit 1536 Dimensionen, `encoding_format: float`.
- 149 Modelle aus `data/catalog.json`, einschliesslich Zubehör der Kategorie `OTHER`; keine versteckten Kategorie- oder SKU-Filter.
- Einstellungen: `config/embeddings.json`. Standard `k=10`, erlaubter Bereich am HTTP-Endpunkt 1–149. `k` ist pro Anfrage/CLI-Aufruf und über `default_k` konfigurierbar.
- Serverdatei: `data/catalog-embeddings.json`, nicht unter `public/`. `next.config.ts` nimmt sie ausdrücklich in das File Tracing der neuen Route auf.
- Kein externer Vektordatenbankdienst und keine Approximation: alle Produkte werden mit Cosine Similarity verglichen.

Die [OpenAI-Dokumentation](https://developers.openai.com/api/docs/guides/embeddings) beschreibt Text-Embeddings und die Standarddimension 1536; die verwendeten Request-Felder stehen in der [API-Referenz](https://developers.openai.com/api/reference/typescript/resources/embeddings/methods/create).

## Gemeinsames Beschreibungsformat

Katalog und Vision-Extraktion verwenden denselben Renderer, dieselbe deutsche Werkzeug-Taxonomie und feste, nach Werkzeug-ID sortierte Felder:

```text
Modell: CLASSIC SD
Kategorie: Taschenmesser
Grifflänge: 58 mm
Arbeitsfunktionen: Kleine Klinge, Nagelfeile, Schere, Schraubendreher, Zahnstocher, Pinzette
Handhabung: Ring
```

Die konkrete Reihenfolge wird durch die kanonischen Werkzeug-IDs bestimmt; das Beispiel erläutert das Feldformat. Haupt- und Unterwerkzeuge des Katalogs werden dedupliziert zusammengeführt. Clip, Daumenpin, Ring und Befestigungsöse sind Handhabungsmerkmale. `other` wird ignoriert.

Zusätzliche Felder werden nur bei vorhandener Evidenz angefügt: `Unsichere Arbeitsfunktionen`, `Unsichere Handhabung`, `Ausdrücklich verneinte Merkmale`. Wiederholte Texte für leere optionale Felder werden vermieden. Unbekannte Modellnamen und Längen bleiben als unbekannt gekennzeichnet. Nicht sichtbare Werkzeuge werden nicht als abwesend beschrieben.

Bei Query-Beschreibungen werden `tools_seen` und `answers.tools_yes` zusammengeführt. Ein explizites `tools_no` überstimmt widersprüchliche Ja-/Vision-Evidenz. `tools_maybe` bleibt getrennt. Kategorie- und Längenantworten haben Vorrang. Ohne Längenantwort wird eine positive endliche mm-Schätzung verwendet, ansonsten die Grössenzone. Die Extraktion selbst wird nicht verändert. Freier Vision-Beschreibungstext, Bilder, Farben, Markenlogos und SKU-Nummern werden nicht an den Embedding-Endpunkt gesendet; ein vorhandener Modellname wird verwendet.

`NOT_A_KNIFE` und ein generisches `OTHER_KNIFE` ohne konkrete Merkmale ergeben `status: empty`, ohne API-Aufruf. Ein Kategoriehinweis wie `SAK` ist bereits eine zulässige, allerdings schwache Suchanfrage. Ein leeres oder ungültiges HTTP-Objekt erhält HTTP 400.

## Versioniertes Artefakt

Die JSON-Datei enthält:

| Feld | Bedeutung |
|---|---|
| `schema_version` | Dateiformat, derzeit 1 |
| `description_version` | Renderer-/Interpretationsversion, derzeit `product-description-de-v2` |
| `embedding_model`, `dimensions` | Verhindern die Mischung inkompatibler Vektorräume |
| `data_version` | SHA-256 aus sortierten Produktbeschreibungen inklusive IDs/Hashes, Beschreibungsformat, Modell und Dimensionen |
| `generated_at` | UTC-Zeitpunkt des Generierungslaufs; bleibt bei unverändertem Wiederholungslauf gleich |
| `entries[].id` | Eindeutige reale Katalogmodell-ID |
| `entries[].description`, `description_sha256` | Tatsächlich eingebetteter Text und sein SHA-256 |
| `entries[].embedding` | Vollständiger Vektor als Zahlenarray |

Relevante Änderungen am Katalog, an Werkzeugbezeichnungen oder am Format machen den alten Index ungültig. Änderungen an Bildern oder anderen nicht verwendeten Metadaten erfordern keine neuen Embeddings. Änderungen an der Interpretation der Query-Felder erfordern eine Erhöhung von `DESCRIPTION_VERSION`, selbst wenn Katalogtexte unverändert blieben.

## Erzeugen und aktualisieren

Voraussetzung: `npm install`; `OPENAI_API_KEY` im Prozess oder einer lokal ignorierten `.env.local`/`.env` setzen. Der CLI-Runner verwendet Next.js-Umgebungsprioritäten. Keine Schlüssel in Skripte, Beispielanfragen, Vektorartefakte oder Git aufnehmen.

```bash
# Ohne API-Kosten: Anzahl, Datenversion, Textgrösse und ein Beispiel anzeigen
npm run embeddings:generate -- --dry-run

# Erster Lauf: alle Produkte; Folgeläufe: fehlende/veränderte Produkte
npm run embeddings:generate

# Vollständige Neuberechnung ausdrücklich erzwingen
npm run embeddings:generate -- --force

# Vollständigkeit und Kompatibilität ohne API prüfen
npm run embeddings:check
```

Die Generierung nutzt Batches von höchstens 32 Beschreibungen. Unveränderte Einträge mit passendem Modell, Format, Hash und gültiger Dimension werden wiederverwendet. Der aktuelle vollständige Index wird zunächst im Speicher erzeugt und validiert. Erst dann wird eine temporäre Datei atomar auf den Zielpfad umbenannt. Ein gescheiterter Batch überschreibt keinen vorhandenen Index; bei einem ersten fehlgeschlagenen Lauf entsteht kein scheinbar vollständiger Index.

Die Anwendung cached einen erfolgreich geladenen Index pro Prozess. **Nach einer Aktualisierung den laufenden Server neu starten bzw. später bewusst neu deployen.** Fehlgeschlagene Ladevorgänge werden nicht gecached und bei der nächsten expliziten Suchanfrage erneut versucht. Die Erstellung erfolgt nicht automatisch beim Build oder zur Anfragezeit.

Unveränderte Wiederholungsläufe sind byte-identisch und benötigen keine API-Aufrufe. Ein erzwungener API-Neulauf ist nicht als bitidentisch garantiert: das Modell wird unter einem Provider-Modellnamen angesprochen, und numerische Antworten können geringfügig variieren. Für reproduzierbare Experimente den gespeicherten Index sowie den Query-Vektor fixieren; die Suche selbst ist dann deterministisch.

## Separat testen

```bash
npm test
npm run test:embeddings
npm run embeddings:search -- --extraction eval/semantic-search/competitor-example.json --k 5
```

Die Such-CLI akzeptiert eine gespeicherte Extraktion direkt oder `{ "extraction": ..., "answers": ... }`. Sie erzeugt genau ein Query-Embedding und gibt JSON mit `product_id` und `similarity` zurück. Modell, Dimensionen, Datenversion und Query-Beschreibung werden zur Nachvollziehbarkeit mitgeliefert. Bei `unavailable` beendet sich die CLI mit Exitcode 1.

Für HTTP-Tests `SEMANTIC_SEARCH_ENABLED=1` setzen, Server starten und eine strukturierte Anfrage senden:

```bash
curl http://localhost:3000/api/semantic-search \
  -H 'Content-Type: application/json' \
  --data-binary @eval/semantic-search/competitor-example.json
```

Das JSON kann zusätzlich `"k": 5` enthalten. Der Opt-in-Schalter gilt nur für den HTTP-Endpunkt. Ohne Schalter wird `disabled` zurückgegeben, ohne Embedding-Kosten. Die bestehende UI ruft diesen Endpunkt nicht auf.

## Suche, Fallback und Grenzen

Cosine Similarity ist `dot(query, product) / (norm(query) × norm(product))`. Vektoren werden vor der Suche normalisiert. Alle 149 Einträge werden exakt ausgewertet, absteigend sortiert, bei exakt gleichem Wert nach Produkt-ID in ordinaler Reihenfolge. Die Werte liegen in [-1, 1] und sind **keine Wahrscheinlichkeiten**. Doppelte/ungültige IDs, Nullvektoren, falsche Dimensionen, NaN/Infinity oder ein unvollständiger/veralteter Index werden abgelehnt. Ergebnisse werden vor dem Sortieren nicht gerundet.

Bei fehlender Datei, veraltetem Index, fehlendem Schlüssel, API-Fehler oder Timeout liefert der optionale Pfad beispielsweise:

```json
{"status":"unavailable","results":[],"reason":"index_missing_or_invalid","fallback":"existing_matching"}
```

Der HTTP-Endpunkt liefert dafür HTTP 200 mit explizitem Status; fehlerhafte Eingaben erhalten HTTP 400. `fallback` ist ein Hinweis an einen möglichen zukünftigen Aufrufer, **kein heimlicher Aufruf des bestehenden Scorers**. Fehlerdetails des SDK, API-Schlüssel und Request-Header werden nicht ausgegeben. Queries haben 8 Sekunden API-Timeout, Generierungsbatches 30 Sekunden, jeweils ohne automatische SDK-Retries. Ein späterer expliziter Aufruf kann erneut versuchen.

Die Embedding-Anbindung verwendet ausschliesslich OpenAI mit `OPENAI_API_KEY`; die vorhandene Azure-Umschaltung für Vision bleibt unverändert. Für Azure-Embeddings wäre eine eigene dokumentierte Deployment-Konfiguration nötig.

Semantische Nähe erzwingt weder bestätigte Funktionen noch harte Negativbedingungen oder Kategoriegrenzen. Vollständige Katalogbeschreibungen und unvollständige Foto-Extraktionen sind unterschiedlich informativ. Die Tests zeigen insbesondere beim Konkurrenzbeispiel fachlich unpassende Top-k-Kandidaten. **Nicht als Ersatz für das funktionale Ranking freigeben**, bevor eine separate Qualitätsevaluation und eine kontrollierte Kombination geprüft wurden. Der Testendpunkt hat keinen zusätzlichen Auth-/Rate-Limit-Layer und ist deshalb standardmässig aus; eine öffentliche Freischaltung ist eine gesonderte Produktentscheidung.
