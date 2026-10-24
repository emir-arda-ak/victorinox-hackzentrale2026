# Bericht: Text-Embeddings und Vektorsuche

## Ergebnis und Umfang

Implementiert auf dem Feature-Branch `codex/catalog-text-embeddings`, ausgehend von `50b43ee5e986cc8060e1581fc392a309470b89d5`. Kein Merge nach `main`, kein Push und kein Deployment.

Für **149 von 149 Katalogmodellen** wurden echte OpenAI-Embeddings mit **text-embedding-3-small**, **1536 Dimensionen** erzeugt. Die exakte Cosine-Suche ist über eine CLI und einen separaten, standardmässig deaktivierten HTTP-Endpunkt testbar. Das bisherige Ranking, seine Gewichte, Agenten-Architektur und bisherigen Endpunkte sind unverändert.

Das Ergebnis ist eine funktionierende technische Suchkomponente, **kein Nachweis verbesserter Produktempfehlungen**. Die Konkurrenzprobe zeigt klare fachliche Grenzen der reinen Textähnlichkeit.

## Gespeicherter Stand

| Eigenschaft | Wert |
|---|---|
| Datei | `data/catalog-embeddings.json` |
| Modell | `text-embedding-3-small` |
| Einträge / Dimensionen | 149 / 1536 |
| Beschreibungsformat | `product-description-de-v2` |
| Datenversion | `9ad03498962a1144524c97410f2fbb6cead2ec906d00a7425bbe4c440bb27e05` |
| Erzeugt (UTC) | `2026-10-24T13:51:42.977Z` |
| Dateigrösse | 4,444,101 Bytes |
| Datei-SHA-256 | `7c13eface339c2b9efc6d5b8347df6e4f86990ca99221219606bd9f31d3770fa` |

Jeder Eintrag speichert Katalog-ID, tatsächlich eingebettete Beschreibung, Beschreibungshash und Vektor. Die Datenversion umfasst sortierte Dokumente, Formatversion, Modell und Dimensionen. Rohdaten- und Artefakthashes stehen zusätzlich in `manifest.json`.

Der finale Generierungslauf benötigte **14.262 Input-Tokens in fünf Batches**. Eine erste Variante mit wiederholten Leerfeldtexten hatte zuvor 20.367 Tokens benötigt. Diese optionalen Leerfelder wurden nach den ersten Suchproben entfernt, ohne produkt- oder SKU-spezifische Anpassungen. Die drei Live-Queries wurden für beide Formate ausgeführt; die gespeicherten Resultate gehören ausschliesslich zum finalen Format. Weitere Formatoptimierung oder Gewichtstraining fand nicht statt.

Ein erneuter Lauf mit unveränderten Quellen meldete **149 wiederverwendet, 0 neu erzeugt, 0 Tokens**. Der SHA-256 blieb identisch. Bei einem erzwungenen API-Neulauf sind geringfügige numerische Unterschiede möglich; die gespeicherten Vektoren sind deshalb der reproduzierbare Referenzstand.

## Architektur und Änderungen

```text
Katalog + Werkzeugvokabular
  → gemeinsamer Beschreibungsrenderer
  → versionierte Beschreibungen
  → OpenAI-Batches / Wiederverwendung
  → validiertes JSON-Artefakt (atomarer Austausch)

Vision-Extraktion + optionale Antworten
  → gleicher Renderer
  → ein Query-Embedding
  → exakter Cosine-Vollscan über alle 149 Vektoren
  → Top-k {product_id, similarity}
```

