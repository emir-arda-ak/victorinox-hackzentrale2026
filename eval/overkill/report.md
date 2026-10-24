# Proportionale Ersatzempfehlungen – 24.10.2026

Ausgangsstand: `59a2c13`, Feature-Branch `codex/proportional-replacements`.

## Problem und Änderung

Ein Böker mit grosser Klinge, Wellenschliff, Schere und Korkenzieher wurde in Richtung Swiss Champ/XXL bewertet. Fischentschupper und Holzmeissel waren laut Nutzer falsch erkannt. Das lässt sich mit einer synthetischen Extraktion reproduzieren; das Originalfoto liegt für diesen Test nicht vor.

Zwei Ursachen:

- Viele `tools_maybe` konnten gemeinsam den primären Abdeckungswert dominieren, obwohl jedes einzelne Merkmal schwach gewichtet war.
- `tools_seen` wurden bei Rückfragen grundsätzlich übersprungen. Eine falsche, aber als sicher ausgegebene Erkennung wurde dadurch nicht gezielt überprüft.

Die Ersatzpfade `competitor` und `unknown` bewerten nun die Abdeckung sicher erkannter bzw. bestätigter Arbeitsfunktionen separat. Sämtliche unsicheren Werkzeuge teilen sich einen Bonus von höchstens 0,5 Punkten. Die Komplexitätspräferenz steigt von maximal 2 auf 3 Punkte (gegenüber 11 Punkten Spannweite der bestätigten Funktionsabdeckung). Ihr Umfang verwendet das Maximum aus kanonischen Arbeitswerkzeugen und der halben Katalog-Funktionszahl: Dadurch verschwindet die zusätzliche Komplexität des XXL nicht hinter deduplizierten Werkzeug-IDs. Die Werte sind konfigurierbare Heuristiken, keine trainierten Parameter.

Die Rückfragelogik sucht bei Ersatzempfehlungen nach einem kleineren Modell derselben Kategorie und Kataloglänge. Hat der Gewinner mindestens 1,5-mal so viele Funktionen, deckt die kleinere Alternative mindestens 60 % des bestätigten Profils ab und fehlen ihr nur ein oder zwei noch unbeantwortete Vision-Merkmale, werden diese gezielt nachgeprüft. Das seltenere Merkmal kommt zuerst. Explizite Antworten werden respektiert; allein die Komplexitätsprüfung entfernt kein Werkzeug.

Der vorhandene Agent übernimmt bis zu zwei Bildprüfungen. Eine negative Antwort wird erst ab 0,85 Sicherheit akzeptiert; eine unklare, zu schwache oder fehlgeschlagene Prüfung führt zur Nutzerfrage. Foto- und Rückfragelimits bleiben erhalten. Der Victorinox-Identifikationspfad und die getrennte Embedding-Suche bleiben fachlich unverändert.

## Gezielte Resultate

- Drei Kernfunktionen plus vier unsichere Extras: kompaktes Modell statt Swiss Champ.
- Eine Klinge plus acht unsichere Extras: kleines Modell statt XXL.
- Böker mit sechs angeblich gesehenen Funktionen: zuerst Fischentschupper, nach dessen Verneinung Holzmeissel nachprüfen. Mit beiden Korrekturen gewinnt Climber im 91-mm-Testfall.
- Der Wellenschliff wird bei Climber weiterhin nur als **teilweise abgedeckt** ausgewiesen. Climber ist kein vollständiger Ersatz für eine Wellenschliffklinge.
- Bestätigte Bits, Fischentschupper oder Holzmeissel sowie echte vollständige Swiss-Champ-/XXL-Profile behalten passende grössere Modelle.
- Negative, positive, unsichere, zu schwache und fehlschlagende Nachprüfungen wurden mit simulierten Vision-Antworten durch den vollständigen Agentenablauf geprüft.

## Tests und gespeicherte Evaluation

`npm test`, `npx tsc --noEmit`, `npm run lint` und `npm run build` erfolgreich. Zusätzlich zu den bisherigen Scoring- und 23 Embedding-Tests gibt es 14 neue Regressionstests (`npm run test:overkill`). Alle Tests laufen ohne externe API-Aufrufe. Der Produktionsbuild benötigt in dieser Umgebung die Ausführung ausserhalb der Sandbox für Turbopack.

123 gespeicherte Fotoextraktionen, kombiniert zu 15 Messern; keine neue Vision-Erkennung und keine Feedback-Regeln. Primärer Vergleich ohne sichtbare SKU. Einzelheiten: [vorher](before-no-sku.csv), [nachher](after-no-sku.csv).

| Auswertung | Vorher Top-1 | Nachher Top-1 | Vorher Top-3 | Nachher Top-3 |
| --- | ---: | ---: | ---: | ---: |
| Fotos ohne SKU | 28/123 | 27/123 | 43/123 | 39/123 |
| Messer ohne SKU | 12/15 | 12/15 | 13/15 | 13/15 |
| Fotos mit SKU | 33/123 | 32/123 | 47/123 | 44/123 |
| Messer mit SKU | 12/15 | 12/15 | 14/15 | 14/15 |

Die durchschnittliche exakte Abdeckung sicher erkannter Funktionen bleibt ohne SKU unverändert: 0,978 pro Foto mit Evidenz (91 Fälle), 0,900 pro Messer (15 Fälle). Die Konkurrenzmesser behalten kombiniert 6/8 Top-1 und 7/8 Top-3.

Vier Top-3-Rückgänge ohne SKU, alle mit sehr wenig sichtbarer Funktionsinformation:

- Camper, teilweise geöffnet, nur Korkenzieher/Ring erkannt: kleinere Modelle verdrängen Camper aus Top-3. Dieser Foto-Fall läuft nicht im sicher identifizierten Victorinox-Pfad.
- Gerber Suspension, teilweise geöffnet, nur grosse Klinge erkannt: kleinere Messer verdrängen das erwartete Multitool; einziger Top-1-Verlust.
- Leatherman REV, geschlossen, nur Clip erkannt: erwartetes Modell fällt aus Top-3.
- Swiza D03, geschlossen, keine Werkzeuge erkannt: kleinere Modelle verdrängen die erwarteten Modelle. Bei geschlossenen Messern fordert die erste Rückfrage weiterhin ein geöffnetes Foto.

Es wird daher **keine allgemeine Verbesserung der Top-k-Genauigkeit** behauptet. Die Änderung löst den gezielten Overkill-Fall; bei knapper Bildevidenz ist die konservativere Auswahl kleinerer Modelle ein messbarer Trade-off. Vollständige Bildansichten und Rückfragen bleiben nötig.

## Reproduktion und Grenzen

```bash
npm test
npm run test:overkill
python3 eval/run_eval.py --offline --no-sku --out /tmp/overkill-no-sku.csv
python3 eval/run_eval.py --offline --out /tmp/overkill-with-sku.csv
```

Die automatische Bildprüfung wurde simuliert, nicht an einem neuen Böker-Foto gemessen. Die Offline-Evaluation bewertet gespeicherte Extraktionen und berechnete Fragen; sie führt keine Bildnachprüfung aus. Eine falsche Erkennung kann bestehen bleiben, wenn auch die Nachprüfung falsch positiv ist. Explizite Nutzerkorrekturen haben weiterhin Vorrang. Die Funktionenzahl ist ein grober Komplexitätsindikator, kein Gewicht oder Mass der Griffdicke. Bei unbekannter Kategorie, fehlender Kataloglänge oder mehr als zwei strittigen Funktionen greift die gezielte Prüfung gegebenenfalls nicht. Es werden keine Modelle pauschal ausgeschlossen.
