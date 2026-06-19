# 🛡️ Website-Check

Ein **deterministischer** Website-Auditor als [Claude](https://claude.com/claude-code)-Skill **und** CLI.
Prüft eine beliebige Website per URL in **8 Bereichen** — von rechtlichen Pflichten
bis zu Wachstumsfaktoren — und liefert pro Bereich eine Note (A–F) mit konkreten,
priorisierbaren Handlungsempfehlungen.

> Echte Scan-Engine (Playwright, axe-core, RDAP, DNS/TLS) statt KI-Schätzung zur
> Laufzeit — die Ergebnisse sind reproduzierbar und belastbar.

## Was wird geprüft?

| | Bereich | Beispiele |
|---|---|---|
| ⚖️ | **DSGVO / Datenschutz** | Pre-Consent-Tracking, Cookies ohne Einwilligung, Google Fonts, CMP, Impressum, Datenschutzerklärung |
| 🔒 | **IT-Sicherheit** | Security-Header, HTTPS/HSTS, TLS-Zertifikat, Mixed Content, Cookie-Flags, CSP-Qualität, veraltete Libraries, Domain-Ablauf |
| 🤖 | **EU AI Act** | Chatbot-/KI-Transparenzpflicht (Art. 50) |
| ♿ | **Barrierefreiheit (BFSG)** | echte WCAG-2.1-Prüfung via **axe-core** (Level A/AA) |
| 🔍 | **SEO** | Title, Meta-Description, H1, Canonical, Indexierbarkeit, Open Graph, strukturierte Daten |
| ✨ | **GEO / KI-Suche** | KI-Crawler-Zugang (robots.txt), llms.txt, Sitemap, Frage-Antwort-Struktur, Entitäts-Schema, E-E-A-T |
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

## Grenzen

- Tracker-/CMP-Listen sind nie vollständig; manche Seiten zeigen Bots eine Consent-Wall.
- Die AI-Act-Prüfung ist eine Heuristik (sichtbare Chatbots).
- Automatisierte WCAG-Tests decken ~30–50 % der Kriterien ab — manuelle Prüfung (Tastatur, Screenreader) bleibt für volle BFSG-Konformität nötig.
- Domain-Ablaufdatum ist bei `.de`-Domains (DENIC) nicht öffentlich abrufbar.
- Off-Site-Signale (Backlinks, Marken-Erwähnungen) werden nicht gemessen.

**Wichtig:** Dies ist eine automatisierte Prüfung und **ersetzt keine Rechtsberatung**.

## Credits

Inspiriert von u. a. [`geo-seo-claude`](https://github.com/zubair-trabzada/geo-seo-claude),
[`claude-seo`](https://github.com/AgriciDaniel/claude-seo) und [`web-check`](https://github.com/lissy93/web-check).

## Lizenz

[MIT](LICENSE)
