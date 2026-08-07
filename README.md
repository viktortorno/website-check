# Website-Check

Ein **deterministischer** Website-Auditor als [Claude](https://claude.com/claude-code)-Skill **und** CLI.
Prüft eine beliebige Website per URL in **8 Bereichen** (rund 75 Prüfpunkte) — von rechtlichen Pflichten
bis zu Wachstumsfaktoren — und liefert pro Bereich eine Note (A–F) mit konkreten,
priorisierbaren Handlungsempfehlungen.

> Echte Scan-Engine (Playwright, axe-core, RDAP, DNS/TLS) statt KI-Schätzung zur
> Laufzeit — die Ergebnisse sind reproduzierbar und belastbar.

## Was wird geprüft?

| | Bereich | Beispiele |
|---|---|---|
| ⚖️ | **DSGVO / Datenschutz** | Tracker/Cookies vor der Einwilligung, Cookie-Laufzeiten, Consent-Banner (im DOM, über alle Frames), fremde Einbettungen (YouTube, Maps, reCAPTCHA, CDNs), Formular ohne Datenschutzhinweis, Impressum + Datenschutzerklärung inhaltlich |
| 🔒 | **IT-Sicherheit** | Security-Header, HTTPS/HSTS, TLS-Zertifikat, Mixed Content, Cookie-Flags, CSP-Qualität, veraltete Libraries, Domain-Ablauf |
| 🤖 | **EU AI Act** | Herkunftsspuren in Bildern (C2PA, IPTC `trainedAlgorithmicMedia`), eingebundene KI-Dienste, Biometrie-Bibliotheken (Art. 5), Chatbot-Transparenz (Art. 50) |
| ♿ | **Barrierefreiheit (BFSG)** | echte WCAG-2.1-Prüfung via **axe-core** (Level A/AA) |
| 🔍 | **SEO** | Title, Description, H1 + Hierarchie, Canonical, Indexierbarkeit, Open Graph, strukturierte Daten, Breadcrumbs, `lang`, Bilder, Linktexte, Soft-404, www-Dublette, **mobile Darstellung bei 390 px gemessen** |
| ✨ | **GEO / KI-Suche** | **Sichtbarkeit ohne JavaScript**, **serverseitige Bot-Sperren** (Testabruf als GPTBot/PerplexityBot), robots.txt, llms.txt, Sitemap, zitierfähige Absätze, Faktendichte, Definitionssätze, sameAs, Aktualität, Quellen |
| ⚡ | **Performance** | Core Web Vitals (LCP, CLS, TTFB), Seitengewicht, Requests, DOM-Größe |
| 🧠 | **Psychologie / Conversion** | Call-to-Action, Nutzenversprechen, Social Proof, Vertrauenssignale, Kontaktwege, Lead-Magnet |

## Schnellstart

```bash
git clone https://github.com/<dein-user>/website-check.git
cd website-check
npm install          # installiert Abhängigkeiten + Chromium

npm run scan -- example.com
```

Voraussetzung: **Node.js ≥ 18.18**. Falls der Chromium-Download fehlschlägt: `npm run setup`.

### Als CLI

```bash
npm run scan -- firma-xyz.de            # lesbarer Report
npm run scan -- https://firma-xyz.de --json   # vollständiges JSON
npm run scan -- firma-xyz.de --all      # inkl. aller bestandenen Prüfungen
```

### Als Claude-Skill

Lege das Repo in deinem Skills-Verzeichnis ab (z. B. `~/.claude/skills/website-check`)
oder installiere es als Plugin. Claude erkennt den Skill über die `SKILL.md` und
nutzt ihn automatisch, sobald du z. B. sagst:

> „Prüf mal meine Website example.com auf Rechtssicherheit und SEO."

## Beispiel-Ausgabe

```
════════════════════════════════════════════════════════════
  WEBSITE-CHECK — https://example.com
════════════════════════════════════════════════════════════
  Gesamt: Note B  (82/100)
  9 Auffälligkeiten · 6.1 s

── RECHTSSICHERHEIT & RISIKO ─────────────────────────────
  ▸ DSGVO / Datenschutz — Note D (55/100)
     ✗ Keine Datenschutzerklärung gefunden
        ...
        → DSGVO-konforme Datenschutzerklärung erstellen und verlinken.
        ⚖ Art. 13 DSGVO
  ...
```

## Architektur

```
scripts/
  scan.ts              CLI-Einstieg (Report-Formatierung)
  engine/
    runner.ts          orchestriert alle Module + SSRF-Schutz + Kurz-Cache
    scoring.ts         Bewertungslogik (Strafpunkte, Kategorie-Gewichte)
    types.ts           gemeinsame Datentypen
    trackers.ts        bekannte Tracker-/CMP-Signaturen
    modules/
      browser.ts       Playwright: Pre-Consent-Tracker, Cookies, Core Web Vitals, axe-core
      security.ts      Header, HTTPS, TLS, CSP
      dns.ts           SPF / DKIM / DMARC
      domain.ts        Domain-Ablauf via RDAP
      content.ts       Impressum, Datenschutz, AI Act
      accessibility.ts mappt axe-core-WCAG-Verstöße
      performance.ts   bewertet Core Web Vitals + Seitengewicht
      seo.ts           On-Page-SEO
      geo.ts           Generative Engine Optimization
      psychology.ts    Conversion-/Persuasion-Heuristiken
      techstack.ts     Technologie-Erkennung + veraltete Libraries
```

Die Bewertungslogik (Strafpunkte je Schweregrad, Gewichtung der Bereiche) liegt
zentral und gut kommentiert in [`scripts/engine/scoring.ts`](scripts/engine/scoring.ts)
— dort lässt sich der Charakter des Reports (streng vs. fair) anpassen.

## Bewertung

Es gibt **keine gemeinsame Gesamtnote**. Rechtssicherheit und Wachstum werden
getrennt ausgewiesen — gute Sichtbarkeit darf eine fehlende Pflichtangabe nicht
ausgleichen. Ein kritischer Befund deckelt die Note des betroffenen Bereichs.

**„Nicht geprüft" ist keine Note.** Konnte ein Bereich nicht gemessen werden
(häufigster Fall: der Browser startet nicht), steht dort `nicht geprüft` statt
einer Punktzahl. Der Exit-Code sagt dasselbe: `0` vollständig, `1` teilweise,
`2` gescheitert.

**„Nicht anwendbar" ist auch keine Note.** Wer die optionalen Angaben zum
Betreiber macht, bekommt für Pflichten, die ihn nicht treffen, keine schlechte
Note, sondern gar keine — mit Begründung. Beispiel: Das BFSG erfasst
Dienstleistungen an Verbraucher; ein reines B2B-Angebot fällt nicht darunter.
Die Befunde bleiben trotzdem stehen, dann als Qualitäts- statt Rechtshinweis.

```bash
npm run scan -- firma-xyz.de --land=de --kunden=b2b --groesse=kleinst --angebot=nur-info
```

| Flag | Werte | wirkt auf |
|---|---|---|
| `--land` | `de`, `eu`, `ausserhalb` | DDG-Zitate, DSGVO, AI Act |
| `--kunden` | `b2b`, `b2c` | BFSG |
| `--groesse` | `kleinst`, `ab10` | BFSG (Kleinstunternehmen-Ausnahme) |
| `--angebot` | `nur-info`, `online-abschluss` | BFSG |

Alle Flags sind freiwillig. Ohne sie wird wie zuvor bewertet — nur mit
ausgewiesenem Vorbehalt statt einer Feststellung.

**Der Seitentyp wird automatisch erkannt.** Aus URL, Überschrift und Schema.org
leitet das Werkzeug ab, ob es eine Startseite, einen Artikel, eine Produkt- oder
eine Rechtsseite vor sich hat — und passt die Erwartung an. Eine
Datenschutzerklärung wird nicht mehr auf einen fehlenden Verkaufsbutton geprüft,
eine Startseite nicht auf einen fehlenden Breadcrumb-Pfad. Erkannt wird nur, was
eindeutig ist; im Zweifel bleibt es beim vollen Prüfumfang. Der erkannte Typ
steht im Report.

**„Experimentell" ist eine dritte Kennzeichnung.** GEO/KI-Suche zählt in die
Sichtbarkeitsnote, trägt aber sichtbar den Hinweis, dass seine Regeln
Erfahrungswerte sind und keine belegte Wissenschaft. Niemand kann heute messen,
ob eine kürzere Absatzlänge dazu führt, dass ChatGPT eine Seite zitiert.

**Kalibrierung.** Die Regeln werden gegen Testseiten mit bekannter Wahrheit
geprüft — HTML-Fixtures für die Auswertung, ein lokaler Fixture-Server für die
Module, die Adressen abrufen. Schwerpunkt ist die Frage „erzeugt ein korrektes
Setup garantiert keinen Vorwurf?". Methodik, Ergebnisse und die bekannten
Lücken stehen in [`KALIBRIERUNG.md`](KALIBRIERUNG.md).

## Grenzen

- Tracker-/CMP-Listen sind nie vollständig; manche Seiten zeigen Bots eine Consent-Wall.
- Die AI-Act-Prüfung wertet **Spuren** aus (C2PA, IPTC, Speicherorte, eingebundene Dienste). Ob ein Bild KI-generiert ist, lässt sich von außen nicht beweisen — ohne Spuren wird deshalb keine Aussage getroffen. Fehlende Spuren sind kein Beweis für Fotografie: Metadaten gehen beim Bearbeiten regelmäßig verloren.
- Automatisierte WCAG-Tests decken ~30–50 % der Kriterien ab — manuelle Prüfung (Tastatur, Screenreader) bleibt für volle BFSG-Konformität nötig.
- Domain-Ablaufdatum ist bei `.de`-Domains (DENIC) nicht öffentlich abrufbar.
- Off-Site-Signale (Backlinks, Marken-Erwähnungen) werden nicht gemessen.
- **Die rechtliche Anwendbarkeit ist nicht messbar — sie wird erfragt.** Ob das
  BFSG einen Betreiber trifft, ob er B2B oder B2C anbietet und aus welchem Land
  er betreibt, steht in keiner Seite. Ohne die optionalen Angaben (siehe
  „Bewertung") bewertet das Werkzeug nach EU-Maßstab und weist den Vorbehalt
  aus. Die Befunde bleiben in jedem Fall technische Signale, keine Feststellung
  eines Verstoßes.
- **Die Höhe der Strafpunkte ist noch nicht geeicht.** Dass ein kritischer
  Befund 40 Punkte kostet, ist fachlich begründet, aber nicht gegen einen
  Datensatz real bewerteter Seiten geprüft. Der Messrahmen dafür steht
  (`KALIBRIERUNG.md`), die Stichprobe fehlt.
- **Der Consent-Vorgang wird nicht durchgespielt.** Geprüft wird der Zustand
  VOR jeder Entscheidung. Ob abgelehnte Tracker trotzdem feuern, misst dieses
  Werkzeug nicht.
- Performance ist **ein synthetischer Laborabruf**, kein Feldwert. Die offiziellen
  Core Web Vitals (LCP, INP, CLS) werden am 75. Perzentil echter Besuche
  bewertet; INP lässt sich ohne Interaktion nicht erheben und fehlt hier.
- Die GEO-Regeln (Absatzlänge, Faktendichte, Definitionssätze, llms.txt) sind
  **Erfahrungswerte, keine belegte Wissenschaft**. Sie taugen als Anregung.
- Geprüft wird **eine** Seite, nicht die ganze Website: doppelte Titles, interne 404er und Klicktiefe bleiben deshalb außen vor.

**Wichtig:** Dies ist eine automatisierte Prüfung und **ersetzt keine Rechtsberatung**.

## Credits

Inspiriert von u. a. [`geo-seo-claude`](https://github.com/zubair-trabzada/geo-seo-claude),
[`claude-seo`](https://github.com/AgriciDaniel/claude-seo) und [`web-check`](https://github.com/lissy93/web-check).

## Lizenz

[MIT](LICENSE)
