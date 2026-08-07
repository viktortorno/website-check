---
name: website-check
description: >-
  Prüft eine Website per URL deterministisch auf rechtliche Risiken (DSGVO,
  IT-Sicherheit, EU AI Act, Barrierefreiheit/BFSG) UND Wachstumsfaktoren (SEO,
  GEO/KI-Suche, Performance/Core Web Vitals, Conversion-Psychologie). Nutze
  diesen Skill, wenn jemand eine Website analysieren, auditieren, auf
  Rechtssicherheit oder DSGVO prüfen, SEO/Sichtbarkeit checken, Ladezeit messen
  oder konkrete Optimierungspotenziale finden möchte. Liefert pro Bereich eine
  Note (A–F) und priorisierbare Findings mit Rechtsgrundlagen und Empfehlungen.
---

# Website-Check

Ein eigenständiger, **deterministischer** Website-Auditor mit echter Scan-Engine
(Playwright + axe-core + RDAP/DNS/TLS) — keine KI-Schätzung zur Laufzeit, damit
die Aussagen reproduzierbar und belastbar sind.

## Wann diesen Skill verwenden

- „Prüf mal `firma-xyz.de`" / „Ist diese Seite DSGVO-konform?"
- „Wie steht meine Website bei SEO / in der KI-Suche da?"
- „Warum lädt die Seite so langsam?" / „Wie überzeugend ist die Landingpage?"
- Allgemein: Website-Audit, Rechtssicherheits-Check, Optimierungspotenziale.

## Setup (einmalig)

```bash
npm install        # installiert Abhängigkeiten + lädt Chromium (Playwright)
```

Voraussetzung: Node.js ≥ 18.18. Schlägt der Chromium-Download fehl, manuell:
`npm run setup`.

## Ausführung

**Lesbarer Report** (für die Antwort an den Nutzer):
```bash
npm run scan -- <url>
```

**Vollständiges JSON** (wenn du die Findings selbst weiterverarbeitest) — direkt
über `tsx` aufrufen, damit die Ausgabe banner-frei und maschinenlesbar ist:
```bash
npx tsx scripts/scan.ts <url> --json
```

`--all` zeigt zusätzlich alle bestandenen Prüfungen. Beispiel:
`npm run scan -- example.com --json`

**Rechtliche Anwendbarkeit** (optional, aber wertvoll): Wenn der Nutzer im
Gespräch erwähnt, wen er anspricht, wie groß er ist oder wo er sitzt, gib das
mit — dann behauptet der Report keine Pflichten, die den Betreiber nicht
treffen.

```bash
npx tsx scripts/scan.ts <url> --land=de --kunden=b2b --groesse=kleinst --angebot=nur-info
```

| Flag | Werte |
|---|---|
| `--land` | `de` · `eu` · `ausserhalb` |
| `--kunden` | `b2b` (nur Geschäftskunden) · `b2c` (auch Verbraucher) |
| `--groesse` | `kleinst` (<10 Beschäftigte, ≤2 Mio. €) · `ab10` |
| `--angebot` | `nur-info` · `online-abschluss` |

Frag nicht danach, wenn der Nutzer nichts gesagt hat — ohne Angaben läuft der
Scan wie zuvor. Kategorien, die nachweislich nicht gelten, erscheinen als
`NICHT ANWENDBAR` mit Begründung; ihre Befunde bleiben als Qualitätshinweis
stehen.

Ein Scan startet kurz Chromium und dauert ~5–20 Sekunden.

## Was geprüft wird (8 Bereiche, rund 75 Prüfpunkte)

**Rechtssicherheit & Risiko**
1. **DSGVO** — Tracker und Cookies vor der Einwilligung, Cookie-Laufzeiten über 12 Monate,
   Consent-Banner (im DOM erkannt, über alle Frames), fremde Einbettungen die ungefragt laden
   (YouTube, Maps, reCAPTCHA, CDNs, Newsletter), Google Fonts, Formular ohne Datenschutzhinweis,
   Impressum und Datenschutzerklärung inhaltlich auf Pflichtangaben
2. **IT-Sicherheit** — Security-Header, HTTPS/HSTS, TLS-Zertifikat, Mixed Content, Cookie-Flags,
   CSP-Qualität, Technologie-Stack (veraltete Libs), Domain-Ablauf (RDAP), SPF/DMARC/DKIM,
   **SPF-Lookup-Limit** (über 10 macht den Record ungültig), MTA-STS/TLS-RPT, CAA