| Datei | Änderung |
|---|---|
| `config/embeddings.json` | Modell, Dimensionen, k-Grenzen, Batchgrösse, Timeouts und Eingabegrenze |
| `lib/semantic/descriptions.ts` | Gemeinsame deutsche Katalog-/Query-Beschreibungen, SHA-256, Daten- und Formatversion |
| `lib/semantic/index.ts` | Normalisierung, Vektorvalidierung, exakte Cosine-Suche und deterministische ID-Tie-Breaks |
| `lib/semantic/artifact.ts` | Vollständigkeits-, ID-, Versions- und Dimensionsprüfung des gespeicherten Index |
| `lib/semantic/provider.ts` | OpenAI-Anbindung, geordnete Zuordnung anhand API-Response-Index, begrenzte Timeouts, sichere Fehlercodes |
| `lib/semantic/generate.ts` | Inkrementelle Generierung/Wiederverwendung ohne partiell veröffentlichten Index |
| `lib/semantic/search.ts` | Separater Suchdienst, erfolgreicher Index-Cache und fehlertolerante Statusantworten |
| `app/api/semantic-search/route.ts` | Opt-in-HTTP-Endpunkt mit Eingabeprüfung; kein Aufruf durch die bestehende UI |
| `scripts/semantic.cjs`, `scripts/semantic-cli.ts` | Umgebungsvariablen sicher laden; generate/check/search-Befehle |
| `scripts/test-embeddings.cjs`, `scripts/test-embeddings.ts` | Offline-Vertragstests und Prüfung des echten Vektorartefakts |
| `data/catalog-embeddings.json` | 149 echte, vollständig gespeicherte Produktvektoren |
| `next.config.ts` | Vektorartefakt im File Tracing der neuen API-Route einschliessen |
| `.env.example` | Dokumentation von `SEMANTIC_SEARCH_ENABLED`, keine Zugangsdaten |
| `package.json` | CLI-/Testbefehle; `npm test` führt alte und neue Tests aus; keine neue Bibliothek nötig |
| `README.md`, `docs/semantic-search.md` | Bedienung, Aktualisierung, Versionierung, Fehlerverhalten und Grenzen |
| `eval/semantic-search/competitor-example.json`, `competitor-results.json` | Eingabe und Live-Top-5 für das Konkurrenzbeispiel |
| `eval/semantic-search/identified-pocketknife.json`, `identified-pocketknife-results.json` | Positive Kontrolle mit benanntem Classic SD |
| `eval/semantic-search/plier-multitool.json`, `plier-multitool-results.json` | Positive Kontrolle mit Swiss-Tool-Werkzeugprofil ohne Modellnamen |
| `eval/semantic-search/manifest.json`, `report.md` | Reproduktionsmetadaten und dieser Bericht |

Arbeitsfunktionen und Handhabung sind getrennt. Nicht sichtbare Werkzeuge werden nicht als abwesend behandelt; unsichere Funktionen und ausdrückliche Nein-Antworten bleiben eigene Textfelder. Ein Nein überstimmt widersprüchliche Vision-/Ja-Evidenz. Die Kategorie der Extraktion wird nicht heimlich korrigiert. Bilder und freier Vision-Text werden nicht an die Embedding-API geschickt.

## Tests und Validierung

- **49 bestehende Scoring-Fälle/Assertions bestanden** vor und nach der Änderung.
- **23 neue Embedding-Tests bestanden**, ohne API-Aufrufe. Dazu zählen:
  - Vollständigkeit und korrekte IDs für alle 149 Produkte;
  - konsistente Beschreibung und Datenversion bei anderer Katalog-/Werkzeugreihenfolge;
  - unbekannte Längen, leere Eingaben, `NOT_A_KNIFE`, unsichere Funktionen und Nein-Antworten;
  - analytisch bekannte Cosine-Werte +1, 0 und −1;
  - deterministische Reihenfolge bei Gleichstand, unabhängig von Einfügereihenfolge;
  - falsche Dimensionen, Nullvektoren, NaN/Infinity, unbekannte und doppelte IDs;
  - Batchzuordnung über Response-Indizes, ungültige Modell-/Response-Angaben;
  - byte-identische Wiederverwendung, gezielte Neugenerierung und sichere Unterbrechung;
  - fehlende/veraltete/unvollständige Indizes, fehlende Zugangsdaten, API-/Timeoutfehler;
  - unveränderte normale Rangliste vor/nach erfolgreicher und fehlgeschlagener optionaler Suche;
  - alle 149 echten Vektoren im Self-Query: eigener Treffer mit Cosine ≈ 1, gültige IDs und Dimensionen.
- `npm run embeddings:check`: gültiger vollständiger Index.
- `tsc --noEmit`: bestanden.
- `npm run lint`: bestanden, keine Warnungen.
- **`npm run build`: bestanden.** Die Route `/api/semantic-search` ist dynamisch; der Deployment-Trace enthält `data/catalog-embeddings.json`.
- `git diff --check`: bestanden.
- Kontrolle der erzeugten Ausgaben auf den tatsächlich konfigurierten API-Schlüssel: kein Treffer; `.env` bleibt ignoriert.

Beim ersten Build wurde der explizite Route-Export `runtime = 'nodejs'` als inkompatibel mit `cacheComponents` erkannt. Gemäss den lokalen Next.js-16.4.3-Dokumenten wurde der Export entfernt; die Route nutzt den standardmässigen Node-Runtime. Der anschliessende vollständige Build war erfolgreich.

## Echte Suchproben

Die Resultate stammen aus tatsächlichen Query-Embedding-Aufrufen mit `k=5`, nicht aus Mock-Vektoren. Zwei Eingaben sind bewusst konstruierte positive Kontrollen aus Katalogmerkmalen; sie belegen den technischen Ablauf, keine Erkennungsgenauigkeit auf unabhängigen Fotos. Das Konkurrenzbeispiel stammt aus der zuvor bereitgestellten strukturierten Böker-Extraktion.

### Konkurrenzbeispiel: grosse Klinge, Schere, Korkenzieher, Clip, bestätigter Daumenpin

