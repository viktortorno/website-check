// Browser-Modul: lädt die Seite mit echtem Chromium und beobachtet,
// was OHNE Einwilligung passiert (Pre-Consent-Tracking = häufigster Verstoß).
//
// Wichtiger Trick: Wir klicken NICHT auf den Cookie-Banner. Alles, was an
// Trackern/Cookies trotzdem feuert, ist damit vor jeder Einwilligung passiert.
//
// Gibt zusätzlich das gerenderte HTML + finalUrl zurück, damit nachgelagerte
// Module (Impressum, BFSG, AI Act) den Browser nicht erneut starten müssen.

import { chromium, Browser } from "playwright";
import axeCore from "axe-core";
import { Finding } from "../types";
import { TRACKERS, CMP_SIGNATURES, matchesAny } from "../trackers";
import { assertPublicUrl, hostErlaubt } from "../ssrf";

// Roh-Performance-Metriken aus dem Browser (werden in performance.ts bewertet).
export interface PerfMetrics {
  ttfb: number;          // Time to First Byte (ms)
  domContentLoaded: number; // ms
  load: number;          // ms bis load-Event
  transferBytes: number; // Summe übertragener Bytes
  requestCount: number;  // Anzahl Requests
  lcp: number;           // Largest Contentful Paint (ms)
  cls: number;           // Cumulative Layout Shift (Score)
  domNodes: number;      // DOM-Knotenzahl
}

// Eine axe-core-Verletzung, reduziert auf das, was wir brauchen.
export interface AxeViolation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor" | null;
  help: string;
  description: string;
  helpUrl: string;
  nodes: number;
}

// Messwerte aus einer zweiten Betrachtung bei Telefonbreite (390 px).
// Bewusst gemessen statt aus dem HTML geraten: ob eine Seite seitlich
// überläuft, steht in keinem Tag — das ergibt sich erst aus dem Layout.
export interface MobilMetriken {
  viewportBreite: number;
  inhaltsBreite: number;      // scrollWidth des Dokuments
  // Der eigentliche Beweis: Lässt sich das Fenster tatsächlich seitlich
  // schieben? scrollWidth allein genügt nicht — Elemente in einem Container
  // mit overflow:hidden ragen zwar hinaus, scrollen aber nichts.
  scrolltSeitlich: boolean;
  scrollWeite: number;        // wie viele Pixel tatsächlich verschiebbar sind
  ueberlaeufer: string[];     // Elemente, die über den Rand hinausragen
  kleineZiele: number;        // interaktive Elemente unter 40 px Kantenlänge
  zieleGesamt: number;
}

// Ein eingebundenes Bild mit dem, was sich nur im Browser feststellen lässt:
// wie groß die Datei WIRKLICH ist und wie groß sie DARGESTELLT wird.
export interface BildMass {
  url: string;
  natuerlicheBreite: number;  // Pixelbreite der Datei
  angezeigteBreite: number;   // Pixelbreite im Layout
  bytes: number;              // übertragene Größe (0 = unbekannt/Cache)
}

export interface BrowserScanResult {
  findings: Finding[];
  html: string;
  finalUrl: string;
  title: string;
  mobil: MobilMetriken | null;
  bilder: BildMass[];
  // Roh-Daten, die nachgelagerte Module weiterverwenden:
  requestHosts: string[];
  requestUrls: string[];
  // Cookies, die OHNE jede Interaktion gesetzt wurden (Name/Domain/Laufzeit).
  cookies: { name: string; domain: string; expires: number }[];
  perf: PerfMetrics | null;
  axeViolations: AxeViolation[];
  axeRan: boolean; // false = axe konnte nicht laufen → Content-Heuristik als Fallback
}

// Start-Argumente für Chromium.
//
// Dieses Tool rendert fremde, potenziell feindliche Seiten. Die Chromium-Sandbox
// ist damit die wichtigste einzelne Schutzschicht: Ohne sie bedeutet ein
// Renderer-Exploit Codeausführung mit den Rechten des App-Prozesses.
//
// Chromium verweigert den Start als root, wenn die Sandbox aktiv ist — deshalb
// stand hier früher pauschal --no-sandbox. Die Kombination "als root UND ohne
// Sandbox" war der ungünstigste denkbare Fall. Jetzt läuft die App als eigener
// Systemnutzer (siehe ecosystem.config.js) und die Sandbox bleibt an; nur wenn
// jemand den Prozess doch wieder als root startet, fällt sie zurück — mit
// deutlicher Warnung im Log statt eines stillen Startfehlers.
function sandboxArgs(): string[] {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!isRoot) return [];
  console.warn(
    "WARNUNG: Prozess läuft als root — Chromium startet ohne Sandbox. " +
    "Die App sollte als eigener Systemnutzer laufen (pm2 start ecosystem.config.js)."
  );
  return ["--no-sandbox", "--disable-setuid-sandbox"];
}

