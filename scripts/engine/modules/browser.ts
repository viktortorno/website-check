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

export interface BrowserScanResult {
  findings: Finding[];
  html: string;
  finalUrl: string;
  title: string;
  // Roh-Daten, die nachgelagerte Module weiterverwenden:
  requestHosts: string[];
  perf: PerfMetrics | null;
  axeViolations: AxeViolation[];
  axeRan: boolean; // false = axe konnte nicht laufen → Content-Heuristik als Fallback
}

export async function runBrowserScan(url: string): Promise<BrowserScanResult> {
  const findings: Finding[] = [];
  let browser: Browser | null = null;
  const requestUrls: string[] = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      locale: "de-DE",
    });
    const page = await context.newPage();

    // Alle ausgehenden Requests mitschneiden.
    page.on("request", (req) => requestUrls.push(req.url()));

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

    const finalUrl = page.url();
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
    const hits = new Map<string, { name: string; note: string; us: boolean; urls: Set<string> }>();
    for (const reqUrl of requestUrls) {
      for (const t of TRACKERS) {
        if (matchesAny(reqUrl, t.patterns)) {
          if (!hits.has(t.id))
            hits.set(t.id, { name: t.name, note: t.note, us: t.usTransfer, urls: new Set() });
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
    if (hits.size > 0) {
      const evidence: string[] = [];
      let hasUs = false;
      for (const [, h] of hits) {
        evidence.push(`${h.name} (${[...h.urls].join(", ")})`);
        if (h.us) hasUs = true;
      }
      findings.push({
        id: "dsgvo.pre-consent-tracking",
        category: "dsgvo",
        title: `${hits.size} Tracker feuern VOR der Einwilligung`,
        status: "fail",
        severity: "critical",
        description:
          "Diese Dienste werden geladen, bevor der Nutzer im Cookie-Banner zugestimmt hat. Das ist nach DSGVO/TDDDG unzulässig — Einwilligung muss vorher erfolgen." +
          (hasUs ? " Mindestens ein Dienst überträgt Daten in die USA." : ""),
        recommendation:
          "Tracker erst NACH aktiver Einwilligung laden (z.B. über ein korrekt konfiguriertes Consent-Management-Tool).",
        legalRef: "Art. 6 Abs. 1 DSGVO, § 25 TDDDG (ehem. TTDSG)",
        evidence,
      });
    } else {
      findings.push({
        id: "dsgvo.no-pre-consent-tracking",
        category: "dsgvo",
        title: "Keine Tracker vor Einwilligung erkannt",
        status: "pass",
        severity: "info",
        description: "Beim Laden wurden keine bekannten Tracking-Dienste ohne Zustimmung aktiv.",
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

    // --- 3. Consent-Banner / CMP vorhanden? ---
    const allText = (html + " " + requestUrls.join(" ")).toLowerCase();
    const cmp = CMP_SIGNATURES.find((c) => matchesAny(allText, c.patterns));
    const looksLikeBanner =
      /cookie|consent|datenschutz|zustimm|einwillig/i.test(html) &&
      /(akzeptier|zustimm|accept|einverstanden|alle erlauben)/i.test(html);

    if (cmp) {
      findings.push({
        id: "dsgvo.cmp-present",
        category: "dsgvo",
        title: `Consent-Tool erkannt: ${cmp.name}`,
        status: "pass",
        severity: "info",
        description: "Ein Consent-Management-Tool ist im Einsatz (korrekte Konfiguration vorausgesetzt).",
      });
    } else if (looksLikeBanner) {
      findings.push({
        id: "dsgvo.banner-heuristic",
        category: "dsgvo",
        title: "Cookie-Banner vermutlich vorhanden",
        status: "warn",
        severity: "low",
        description: "Es deutet ein Cookie-Hinweis hin, aber kein bekanntes Consent-Tool wurde erkannt.",
        recommendation: "Sicherstellen, dass der Banner Opt-in erzwingt und 'Ablehnen' gleichwertig anbietet.",
      });
    } else {
      findings.push({
        id: "dsgvo.no-banner",
        category: "dsgvo",
        title: "Kein Cookie-Banner erkannt",
        status: "warn",
        severity: "medium",
        description: "Es wurde kein Einwilligungs-Banner gefunden. Bei Einsatz von Tracking ist das ein Problem.",
        recommendation: "DSGVO-konformes Consent-Banner mit Opt-in einbinden.",
      });
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
      requestHosts: [...new Set(requestUrls.map((u) => { try { return new URL(u).host; } catch { return ""; } }).filter(Boolean))],
      perf,
      axeViolations,
      axeRan,
    };
  } catch (err) {
    findings.push({
      id: "dsgvo.scan-error",
      category: "dsgvo",
      title: "Browser-Scan fehlgeschlagen",
      status: "warn",
      severity: "info",
      description: `Die Seite konnte nicht vollständig im Browser geladen werden: ${(err as Error).message}`,
    });
    return { findings, html: "", finalUrl: url, title: "", requestHosts: [], perf: null, axeViolations: [], axeRan: false };
  } finally {
    // Chromium IMMER schließen — auch bei Timeout/Abbruch, sonst verwaisen Prozesse.
    if (browser) await browser.close().catch(() => {});
  }
}
