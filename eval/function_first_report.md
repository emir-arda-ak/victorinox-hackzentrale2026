# Function-first Matching – Bericht

Branch `feature/function-first-matching`. **Nicht gemergt, nicht deployt.** Bitte Diff und Zahlen prüfen.

## Was sich geändert hat

| Datei | Änderung |
|---|---|
| `lib/agent/functional.ts` (neu) | Reine Hilfsfunktionen: Klassifikation **Arbeitsfunktionen** vs. **Handhabung** (`clip`, `thumb_stud`, `lanyard_hole`, `key_ring`; `other` zählt nie), `functionalCoverageScore` (gewichtete Abdeckung der beobachteten Arbeitsfunktionen, 0..1, `null` = nichts beobachtet), `handlingScore`, `excessScore` |
| `lib/agent/score.ts` | Drei Modi: `victorinox` (Identifikation, bisherige Gewichte), `competitor` und `unknown` (Ersatz nach Funktionen). Neue Score-Teile `functional_coverage`, `handling`, `excess`, `learned` (gelernte Regeln getrennt von `crossref`). Kandidaten haben neu `functional` mit `matched_working_tools`, `missing_working_tools`, `matched_handling_attributes` (abwärtskompatibel, optional) |
| `lib/agent/explain.ts` | Begründung nennt abgedeckte/fehlende Arbeitsfunktionen und Handhabung getrennt; Feedback wird als «nicht geprüft» gekennzeichnet |
| `lib/agent/prompt.ts` | v5: Clip/Daumenpin allein macht kein Einhandmesser, wenn Schere/Korkenzieher/Öffner sichtbar sind |
| `config/scoring.json` | `modes.{victorinox,competitor,unknown}` und `functional.*` (siehe unten). `weights` bleibt nur als Referenz |
| `scripts/test-score.ts` | 15 neue Assertions (siehe Tests) |

## Entscheidungen

- **Abdeckung (Recall)**: beobachtete Arbeitsfunktionen gewichtet nach Sichtbarkeit; vom Nutzer bestätigt ×1.25, Vision ×1, «vielleicht» ×0.4; «Nein»-Antworten zählen nicht. Unterwerkzeug 0.6, andere Klingengrösse 0.8, Wellenschliff/Hakenklinge durch normale Klinge 0.6 (Teilkredit, kein exakter Treffer). Nicht gesehene Katalog-Werkzeuge gelten **nicht** als fehlend.
- **Handhabung separat** (Gewicht 0.75): Clip + Daumenpin können zwei fehlende Arbeitsfunktionen nicht ausgleichen.
- **Kategorie** im Ersatzmodus weich: SAK↔ONEHAND −0.3, SAK↔MULTITOOL −0.6 statt −1. Gewicht **adaptiv**: 2.5 bei 0 bestätigten Arbeitsfunktionen, sinkt auf 1.0 ab 3 Funktionen (einzelne Fotos mit nur einer Klinge brauchen die Kategorie weiterhin).
- **Kategorie-Widerspruch**: «Einhandmesser» mit ≥2 Nicht-Klingen-Arbeitsfunktionen wird scoringseitig als Taschenmesser (mit Zange: Multitool) bewertet, Gewicht halbiert, Konfidenz nie «high». Die Erkennung selbst wird nicht umgeschrieben.
- **Gelernte Regeln** (Feedback): Bonus × Abdeckung² des Kandidaten, Gewicht 1.5 (statt 4). Eine Regel kann einen Funktions-Mismatch nicht mehr überstimmen. Platz 1 nur dank Feedback → Konfidenz höchstens «medium». Victorinox-Pfad unverändert.
- **Excess**: kleine log-skalierte Strafe, wenn der Vorschlag ein Vielfaches der beobachteten Funktionen hat (sonst gewinnt der Swiss Champ XXL, weil er «alles abdeckt»).
- **Unbekannte Marke**: Ersatzmodus mit Zwischengewichten (Kategorie 1.5–2.5, Modellname zählt).
- Material «Andere» passt auf nichts; fehlende Katalog-Länge bleibt neutral (0).
- **Konfidenz** bleibt ein heuristischer Zuverlässigkeitswert, keine kalibrierte Wahrscheinlichkeit; auf [0,1] begrenzt, Feedback-Bonus zählt nicht zum «Fit».

Alle Startwerte sind **Hypothesen**, nicht trainiert.

## Böker-Beispiel (aus der Aufgabe)

| | Top-1 vorher | Top-1 nachher |
|---|---|---|
| ohne Regeln | Evoke Bs Alox (Kategorie 1.96, kein Korkenzieher/Schere) | **Outrider** 0.8513 (Klinge, Schere, Korkenzieher, Säge), Konfidenz 0.74 medium |
| mit gelernter Evoke-Regel | Evoke Bs Alox, crossref +4 | **Outrider**; Evoke nicht in den Top-10 |
| nur Klinge + Clip + Daumenpin | Evoke | Evoke-Modelle auf Platz 1–3 |

## Evaluation (gespeicherte Erkennungen, `--rescore --no-sku`, keine Vision-Calls)

Explorativ: 15 Messer, 123 Fotos, Ground Truth = akzeptierte Alternativen.

| | Top-1 vorher | Top-1 nachher | Top-3 vorher | Top-3 nachher |
|---|---|---|---|---|
| Pro Foto, alle | 27/123 (22 %) | 27/123 (22 %) | 43/123 (35 %) | **45/123 (37 %)** |
| Pro Foto, Konkurrenz | 19/55 | **20/55** | 26/55 | **28/55** |
| Pro Foto, Victorinox | 5/65 | 4/65 | 14/65 | 14/65 |
| Pro Messer, alle | 11/15 (73 %) | **12/15 (80 %)** | 13/15 (87 %) | 13/15 (87 %) |
| Pro Messer, Konkurrenz | 5/8 | **6/8** | 7/8 | 7/8 |
| «high» und falsch | 0/3 | 0/3 | | |

Änderungen pro Messer: Armbar Drive Top-1 jetzt Cyber Tool M (vorher Synergy X, also Ersatz ohne Bits). Böker bleibt Climber auf Platz 1 (Konfidenz 0.18 → 0.42); Synergy X (ohne Korkenzieher) fällt aus den Top-3, dafür Huntsman und Compact. (Die gespeicherten Böker-Fotos sind als SAK erkannt; der im Live-Test beobachtete «ONEHAND»-Fall ist oben als Unit-Test abgedeckt.) Pro Foto: Suspension/REV/Swiza/Crater-Einzelfotos besser, **Regression**: Classic SD zugeklappt (nur Ring) Top-1 0.6223 → 0.6123 (bleibt Top-3), Suspension-Foto nur mit Klinge Top-1 → Sentinel (bleibt Top-3).

Weiterhin falsch: Ranger 57 (Waidklinge nicht erkannt – wird live durch die Selbstprüfung des Agenten adressiert), Spyderco (fehlende Arretierung ist auf Fotos nicht sichtbar).

Nicht gelaufen: Vergleich mit SKU (`ohne --no-sku`), Live-Vision mit Prompt v5, Lint.

## Empfehlung

Mergen, wenn der Live-Test auf der Vercel-Preview mit 2–3 Konkurrenzmessern plausibel aussieht. Die Zahlen verbessern sich leicht und ohne Regression pro Messer; der grössere Gewinn ist qualitativ (keine Funktions-Mismatches mehr auf Platz 1, Feedback kann nicht mehr dominieren).
