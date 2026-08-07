# Prüfbereiche im Detail

Referenz für Claude und für Menschen: was jeder Bereich konkret prüft, welche
Schwellenwerte gelten und auf welcher Rechtsgrundlage die Findings beruhen.

Die Bewertung pro Bereich startet bei 100 Punkten; je nicht bestandenem Finding
werden Punkte abgezogen (`critical` 40, `high` 20, `medium` 10, `low` 4; `warn`
zählt halb). Gewichtung der Bereiche im Gesamtscore und alle Schwellen:
`scripts/engine/scoring.ts`.

---

## ⚖️ DSGVO / Datenschutz

- **Pre-Consent-Tracking** — Tracker/Dienste, die VOR der Einwilligung feuern (Art. 6 DSGVO, § 25 TDDDG). Es wird bewusst NICHT auf den Cookie-Banner geklickt.
- **Cookies ohne Einwilligung** — nicht-essenzielle Cookies vor Opt-in (§ 25 TDDDG).
- **Google Fonts** vom Google-Server (IP-Übertragung in die USA; LG München I, Az. 3 O 17493/20).
- **Consent-Banner / CMP** vorhanden und erkennbar.
- **Impressum** (§ 5 DDG) und **Datenschutzerklärung** (Art. 13 DSGVO) verlinkt.

## 🔒 IT-Sicherheit

- **Security-Header**: HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy.
- **CSP-Qualität**: warnt bei `unsafe-inline` / `unsafe-eval`.
- **HTTPS-Zwang** (HTTP→HTTPS-Redirect) und **TLS-Zertifikat** (Ablauf, Protokollversion).
- **Mixed Content**: HTTPS-Seite, die HTTP-Ressourcen lädt.
- **Cookie-Flags**: fehlendes `Secure` / `HttpOnly`.
- **Technologie-Stack**: erkennt CMS/Frameworks/Libraries; warnt bei veraltetem jQuery (< 3.5, CVE-2020-11022/11023) und Versions-Leak im `generator`-Meta.
- **Domain-Ablauf** via RDAP (für gTLDs; `.de` veröffentlicht kein Datum).

## 🤖 EU AI Act

- **Chatbot-Transparenz** (Art. 50, ab 08/2026): Erkennt gängige Chat-Widgets und prüft, ob auf KI/Automatisierung hingewiesen wird. Heuristik — kein Ersatz für eine AI-Act-Einordnung des konkreten Systems.

## ♿ Barrierefreiheit (BFSG)

- **axe-core** (WCAG 2.1, Level A & AA): Kontraste, ARIA, Formular-Labels, Frame-Namen, SVG-Alt u. v. m. Schweregrad aus axe (`critical`/`serious`/`moderate`/`minor`).
- Fällt axe aus (z. B. blockiert), greift eine HTML-Heuristik (lang-Attribut, Alt-Texte, H1, Viewport, Labels).
- Automatisierte Tests decken nur einen Teil der WCAG-Kriterien ab.

## 🔍 SEO

- **Title** (ideal ~50–60 Zeichen), **Meta-Description** (~120–160).
- **H1** (genau eine), **Canonical**, **Indexierbarkeit** (`noindex`?).
- **Open Graph** (og:title, og:image), **strukturierte Daten** (JSON-LD/Schema.org).
- Bild-Alt-Texte, URL-Qualität.
- **Indexierungs-Diagnose** (die unsichtbaren Fehler, die Rankings kosten):
  - **X-Robots-Tag** im HTTP-Header — `noindex`, das im Quelltext nicht steht.
  - **Widerspruch** zwischen Meta-robots und Header.
  - **Canonical-Ziel**: erreichbar? indexierbar? Schleife (A↔B) oder Kette (A→B→C)?
    Ein Canonical auf eine `noindex`-Seite verhindert, dass irgendeine der beiden rankt.
  - **hreflang**: Selbstreferenz vorhanden (fehlt sie, verwirft Google das ganze Set),
    gültige Sprachcodes, `x-default`. Volle Reziprozität bleibt dem Multi-Page-Crawl
    vorbehalten — ein Ein-Seiten-Scan kann sie nicht prüfen.

## ✨ GEO / KI-Suche (Generative Engine Optimization)

- **KI-Crawler-Zugang** in `robots.txt` (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended u. a.).
- **llms.txt** (junger Standard, kein bestätigter Ranking-Faktor — ehrlich so gekennzeichnet).
- **sitemap.xml**.
- **Zitierbarkeit**: frage-basierte Überschriften / FAQ-Struktur.
- **Entitäts-Schema** (Organization/Person/LocalBusiness) und **E-E-A-T** (Autor, Datum).
- Off-Site-Signale (Wikipedia/Reddit/YouTube) werden bewusst NICHT gemessen (bräuchten externe APIs).

## ⚡ Performance (Core Web Vitals)

Schwellen orientiert an Google:
- **LCP**: ≤ 2,5 s gut · ≤ 4 s grenzwertig · > 4 s schlecht.
- **CLS**: ≤ 0,1 gut · ≤ 0,25 mittel · > 0,25 schlecht.
- **TTFB**: ≤ 0,8 s gut · ≤ 1,8 s träge · > 1,8 s schlecht.
- **Seitengewicht**: ≤ 2 MB gut · ≤ 5 MB mittel · > 5 MB schwer.
- **Requests** > 100 und **DOM** > 3000 Knoten werden bemängelt.

## 🧠 Psychologie / Conversion

Heuristiken nach Cialdini & Conversion-Best-Practices:
- **Call-to-Action** (handlungsorientierte Buttons).
- **Nutzenversprechen** (aussagekräftige H1 „above the fold").
- **Social Proof** (Testimonials, Bewertungen, Logos).
- **Vertrauenssignale** (Garantien, Siegel, Sicherheit).
- **Kontaktmöglichkeiten** (Telefon, E-Mail, Formular).
- **Reziprozität / Lead-Magnet** (kostenloser Einstieg).
- **Verknappung/Dringlichkeit** (informativ — maßvoll & ehrlich einsetzen).
