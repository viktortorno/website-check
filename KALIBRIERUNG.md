# Kalibrierung der Prüfregeln

Stand: 07.08.2026

Dieses Dokument beantwortet eine Frage, die ein Prüfwerkzeug beantworten können
muss: **Woher weißt du, dass deine Befunde stimmen?**

## Der Maßstab

Die Fixture-Sammlung in `test/fixtures.ts` enthält Testseiten, deren korrektes
Ergebnis feststeht. Jeder Fall führt zwei Listen:

| Liste | Bedeutung | Verletzung heißt |
|---|---|---|
| `erwartet` | Diese Befunde müssen kommen | falsch-negativ (Mangel übersehen) |
| `verboten` | Diese Befunde dürfen nicht kommen | falsch-positiv (Fehlalarm) |

Die zweite Liste ist die wichtigere. Ein übersehener Mangel kostet den Kunden
eine Chance; ein Fehlalarm kostet ihn Arbeit an einem Problem, das es nicht
gibt — und uns die Glaubwürdigkeit für die echten Funde.

`npm test` schlägt bei **jeder** Abweichung fehl. Es gibt keine geduldete
Fehlerquote; eine solche Zahl würde später stillschweigend nach oben gezogen.

## Aktueller Stand

18 Fälle, 53 einzelne Erwartungen (erwartete plus ausgeschlossene Befunde), 0 Abweichungen.

Beim Aufbau der Sammlung wurden zwei reale Fehlalarme gefunden und behoben:

**1. Rechtsseiten unter anderer Beschriftung.** Eine Fußzeile mit dem Link
„Rechtliches" statt „Impressum" führte zu `dsgvo.no-impressum` — Schwere
`high`, gegen eine vollständig korrekte Seite. Behoben in
`lib/scan/modules/content.ts`: erkannt werden jetzt auch
„Anbieterkennzeichnung", „Rechtliches", „Legal Notice" und „Imprint". Die
inhaltliche Gegenprobe macht ohnehin `legalpages.ts`, das die verlinkte Seite
abruft und auf Pflichtangaben prüft.

**2. Fachartikel als Chatbot-Betreiber.** Die Erkennung von Chat-Widgets suchte
im gesamten HTML — auch im Fließtext. Ein Artikel über den AI Act, der
„Voiceflow" und „Botpress" erwähnt, galt damit als Betreiber eines KI-Systems
mit Kennzeichnungspflicht nach Art. 50. Behoben: Die Suche läuft jetzt nur über
Attributwerte und Skriptinhalte (`technischerTeil`), nicht über den Text, den
ein Besucher liest.

Beide Fälle hatten dieselbe Struktur — eine Regel, die auf ein Wort statt auf
eine Tatsache reagiert.

## Was hier NICHT abgedeckt ist

Ehrlich benannt, weil eine unvollständige Kalibrierung, die sich vollständig
gibt, schlimmer ist als gar keine:

- **Netzabhängige Module.** `security`, `dns`, `geo`, `legalpages`, `seo` und
  `aiact` rufen echte Adressen ab. Ein lokaler Fixture-Server würde vom eigenen
  SSRF-Schutz blockiert (localhost ist gesperrt — zu Recht). Diese Module sind
  nur über Live-Scans geprüft, nicht gegen bekannte Wahrheit.
- **Der Browser-Scan selbst.** Pre-Consent-Tracking, Cookies, axe-core und die
  Messung bei Telefonbreite brauchen ein echtes Chromium. Die Fixtures decken
  die Auswertung ab, nicht die Erhebung.
- **Die Höhe der Strafpunkte.** Die Fixtures prüfen, ob ein Befund *auftritt* —
  nicht, ob 40 Punkte Abzug für `critical` die richtige Zahl ist. Diese
  Gewichtung ist fachlich begründet (siehe Kopfkommentar in `scoring.ts`), aber
  nicht gegen einen Datensatz geeicht. Dafür bräuchte es eine Stichprobe real
  bewerteter Seiten mit unabhängigem Urteil.
- **Consent-Verhalten nach Ablehnung.** Das Werkzeug prüft den Zustand *vor*
  jeder Entscheidung. Ob abgelehnte Tracker trotzdem feuern, wird nicht
  gemessen.

## Einen Fall ergänzen

In `test/fixtures.ts` ein Objekt an `FIXTURES` anhängen. Pflichtfeld `these`:
ein Satz, der die fachliche Behauptung nennt, die der Fall festnagelt. Ohne
Begründung ist ein Testfall nur eine eingefrorene Momentaufnahme des aktuellen
Verhaltens — er verhindert dann Änderungen, statt Fehler zu verhindern.

Der ergiebigste Weg, neue Fälle zu finden: Nimm eine Regel und frage, welche
**korrekte** Umsetzung sie fälschlich treffen könnte. Genau so wurden die
beiden Fehlalarme oben gefunden.
