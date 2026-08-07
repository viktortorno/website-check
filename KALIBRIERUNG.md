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

Zwei Ebenen:

- **`test/fixtures.ts`** — Module, die auf fertigem HTML arbeiten (content,
  privacy, psychology, techstack). Kein Netz, kein Browser.
- **`test/netzmodule.test.ts` + `test/fixture-server.ts`** — Module, die
  Adressen abrufen (geo, legalpages, aiact) sowie die Netzgrenze selbst. Ein
  lokaler Server liefert kontrollierte Antworten: kaputte Header, eine
  Fehlerseite mit HTTP 200, eine robots.txt mit getrennten Gruppen, ein Bild
  mit IPTC-Marker, ein 403 gegenüber KI-Bots, eine Weiterleitung auf
  169.254.169.254 und eine Antwort ohne Ende.

Der lokale Server läuft auf 127.0.0.1 — genau dem, was der SSRF-Schutz sperrt.
Die Sperre bleibt und hat dafür eine eng abgesteckte Ausnahme
(`loopbackErlaubt` in `ssrf.ts`): Sie verlangt **zwei** gleichzeitig gesetzte
Umgebungsvariablen, erlaubt **nur** Loopback (10.x, 192.168.x und die
Cloud-Metadaten-Adresse bleiben auch im Test gesperrt) und wird zur Laufzeit
ausgewertet — damit ein Test beweisen kann, dass sie ohne die Flags nicht
greift. Im Betrieb steht `NODE_ENV` auf `production`; dort kann sie nicht
wirken.

## Aktueller Stand

18 HTML-Fälle mit 53 Erwartungen, 12 Netz-Tests, 0 Abweichungen.

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

- **DNS- und RDAP-Module.** `dns.ts` (SPF, DMARC, DNSSEC, CAA) und `domain.ts`
  (Registry-Ablauf) fragen echte Resolver bzw. rdap.org. Ein Fixture-Server
  hilft dort nicht — das bräuchte einen eigenen DNS-Resolver im Test. Diese
  beiden bleiben ungeprüft gegen bekannte Wahrheit.
- **`seo.ts` und `security.ts` nur teilweise.** Beide prüfen zusätzlich TLS
  bzw. eine zweite Host-Variante; über `http://127.0.0.1` lässt sich das nicht
  nachstellen.
- **Der Browser-Scan selbst.** Pre-Consent-Tracking, Cookies, axe-core und die
  Messung bei Telefonbreite brauchen ein echtes Chromium. Die Fixtures decken
  die Auswertung ab, nicht die Erhebung.
- **Die Höhe der Strafpunkte — noch.** Die Fixtures prüfen, ob ein Befund
  *auftritt*, nicht ob 40 Punkte Abzug für `critical` die richtige Zahl sind.
  Der **Messrahmen dafür steht** (`npm run eichung`), die Stichprobe fehlt.

  ```bash
  npm run eichung -- --sammeln eichung/urls.txt   # scannt, legt Urteilsvorlage an
  # eichung/urteile.json von Hand ausfüllen: Schulnote 1-6 je Seite und Bereich
  npm run eichung -- --auswerten                  # vergleicht beides
  ```

  Die Auswertung nennt die mittlere absolute Abweichung, die systematische
  Verzerrung (ist das Werkzeug strenger oder milder als ein Mensch?), die
  größten Ausreißer und — am wertvollsten — **die Befunde, die auf gut
  geführten Seiten am häufigsten auftreten**. Ein Befund, der auf jeder als
  gut beurteilten Seite erscheint, misst nicht, was er behauptet, oder seine
  Schwelle sitzt falsch.

  Entscheidend ist die Reihenfolge: erst die Seiten ansehen und benoten, dann
  den Report lesen. Wer umgekehrt vorgeht, misst das Werkzeug an sich selbst.
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