| Rang | Modell | Produkt-ID | Cosine Similarity |
|---|---|---|---:|
| 1 | Hunter Pro M | `0.9411.M3` | 0.809861 |
| 2 | Evoke Wood | `0.9415.D630` | 0.805701 |
| 3 | Golf Tool | `0.7052.T` | 0.802430 |
| 4 | Equestrian | `0.8583` | 0.798672 |
| 5 | Nail Clipper | `8.2050.B1` | 0.798223 |

### Benanntes Victorinox Classic SD mit vollständigen Katalogfunktionen

| Rang | Modell | Produkt-ID | Cosine Similarity |
|---|---|---|---:|
| 1 | Classic Sd | `0.6223` | 1.000000 |
| 2 | Classic Sd | `0.6223.840` | 1.000000 |
| 3 | Classic Sd Wood | `0.6221.63` | 0.965563 |
| 4 | Classic Sd Brilliant Carbon | `0.6221.90` | 0.937916 |
| 5 | Classic Sd Paris Style | `0.6223.E221` | 0.930953 |

### Zangen-Multitool mit Swiss-Tool-Funktionen, ohne Modellnamen

| Rang | Modell | Produkt-ID | Cosine Similarity |
|---|---|---|---:|
| 1 | Swiss Tool | `3.0323.L` | 0.919260 |
| 2 | Swiss Tool Mxbs | `3.0326.M3N` | 0.907753 |
| 3 | Swiss Tool Bs | `3.0323.3CN` | 0.903914 |
| 4 | Swiss Tool Mx | `3.0327.MN` | 0.898315 |
| 5 | Swiss Tool X | `3.0327.L` | 0.895238 |

## Gefundene Einschränkungen

1. **Semantik ist keine Funktionsabdeckung.** Beim Konkurrenzbeispiel liegt Hunter Pro M vorn; Schere und Korkenzieher werden dadurch nicht erhalten. Sogar Zubehör wie Nail Clipper erscheint in Top-5. Kategoriehinweise, Modelltexte und allgemeine Ähnlichkeit können bestätigte Arbeitsfunktionen überlagern. Diese Resultate werden nicht als passende Ersatzempfehlung dargestellt und gehen nicht in die bestehende Rangliste ein.
2. **Keine kalibrierte Konfidenz.** Ein Cosine-Wert von etwa 0,81 ist keine 81-prozentige Trefferwahrscheinlichkeit. Alle Werte sind reine Ähnlichkeitswerte; es gibt noch keinen evaluierten Schwellwert.
3. **Keine statistische Qualitätsevaluation.** Drei Proben und Self-Queries reichen nicht zur Bewertung von Top-1-/Top-3-Genauigkeit oder Generalisierung. Die starken positiven Kontrollen nutzen Kataloginformationen. Eine separate Evaluation auf den vorhandenen Foto-Extraktionen mit akzeptierten Alternativen wäre vor einer Integration erforderlich.
4. **Unvollständige Bildbeobachtung und Negation.** Text-Embeddings garantieren weder harte Nein-Bedingungen noch die geringere Bedeutung von `tools_maybe`. Die Struktur wird beschrieben, aber nicht als mathematische Nebenbedingung durchgesetzt.
5. **Versions- und Betriebsgrenzen.** Ein erfolgreicher Index bleibt bis zum Prozessneustart im Speicher. Ein Update muss mit einem Serverneustart bzw. einem später ausdrücklich gewünschten Deployment verbunden werden. Neue Modellnamen/Dimensionen brauchen kompatible Katalog- und Query-Vektoren. Azure-Embeddings sind nicht angebunden; die vorhandene Azure-Vision-Funktion bleibt unberührt.
6. **Öffentlicher Betrieb.** Der Testendpunkt ist standardmässig aus und hat keine neue Authentifizierung oder Rate-Limit-Infrastruktur. Eine öffentliche Freischaltung mit Kostenkontrolle ist nicht Teil dieser Änderung.

## Reproduktion

```bash
npm test
npm run embeddings:check
npm run embeddings:generate -- --dry-run
npm run embeddings:generate
npm run embeddings:search -- --extraction eval/semantic-search/competitor-example.json --k 5
npm run build
```

Die Suchbefehle benötigen den lokal konfigurierten `OPENAI_API_KEY`; Offline-Tests und Prüfung des gespeicherten Index benötigen keinen Schlüssel. Für HTTP separat `SEMANTIC_SEARCH_ENABLED=1` setzen. Genauer Ablauf und Statuscodes: [Dokumentation](../../docs/semantic-search.md).

API-Grundlage: [OpenAI Embeddings Guide](https://developers.openai.com/api/docs/guides/embeddings) und [Create Embeddings](https://developers.openai.com/api/reference/typescript/resources/embeddings/methods/create). Die Reihenfolge für ein festes Query und den gespeicherten Index ist deterministisch; ein erneuter Provider-Aufruf kann minimale numerische Änderungen liefern.