3. **EU AI Act** — Herkunftsspuren in Bildern (C2PA/Content Credentials, IPTC
   `trainedAlgorithmicMedia`, Generator-Speicherorte), eingebundene KI-Dienste,
   Biometrie-/Emotionsbibliotheken (Art. 5), Chatbot-Transparenz (Art. 50)
4. **Barrierefreiheit (BFSG)** — echte WCAG-2.1-Prüfung via axe-core (Level A/AA)

**Sichtbarkeit & Conversion**
5. **SEO** — Title, Description, H1, Überschriften-Hierarchie, Canonical, Indexierbarkeit,
   Open Graph inkl. erreichbarem og:image, strukturierte Daten, Breadcrumbs, Sprachauszeichnung,
   Bild-Alt/Maße/Format, Linktexte, Textmenge, Soft-404-Probe, www/non-www-Dublette,
   **mobile Darstellung bei 390 px im echten Browser gemessen** (Überlauf, Tap-Targets)
6. **GEO / KI-Suche** — **Sichtbarkeit ohne JavaScript** (Quelltext gegen gerendertes DOM),
   **serverseitige Bot-Sperren** (Testabruf als GPTBot/PerplexityBot), KI-Crawler-Zugang in der
   robots.txt, llms.txt, Sitemap, Frage-Antwort-Struktur, zitierfähige Absätze, Faktendichte,
   Definitionssätze, Entitäts-Schema mit sameAs, Aktualität, ausgehende Quellen
7. **Performance** — Core Web Vitals (LCP, CLS, TTFB), Seitengewicht, Requests, DOM-Größe,
   **Bilder: gelieferte gegen dargestellte Größe** (mit Angabe der unnötigen Megabyte)
8. **Psychologie / Conversion** — Call-to-Action, Nutzenversprechen, Social Proof,
   Vertrauenssignale, Kontaktwege, Lead-Magnet

Die Ausgabe beginnt mit **Schnellste Gewinne**: die Befunde sortiert nach Wirkung pro
Aufwand, mit Zeitschätzung und Punktgewinn — „womit fange ich an?" statt nur „was ist
kaputt?". Jede Kategorie nennt im Report ihren Geltungsbereich — was sie abdeckt **und was nicht**
(keine AV-Verträge, keine Rankings, ein Drittel der WCAG-Kriterien, ein Messpunkt).

## Wie du das Ergebnis aufbereitest

1. Führe den Scan aus und lies die Ausgabe.
2. Nenne dem Nutzer **zuerst den Gesamteindruck** (Gesamtnote + die 2–3 gravierendsten Findings, `fail` vor `warn`).
3. Gruppiere nach den zwei Bereichen (Risiko vs. Wachstum).
4. Gib **priorisierte, konkrete Maßnahmen** — jede mit dem „Warum" (Empfehlung + ggf. Rechtsgrundlage aus dem Finding).
5. **Disclaimer immer mitgeben**: Dies ist eine automatisierte Prüfung und **ersetzt keine Rechtsberatung**.

## Grenzen (ehrlich kommunizieren)

- Tracker-/CMP-Listen sind nie vollständig; manche Seiten zeigen Bots eine Consent-Wall.
- AI-Act-Prüfung ist eine Heuristik (sichtbare Chatbots).
- Automatisierte WCAG-Tests decken ~30–50 % der Kriterien ab — manuelle Prüfung bleibt nötig.
- Domain-Ablauf ist bei `.de` (DENIC) nicht öffentlich abrufbar.
- Off-Site-Signale (Backlinks, Marken-Erwähnungen) werden nicht gemessen.
- Die Anwendbarkeit von Recht ist nicht messbar. Ohne die Flags oben bewertet
  der Scan nach EU-Maßstab und weist das aus — sag das dem Nutzer dazu, statt
  eine Pflicht als festgestellt darzustellen.
- Die Gewichtung der Strafpunkte ist begründet, aber nicht gegen einen
  Datensatz geeicht (siehe `KALIBRIERUNG.md`).

Details zu jedem Bereich, den Schwellenwerten und Rechtsgrundlagen:
siehe [`references/pruefbereiche.md`](references/pruefbereiche.md).