// Obergrenze für das, was ein einzelner Scan insgesamt herunterlädt.
//
// Ohne sie bestimmt die fremde Seite, wie viel Bandbreite und Speicher dieser
// Server für sie aufwendet — ein 4-GB-Video in einem <video preload="auto">
// genügt. 80 MB liegen weit über jeder echten Website (der 95. Perzentil-Wert
// im HTTP Archive liegt bei rund 10 MB) und weit unter dem, was wehtut.
const MAX_SCAN_BYTES = 80_000_000;

// Chromium auf eine bereits geprüfte IP festnageln.
//
// Sonst bleibt ein Zeitfenster offen: Wir lösen den Namen mit Node auf und
// befinden ihn für gut, danach löst CHROMIUM denselben Namen ein zweites Mal
// selbst auf — und bekommt womöglich eine andere Antwort (DNS-Rebinding, TTL 0).
// Geprüft wurde dann eine Adresse, verbunden wird mit einer anderen.
//
// --host-resolver-rules=MAP <host> <ip> schließt das für den Haupt-Host: Der
// Hostname bleibt für SNI und Host-Header erhalten, nur die Auflösung ist fest.
//
// Bewusster Nebeneffekt: Zeigt die Domain per Round-Robin auf mehrere Adressen
// und ist ausgerechnet die erste gerade tot, scheitert der Scan, obwohl die
// Seite lebt. Das ist der bessere Fehler — er ist SICHTBAR. Der umgekehrte
// Fehler, eine interne Seite doch abzurufen, wäre unsichtbar.
function pinneHost(hostname: string, adressen: string[]): string[] {
  if (!adressen.length) return [];
  const ip = adressen.find((a) => !a.includes(":")) ?? adressen[0];
  const ziel = ip.includes(":") ? `[${ip}]` : ip;
  return [`--host-resolver-rules=MAP ${hostname} ${ziel}`];
}

