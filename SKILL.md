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

Ein Scan startet kurz Chromium und dauert ~5–20 Sekunden.

## Was geprüft wird (8 Bereiche)

**Rechtssicherheit & Risiko**
1. **DSGVO** — Pre-Consent-Tracking, Cookies ohne Einwilligung, Google Fonts, CMP, Impressum, Datenschutzerklärung
2. **IT-Sicherheit** — Security-Header, HTTPS/HSTS, TLS-Zertifikat, Mixed Content, Cookie-Flags, CSP-Qualität, Technologie-Stack (veraltete Libs), Domain-Ablauf (RDAP)
3. **EU AI Act** — Chatbot-/KI-Transparenzpflicht (Art. 50)
4. **Barrierefreiheit (BFSG)** — echte WCAG-2.1-Prüfung via axe-core (Level A/AA)

**Sichtbarkeit & Conversion**
5. **SEO** — Title, Meta-Description, H1, Canonical, Indexierbarkeit, Open Graph, strukturierte Daten
6. **GEO / KI-Suche** — KI-Crawler-Zugang (robots.txt), llms.txt, Sitemap, Frage-Antwort-Struktur, Entitäts-Schema, E-E-A-T
7. **Performance** — Core Web Vitals (LCP, CLS, TTFB), Seitengewicht, Requests, DOM-Größe
8. **Psychologie / Conversion** — Call-to-Action, Nutzenversprechen, Social Proof, Vertrauenssignale, Kontaktwege, Lead-Magnet

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

Details zu jedem Bereich, den Schwellenwerten und Rechtsgrundlagen:
siehe [`references/pruefbereiche.md`](references/pruefbereiche.md).