export async function runBrowserScan(url: string): Promise<BrowserScanResult> {
  const findings: Finding[] = [];
  let browser: Browser | null = null;
  const requestUrls: string[] = [];

  try {
    // Vor dem Start auflösen — das Ergebnis wird gleich festgenagelt.
    const ziel = await assertPublicUrl(url);

    browser = await chromium.launch({
      headless: true,
      args: [...sandboxArgs(), ...pinneHost(ziel.hostname, ziel.adressen)],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      locale: "de-DE",
    });
    const page = await context.newPage();

    // Alle ausgehenden Requests mitschneiden.
    page.on("request", (req) => requestUrls.push(req.url()));

    // Heruntergeladene Menge mitzählen. sizes() steht erst nach Abschluss des
    // Requests bereit — das Budget bremst also den NÄCHSTEN Request, nicht den
    // laufenden. Für einen Bandbreiten-Deckel genügt das; gegen einen einzelnen
    // endlosen Response wirkt allein das Zeitlimit von page.goto.
    let geladeneBytes = 0;
    page.on("requestfinished", (req) => {
      req.sizes()
        .then((s) => { geladeneBytes += s.responseBodySize + s.responseHeadersSize; })
        .catch(() => { /* Request bereits verworfen */ });
    });

    // Netzgrenze für den Browser: JEDER Request wird geprüft, nicht nur
    // Navigationen.
    //
    // Vorher liefen Sub-Requests (Bilder, Skripte, XHR) ungeprüft durch, mit
    // der Begründung, sie lieferten der Auswertung nichts zurück. Das stimmt
    // für den Report — aber nicht für den Server: <img src="http://10.0.0.5/">
    // ist eine echte Verbindung ins interne Netz, und ob sie lädt oder nicht,
    // ist über die Ladezeit ablesbar. Ein Bild ist ein Portscan mit anderem
    // Tag-Namen. Die DNS-Kosten trägt jetzt ein Kurzzeit-Cache je Host
    // (hostErlaubt), nicht jeder einzelne Request.
    await page.route("**/*", async (route, req) => {
      if (geladeneBytes > MAX_SCAN_BYTES) return route.abort("blockedbyclient");
      if (await hostErlaubt(req.url())) return route.continue();
      await route.abort("blockedbyclient");
    });

    // Performance-Observer VOR dem Laden registrieren, damit LCP & CLS
    // (Core Web Vitals) vollständig erfasst werden.
    await page.addInitScript(() => {
      // @ts-expect-error – Browser-Kontext
      window.__lcp = 0; window.__cls = 0;
      try {
        new PerformanceObserver((l) => {
          // @ts-expect-error – Browser-Kontext
          for (const e of l.getEntries()) window.__lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch { /* nicht unterstützt */ }
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            // @ts-expect-error – layout-shift-spezifische Felder
            if (!e.hadRecentInput) window.__cls += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch { /* nicht unterstützt */ }
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // Tracker feuern oft verzögert (per JS) → kurz warten.
    await page.waitForTimeout(4000);

    // Zweite Verteidigungslinie: wo sind wir tatsächlich gelandet? Der Interceptor
    // oben blockt Navigationen, diese Prüfung fängt zusätzlich den Fall ab, dass
    // der Host zwischen Prüfung und Verbindung auf eine interne IP umgebogen wird
    // (DNS-Rebinding). Läuft VOR page.content(), damit interne Inhalte gar nicht
    // erst in den Report gelangen. Wirft → äußerer catch (Scan-Fehler-Finding).
    const finalUrl = page.url();
    await assertPublicUrl(finalUrl);

    const html = await page.content();
    const title = await page.title();

    // Cookies, die OHNE Interaktion gesetzt wurden.
    const cookies = await context.cookies();

    // --- Performance-Metriken (Core Web Vitals + Gewicht) auslesen ---
    let perf: PerfMetrics | null = null;
    try {
      perf = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        let transfer = nav?.transferSize || 0;
        for (const r of res) transfer += r.transferSize || 0;
        return {
          ttfb: Math.round(nav?.responseStart || 0),
          domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
          load: Math.round(nav?.loadEventEnd || 0),
          transferBytes: transfer,
          requestCount: 1 + res.length,
          // @ts-expect-error – vom Init-Script gesetzt
          lcp: Math.round(window.__lcp || 0),
          // @ts-expect-error – vom Init-Script gesetzt
          cls: Math.round((window.__cls || 0) * 1000) / 1000,
          domNodes: document.getElementsByTagName("*").length,
        };
      });
    } catch { /* Performance-Daten optional */ }

    // --- Barrierefreiheit: echte WCAG-Prüfung via axe-core ---
    // axe-Quelltext direkt in die Seite injizieren (bundle-sicher) und im
    // Seitenkontext laufen lassen. Liefert konkrete WCAG-Verstöße.
    let axeViolations: AxeViolation[] = [];
    let axeRan = false;
    try {
      // Über page.evaluate(source) statt addScriptTag — Letzteres wird von
      // strengen Content-Security-Policies (z. B. Wikipedia) blockiert.
      await page.evaluate(axeCore.source);
      const raw = await page.evaluate(async () => {
        // @ts-expect-error – axe wird per Script-Tag bereitgestellt
        const r = await window.axe.run(document, {
          resultTypes: ["violations"],
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        });
        return r.violations.map((v: { id: string; impact: string | null; help: string; description: string; helpUrl: string; nodes: unknown[] }) => ({
          id: v.id, impact: v.impact, help: v.help, description: v.description, helpUrl: v.helpUrl, nodes: v.nodes.length,
        }));
      });
      axeViolations = raw as AxeViolation[];
      axeRan = true;
    } catch { /* axe optional → Content-Heuristik springt ein */ }

    // --- 1. Pre-Consent-Tracker erkennen ---
    const hits = new Map<string, { name: string; note: string; us: boolean; kategorie: string; cookielos: boolean; urls: Set<string> }>();
    for (const reqUrl of requestUrls) {
      for (const t of TRACKERS) {
        if (matchesAny(reqUrl, t.patterns)) {
          if (!hits.has(t.id))
            hits.set(t.id, { name: t.name, note: t.note, us: t.usTransfer, kategorie: t.category, cookielos: t.cookielos === true, urls: new Set() });
          hits.get(t.id)!.urls.add(new URL(reqUrl).host);
        }
      }
    }

    // Google Fonts separat hervorheben (sehr häufiges Abmahn-Thema).
    const fontHit = hits.get("google-fonts");
    if (fontHit) {
      findings.push({
        id: "dsgvo.google-fonts",
        category: "dsgvo",
        title: "Google Fonts vom Google-Server geladen",
        status: "fail",
        severity: "high",
        description:
          "Schriftarten werden dynamisch von fonts.googleapis.com / fonts.gstatic.com geladen. Dabei wird die IP-Adresse der Besucher an Google (USA) übertragen.",
        recommendation: "Google Fonts lokal hosten (self-hosted) — dann fließen keine Daten an Google.",
        legalRef: "LG München I, Urteil v. 20.01.2022, Az. 3 O 17493/20",
        evidence: [...fontHit.urls],
      });
      hits.delete("google-fonts");
    }

    // Übrige Tracker zu einem Finding zusammenfassen.
    // Nach rechtlicher Wirkung trennen, nicht alles in einen Topf.
    //
    // Vorher fasste EIN critical-Befund jeden Katalogtreffer zusammen — Google
    // Ads stand dort neben jsDelivr, mit dem Satz "nach DSGVO/TDDDG unzulässig".
    // Das ist in beide Richtungen falsch: Es dramatisiert ein CDN und verwässert
    // ein Werbepixel. Maßgeblich ist, ob der Dienst auf das ENDGERÄT zugreift
    // (§ 25 TDDDG) oder nur eine Verbindung zu einem Dritten aufbaut (Art. 6).
    const einwilligungspflichtigeHits = [...hits.values()].filter(
      (h) => (h.kategorie === "ads" || h.kategorie === "tagmanager" || h.kategorie === "analytics") && !h.cookielos
    );
    const cookielose = [...hits.values()].filter((h) => h.cookielos);

    if (einwilligungspflichtigeHits.length > 0) {
      const hasUs = einwilligungspflichtigeHits.some((h) => h.us);
      findings.push({
        id: "dsgvo.pre-consent-tracking",
        category: "dsgvo",
        title: `${einwilligungspflichtigeHits.length} Tracking-Dienst(e) starten VOR der Einwilligung`,
        status: "fail",
        severity: "critical",
        description:
          "Diese Dienste speichern Informationen auf dem Endgerät oder lesen sie aus (Cookies, Kennungen), bevor jemand zugestimmt hat. Dafür ist die Einwilligung vorher einzuholen." +
          (hasUs ? " Mindestens einer überträgt Daten in die USA." : ""),
        recommendation:
          "Diese Skripte erst nach aktiver Einwilligung ausführen — Blockade vorschalten, nicht nur einen Hinweis anzeigen.",
        legalRef: "§ 25 Abs. 1 TDDDG, Art. 6 Abs. 1 DSGVO",
        evidence: einwilligungspflichtigeHits.map((h) => `${h.name} (${[...h.urls].join(", ")})`),
      });
    }

    if (cookielose.length > 0) {
      findings.push({
        id: "dsgvo.cookieless-analytics",
        category: "dsgvo",
        title: `Cookieloses Analytics im Einsatz (${cookielose.map((h) => h.name).join(", ")})`,
        status: "warn",
        severity: "low",
        description:
          "Dieses Werkzeug arbeitet ohne Cookies und ohne Zugriff auf das Endgerät. § 25 TDDDG greift dann nicht; die Verarbeitung der IP-Adresse bleibt aber eine Verarbeitung nach Art. 6 DSGVO und gehört in die Datenschutzerklärung.",
        recommendation: "In der Datenschutzerklärung benennen (Zweck, Rechtsgrundlage, Speicherdauer). Eine Einwilligung ist dafür nach überwiegender Auffassung nicht erforderlich.",
        legalRef: "Art. 6 Abs. 1 lit. f DSGVO",
        evidence: cookielose.map((h) => `${h.name} (${[...h.urls].join(", ")})`),
      });
    }

    if (einwilligungspflichtigeHits.length === 0) {
      findings.push({
        id: "dsgvo.no-pre-consent-tracking",
        category: "dsgvo",
        title: "Keine einwilligungspflichtigen Tracker vor der Zustimmung",
        status: "pass",
        severity: "info",
        description: "Beim Laden wurde kein Dienst aktiv, der ohne Einwilligung auf das Endgerät zugreift.",
      });
    }

    // --- 2. Cookies ohne Einwilligung ---
    const nonEssential = cookies.filter(
      (c) => !/^(PHPSESSID|XSRF|csrf|wordpress_|wp-|session|cookieconsent)/i.test(c.name)
    );
    if (nonEssential.length > 0) {
      findings.push({
        id: "dsgvo.cookies-without-consent",
        category: "dsgvo",
        title: `${nonEssential.length} Cookie(s) ohne Einwilligung gesetzt`,
        status: "fail",
        severity: "high",
        description:
          "Es wurden Cookies gesetzt, bevor eine Einwilligung erteilt wurde. Nur technisch notwendige Cookies dürfen ohne Zustimmung gesetzt werden.",
        recommendation: "Nicht-essenzielle Cookies erst nach Opt-in setzen.",
        legalRef: "§ 25 TDDDG",
        evidence: nonEssential.slice(0, 15).map((c) => `${c.name} (${c.domain})`),
      });
    }

    // --- 2b. Mixed Content (HTTPS-Seite lädt unverschlüsselte Ressourcen) ---
    if (finalUrl.startsWith("https://")) {
      const httpAssets = [...new Set(
        requestUrls.filter((u) => /^http:\/\//i.test(u) && !/^http:\/\/(localhost|127\.)/i.test(u))
      )];
      if (httpAssets.length > 0) {
        findings.push({
          id: "security.mixed-content",
          category: "security",
          title: `${httpAssets.length} unverschlüsselte Ressource(n) auf HTTPS-Seite`,
          status: "fail",
          severity: "medium",
          description:
            "Die Seite läuft über HTTPS, lädt aber Inhalte über unverschlüsseltes HTTP (Mixed Content). Browser blockieren solche Inhalte oder warnen — das Schloss-Symbol kann verschwinden.",
          recommendation: "Alle Ressourcen (Bilder, Skripte, Fonts) über https:// einbinden.",
          evidence: httpAssets.slice(0, 10),
        });
      }
    }

    // --- 2c. Cookie-Sicherheits-Flags ---
    const insecureCookies = cookies.filter((c) => !c.secure || !c.httpOnly);
    if (cookies.length > 0 && insecureCookies.length > 0) {
      findings.push({
        id: "security.cookie-flags",
        category: "security",
        title: `${insecureCookies.length} Cookie(s) ohne sichere Flags`,
        status: "warn",
        severity: "low",
        description:
          "Es wurden Cookies ohne 'Secure'- und/oder 'HttpOnly'-Flag gefunden. Ohne diese Flags können Cookies über unverschlüsselte Verbindungen oder per JavaScript (XSS) abgegriffen werden.",
        recommendation: "Cookies mit 'Secure', 'HttpOnly' und einem passenden 'SameSite'-Attribut setzen.",
        evidence: insecureCookies.slice(0, 10).map((c) => `${c.name} (${[!c.secure && "kein Secure", !c.httpOnly && "kein HttpOnly"].filter(Boolean).join(", ")})`),
      });
    }

    // --- 3. Consent-Banner / CMP: im echten DOM statt per Wortsuche ---
    //
    // Vorher stand hier eine reine Textsuche über das rohe HTML: ein Wort aus
    // {cookie, consent, datenschutz, …} irgendwo, ein Wort aus {akzeptier,
    // accept, …} irgendwo sonst — fertig war "Banner vermutlich vorhanden".
    // Beide Wörter stehen auf praktisch jeder deutschen Seite, ohne dass es
    // einen Banner gäbe: "Datenschutz" im Fußzeilenlink und "accept" als
    // Teilstring in `acceptedAnswer` (FAQ-JSON-LD), `accept-charset` (jedes
    // WordPress-Suchformular) oder `Accept-Encoding` in irgendeinem Skript.
    // Der Befund kam deshalb fast immer — und sagte nichts aus.
    //
    // Jetzt drei belastbare Signale statt zweier zusammenhangloser Wörter:
    //   a) CMP-Signatur in den geladenen URLs (unverändert),
    //   b) globale CMP-API im Seitenkontext (window.__tcfapi, Cookiebot, …) —
    //      das ist ein Beweis, kein Indiz,
    //   c) ein SICHTBARES Element, das Cookie-Text und einen anklickbaren Knopf
    //      mit Akzeptier-Beschriftung zusammen enthält.
    const allText = (html + " " + requestUrls.join(" ")).toLowerCase();
    const cmp = CMP_SIGNATURES.find((c) => matchesAny(allText, c.patterns));

    // Diese Funktion läuft IM BROWSER, und zwar in jedem Frame einzeln (siehe
    // unten) — Sourcepoint, Didomi & Co. rendern ihr Banner in einem fremden
    // iframe (cmp.heise.de, privacy-mgmt.com). Wer nur das Hauptdokument
    // durchsucht, sieht davon nichts.
    const erkenneConsent = () => {
      // Muss die ERSTE Anweisung bleiben: esbuild (tsx, Tests) schreibt benannte
      // Funktionen zu `__name(fn, "name")` um. Dieser Helfer existiert nur im
      // Node-Bundle — im Seitenkontext stirbt die Auswertung sonst sofort mit
      // "ReferenceError: __name is not defined", und zwar für jeden Frame.
      const g = globalThis as unknown as Record<string, unknown>;
      if (typeof g.__name !== "function") g.__name = (f: unknown) => f;

      // Beschriftungen, mit denen eingewilligt wird. Bewusst eng: die Prüfung
      // läuft nur gegen den TEXT EINES KNOPFES, nicht gegen die ganze Seite.
      const AKZEPT = /^(alle\s+)?(cookies?\s+)?(akzeptier|zustimm|einverstanden|annehmen|erlauben|zulassen|auswahl bestätigen|accept|agree|allow|got it)|^(ok|verstanden|alles klar)\b/i;
      // Worum es im umgebenden Kasten gehen muss. "datenschutz" allein reicht
      // NICHT — genau das steht in jeder Fußzeile.
      const THEMA = /\bcookies?\b|einwillig|zustimmung|consent|datenschutz-?einstellung|privatsphäre-?einstellung|\btracking\b/i;

      const w = window as unknown as Record<string, unknown>;
      const apis: string[] = [];
      // IAB-TCF-Schnittstelle — der De-facto-Standard, den jedes größere
      // Consent-Tool bereitstellt, egal welcher Anbieter dahintersteht.
      if (typeof w.__tcfapi === "function") apis.push("IAB TCF v2");
      else if (typeof w.__cmp === "function") apis.push("IAB TCF v1");
      if (w.Cookiebot || w.CookieConsent) apis.push("Cookiebot/CookieConsent");
      if (w.UC_UI || w.usercentrics || w.__ucCmp) apis.push("Usercentrics");
      if (w.borlabsCookie || w.BorlabsCookie) apis.push("Borlabs Cookie");
      if (w.OneTrust || w.Optanon || typeof w.OptanonWrapper === "function") apis.push("OneTrust");
      if (w.cookieyes || w.CookieYes || w.CookieScript) apis.push("CookieYes/CookieScript");
      if (w.klaro || w.klaroConfig) apis.push("Klaro");
      if (w.cmplz_cookie_data || w.complianz) apis.push("Complianz");
      if (w.cookieconsent || w.CookieInformation) apis.push("Cookie Information");

      const sichtbar = (n: Element): boolean => {
        const r = n.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) return false;
        const s = getComputedStyle(n);
        return s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity || "1") > 0.05;
      };
      // Liegt der Kasten ÜBER dem Inhalt? Kein Ausschlusskriterium, aber ein
      // starkes Zusatzindiz — und für den Bericht die anschaulichste Evidenz.
      const ueberlagert = (n: Element): boolean => {
        let x: Element | null = n;
        for (let t = 0; x && t < 6; t++, x = x.parentElement) {
          const s = getComputedStyle(x);
          if (s.position === "fixed" || s.position === "sticky") return true;
          if (x.getAttribute("role") === "dialog" || x.hasAttribute("aria-modal")) return true;
          if (parseInt(s.zIndex || "0", 10) >= 100) return true;
        }
        return false;
      };

      const klickbar = document.querySelectorAll<HTMLElement>(
        'button, a, [role="button"], input[type="button"], input[type="submit"]'
      );
      for (const el of klickbar) {
        const label = (
          el.innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || ""
        ).trim().replace(/\s+/g, " ");
        if (!label || label.length > 40 || !AKZEPT.test(label)) continue;
        if (!sichtbar(el)) continue;

        // Vom Knopf nach oben laufen, bis ein Vorfahr wirklich vom Thema
        // handelt. Genau dieser Zusammenhang fehlte der alten Prüfung.
        let node: Element | null = el.parentElement;
        for (let tiefe = 0; node && tiefe < 8; tiefe++, node = node.parentElement) {
          const txt = ((node as HTMLElement).innerText || "").slice(0, 3000);
          if (!THEMA.test(txt)) continue;
          if (!sichtbar(node)) break;
          return {
            apis,
            knopf: label,
            overlay: ueberlagert(node),
            auszug: txt.replace(/\s+/g, " ").trim().slice(0, 160),
          };
        }
      }
      return { apis, knopf: null as string | null, overlay: false, auszug: "" };
    };

    const consentTreffer = await Promise.all(
      page.frames().map((frame) =>
        frame.evaluate(erkenneConsent).catch((err: Error) => {
          // Frames verschwinden mitten im Scan (Werbe-iframes) — das ist normal
          // und keine Meldung wert. Alles andere schon: ein stiller catch an
          // dieser Stelle hat die Erkennung bereits einmal unbemerkt ausgehebelt.
          if (!/detached|destroyed|Execution context|navigation/i.test(err.message)) {
            console.warn(`Consent-Erkennung in ${frame.url().slice(0, 80)} fehlgeschlagen: ${err.message}`);
          }
          return null;
        })
      )
    );
    const bannerTreffer = consentTreffer.find((t) => t?.knopf) ?? null;
    const consentDom = {
      apis: [...new Set(consentTreffer.flatMap((t) => t?.apis ?? []))],
      knopf: bannerTreffer?.knopf ?? null,
      overlay: bannerTreffer?.overlay ?? false,
      auszug: bannerTreffer?.auszug ?? "",
    };

    const cmpName = cmp?.name || consentDom.apis[0] || null;

    // Kopplung an die Realität: Ein Einwilligungs-Banner ist kein Selbstzweck.
    // § 25 TDDDG verlangt die Einwilligung für nicht-notwendige Speicherung und
    // Zugriff — wer weder Tracker lädt noch nicht-essenzielle Cookies setzt,
    // braucht keinen Banner und darf dafür auch nicht abgewertet werden.
    const einwilligungspflichtig = hits.size > 0 || nonEssential.length > 0;

    const bannerEvidenz = consentDom.knopf
      ? [
          `Knopf: „${consentDom.knopf}"`,
          consentDom.overlay ? "liegt als Overlay über dem Inhalt" : "im Seitenfluss, kein Overlay",
          consentDom.auszug && `Text: „${consentDom.auszug}…"`,
        ].filter(Boolean) as string[]
      : undefined;

    const consentEvidenz = [
      ...(consentDom.apis.length ? [`Aktive Schnittstelle im Browser: ${consentDom.apis.join(", ")}`] : []),
      ...(bannerEvidenz ?? []),
    ];

    if ((cmpName || consentDom.knopf) && einwilligungspflichtig) {
      // Die Einwilligung wird eingeholt, greift aber zu spät: es lief schon
      // etwas, bevor jemand zustimmen konnte. Bewusst nur "low" — der
      // eigentliche Verstoß wird als eigenes Finding (Tracker/Cookies) voll
      // bestraft; hier steht nur, dass das vorhandene Tool ihn nicht verhindert.
      findings.push({
        id: "dsgvo.banner-ineffective",
        category: "dsgvo",
        title: cmpName
          ? `Consent-Tool erkannt (${cmpName}), es greift aber zu spät`
          : "Cookie-Banner vorhanden, wirkt aber nicht",
        status: "warn",
        severity: "low",
        description:
          "Eine Einwilligung wird eingeholt, trotzdem wurden schon vor jeder Zustimmung Tracker geladen oder nicht-essenzielle Cookies gesetzt. Abgefragt wird damit, was ohnehin bereits passiert ist.",
        recommendation:
          "Skripte und Cookies erst nach aktiver Einwilligung ausführen (Blockade vorschalten, nicht nur den Hinweis anzeigen).",
        legalRef: "§ 25 TDDDG, Art. 6 Abs. 1 DSGVO",
        evidence: consentEvidenz.length ? consentEvidenz : undefined,
      });
    } else if (cmpName) {
      findings.push({
        id: "dsgvo.cmp-present",
        category: "dsgvo",
        title: `Consent-Tool erkannt: ${cmpName}`,
        status: "pass",
        severity: "info",
        description:
          "Ein Consent-Management-Tool ist im Einsatz, und vor der Zustimmung wurden weder Tracker geladen noch nicht-essenzielle Cookies gesetzt.",
        evidence: consentEvidenz.length ? consentEvidenz : undefined,
      });
    } else if (consentDom.knopf) {
      findings.push({
        id: "dsgvo.banner-present",
        category: "dsgvo",
        title: "Cookie-Banner vorhanden",
        status: "pass",
        severity: "info",
        description:
          "Ein sichtbares Einwilligungs-Banner wurde gefunden, und vor der Zustimmung wurden weder Tracker geladen noch nicht-essenzielle Cookies gesetzt.",
        evidence: bannerEvidenz,
      });
    } else if (einwilligungspflichtig) {
      findings.push({
        id: "dsgvo.no-banner",
        category: "dsgvo",
        title: "Kein Cookie-Banner, obwohl einwilligungspflichtige Dienste laden",
        status: "fail",
        severity: "high",
        description:
          "Es wurde kein Einwilligungs-Banner gefunden, gleichzeitig laufen Tracker oder es werden nicht-essenzielle Cookies gesetzt. Für beides ist eine vorherige Einwilligung erforderlich.",
        recommendation: "Consent-Banner mit echtem Opt-in einbinden und alle nicht notwendigen Dienste bis zur Zustimmung blockieren.",
        legalRef: "§ 25 Abs. 1 TDDDG",
      });
    } else {
      findings.push({
        id: "dsgvo.no-banner-needed",
        category: "dsgvo",
        title: "Kein Einwilligungs-Banner nötig",
        status: "pass",
        severity: "info",
        description:
          "Die Seite lädt keine Tracker und setzt keine nicht-essenziellen Cookies. Ohne einwilligungspflichtige Verarbeitung ist ein Cookie-Banner nicht erforderlich — § 25 TDDDG greift dann nicht.",
      });
    }

    // --- Bilder: Dateigröße gegen Anzeigegröße ---
    //
    // Der häufigste unsichtbare Ladezeit-Killer: ein 4000-px-Foto in einem
    // 400-px-Container. Im HTML ist das nicht erkennbar — erst der Browser
    // kennt `naturalWidth` (die Datei) und `clientWidth` (die Darstellung).
    // Läuft VOR der Umstellung auf Telefonbreite, weil sonst die
    // Anzeigegrößen des mobilen Layouts gemessen würden.
    let bilder: BildMass[] = [];
    try {
      bilder = await page.evaluate(() => {
        const g = globalThis as unknown as Record<string, unknown>;
        if (typeof g.__name !== "function") g.__name = (f: unknown) => f;

        // Übertragene Größen aus dem Resource-Timing, damit die Aussage nicht
        // nur "zu groß in Pixeln", sondern "so viele Bytes" lautet.
        const groessen = new Map<string, number>();
        for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
          if (e.initiatorType === "img" || /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(e.name)) {
            groessen.set(e.name, e.encodedBodySize || e.transferSize || 0);
          }
        }

        const out: { url: string; natuerlicheBreite: number; angezeigteBreite: number; bytes: number }[] = [];
        for (const img of document.querySelectorAll("img")) {
          const url = img.currentSrc || img.src;
          if (!url || url.startsWith("data:")) continue;
          const angezeigt = Math.round(img.getBoundingClientRect().width);
          if (angezeigt < 10 || !img.naturalWidth) continue; // unsichtbar oder nicht geladen
          out.push({
            url,
            natuerlicheBreite: img.naturalWidth,
            angezeigteBreite: angezeigt,
            bytes: groessen.get(url) || 0,
          });
        }
        return out.slice(0, 40);
      });
    } catch (err) {
      console.warn(`Bild-Messung fehlgeschlagen: ${(err as Error).message}`);
    }

    // --- Mobile Darstellung bei 390 px messen ---
    //
    // Läuft ganz am Ende, weil die Viewport-Änderung das Layout umbaut: html,
    // axe-Ergebnisse und Consent-Prüfung sind zu diesem Zeitpunkt schon
    // erhoben. Google indexiert primär die mobile Fassung — ob eine Seite dort
    // seitlich überläuft, steht in keinem Meta-Tag.
    let mobil: MobilMetriken | null = null;
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      mobil = await page.evaluate(() => {
        const g = globalThis as unknown as Record<string, unknown>;
        if (typeof g.__name !== "function") g.__name = (f: unknown) => f;

        const breite = window.innerWidth;
        const doc = document.documentElement;

        // Erst messen, dann zurückstellen: der Versuch, ganz nach rechts zu
        // scrollen, beantwortet die Frage eindeutig.
        const vorher = window.scrollX;
        window.scrollTo(99_999, window.scrollY);
        const scrollWeite = Math.round(window.scrollX);
        window.scrollTo(vorher, window.scrollY);
        const ueberlaeufer: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          const r = el.getBoundingClientRect();
          // Nur echte Überläufe: mehr als 4 px über den rechten Rand hinaus,
          // und das Element muss selbst sichtbar sein.
          if (r.width > 0 && r.right > breite + 4 && getComputedStyle(el).visibility !== "hidden") {
            const name = el.tagName.toLowerCase()
              + (el.id ? `#${el.id}` : "")
              + (typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : "");
            if (!ueberlaeufer.includes(name)) ueberlaeufer.push(name);
            if (ueberlaeufer.length >= 5) break;
          }
        }

        const ziele = document.querySelectorAll<HTMLElement>(
          'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]'
        );
        let klein = 0, gesamt = 0;
        for (const z of ziele) {
          const r = z.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue; // unsichtbar → zählt nicht
          gesamt++;
          if (r.width < 40 || r.height < 40) klein++;
        }

        return {
          viewportBreite: breite,
          inhaltsBreite: doc.scrollWidth,
          scrolltSeitlich: scrollWeite > 4,
          scrollWeite,
          ueberlaeufer,
          kleineZiele: klein,
          zieleGesamt: gesamt,
        };
      });
    } catch (err) {
      console.warn(`Mobil-Messung fehlgeschlagen: ${(err as Error).message}`);
    }

    // HTTP-Status der Hauptseite
    if (response && response.status() >= 400) {
      findings.push({
        id: "dsgvo.page-error",
        category: "dsgvo",
        title: `Seite antwortet mit HTTP ${response.status()}`,
        status: "warn",
        severity: "low",
        description: "Die Zielseite lieferte einen Fehlerstatus — Analyse ggf. unvollständig.",
      });
    }

    return {
      findings,
      html,
      finalUrl,
      title,
      mobil,
      bilder,
      requestHosts: [...new Set(requestUrls.map((u) => { try { return new URL(u).host; } catch { return ""; } }).filter(Boolean))],
      requestUrls: [...new Set(requestUrls)],
      cookies: cookies.map((c) => ({ name: c.name, domain: c.domain, expires: c.expires })),
      perf,
      axeViolations,
      axeRan,
    };
  } catch (err) {
    // Der volle Fehlertext gehört ins Log, nicht in den Report: Playwright
    // liefert dort absolute Pfade des Servers mit ("/root/.cache/ms-playwright/…").
    // Nach außen nur die Art des Fehlers.
    const roh = (err as Error).message;
    console.error(`Browser-Scan fehlgeschlagen für ${url}: ${roh}`);
    const grund = /timeout|Timeout/.test(roh)
      ? "Die Seite hat nicht rechtzeitig geantwortet."
      : /net::ERR_|ENOTFOUND|ECONNREFUSED|certificate|SSL/.test(roh)
      ? "Die Seite war nicht erreichbar oder hat die Verbindung abgelehnt."
      : "Der Browser konnte die Seite nicht laden.";
    findings.push({
      id: "scan.browser-failed",
      category: "dsgvo",
      title: "Browser-Prüfung nicht möglich",
      status: "fail",
      severity: "info",
      description: `${grund} Alle Prüfungen, die die gerenderte Seite brauchen, konnten deshalb NICHT ausgeführt werden — die betroffenen Bereiche sind im Bericht als „nicht geprüft" ausgewiesen und bekommen keine Note.`,
      recommendation: "Erreichbarkeit prüfen und den Scan wiederholen. Bleibt es dabei, blockiert die Seite womöglich automatisierte Zugriffe.",
    });
    return { findings, html: "", finalUrl: url, title: "", mobil: null, bilder: [], requestHosts: [], requestUrls: [], cookies: [], perf: null, axeViolations: [], axeRan: false };
  } finally {
    // Chromium IMMER schließen — auch bei Timeout/Abbruch, sonst verwaisen Prozesse.
    if (browser) await browser.close().catch(() => {});
  }
}
