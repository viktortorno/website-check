// Performance-Modul: bewertet die im Browser gemessenen Roh-Metriken
// (Core Web Vitals + Seitengewicht). Ladezeit ist gleichzeitig SEO-
// Rankingfaktor, Conversion-Hebel und das, was Besucher unmittelbar spüren.
//
// Schwellenwerte orientieren sich an Google Core Web Vitals / Lighthouse.

import { Finding } from "../types";
import { PerfMetrics, BildMass } from "./browser";

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const fmtMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export function runPerformance(perf: PerfMetrics | null, bilder: BildMass[] = []): Finding[] {
  const findings: Finding[] = [];
  if (!perf) return findings;

  // ---------- 1. LCP – Largest Contentful Paint ----------
  if (perf.lcp > 0) {
    if (perf.lcp <= 2500) {
      findings.push({ id: "perf.lcp-good", category: "performance", title: `Schneller Seitenaufbau (LCP ${fmtMs(perf.lcp)})`, status: "pass", severity: "info", description: "Das größte Inhaltselement erscheint schnell — Google bewertet LCP ≤ 2,5 s als „gut”." });
    } else if (perf.lcp <= 4000) {
      findings.push({ id: "perf.lcp-medium", category: "performance", title: `Seitenaufbau verbesserungswürdig (LCP ${fmtMs(perf.lcp)})`, status: "warn", severity: "medium", description: "Das größte Inhaltselement erscheint erst nach 2,5–4 s. Im Grenzbereich von Googles Core Web Vitals.", recommendation: "Größtes Element (oft Hero-Bild) optimieren: moderne Formate (WebP/AVIF), Preload, weniger Render-blockierendes CSS/JS." });
    } else {
      findings.push({ id: "perf.lcp-bad", category: "performance", title: `Langsamer Seitenaufbau (LCP ${fmtMs(perf.lcp)})`, status: "fail", severity: "high", description: "Das größte Inhaltselement erscheint erst nach über 4 s. Das kostet Rankings und Besucher (jede Sekunde senkt die Conversion messbar).", recommendation: "Bilder komprimieren & lazy-loaden, Server-Antwortzeit senken, Render-blockierende Ressourcen entfernen, Caching/CDN nutzen." });
    }
  }

  // ---------- 2. CLS – Cumulative Layout Shift ----------
  if (perf.cls > 0) {
    if (perf.cls <= 0.1) {
      findings.push({ id: "perf.cls-good", category: "performance", title: `Stabiles Layout (CLS ${perf.cls})`, status: "pass", severity: "info", description: "Inhalte verspringen beim Laden kaum — Google bewertet CLS ≤ 0,1 als „gut”." });
    } else if (perf.cls <= 0.25) {
      findings.push({ id: "perf.cls-medium", category: "performance", title: `Layout verspringt etwas (CLS ${perf.cls})`, status: "warn", severity: "low", description: "Beim Laden verschieben sich Inhalte spürbar — störend, besonders mobil.", recommendation: "Feste Größen für Bilder/Embeds angeben, Web-Fonts mit font-display steuern, Platz für nachladende Elemente reservieren." });
    } else {
      findings.push({ id: "perf.cls-bad", category: "performance", title: `Layout springt stark (CLS ${perf.cls})`, status: "fail", severity: "medium", description: "Inhalte verspringen beim Laden erheblich — Nutzer klicken versehentlich falsch. Schadet UX und Ranking.", recommendation: "Allen Bildern/Videos width & height geben, Anzeigen-/Banner-Plätze reservieren, Layout-Sprünge durch Fonts vermeiden." });
    }
  }

  // ---------- 3. TTFB – Server-Antwortzeit ----------
  if (perf.ttfb > 0) {
    if (perf.ttfb <= 800) {
      findings.push({ id: "perf.ttfb-good", category: "performance", title: `Schnelle Serverantwort (TTFB ${fmtMs(perf.ttfb)})`, status: "pass", severity: "info", description: "Der Server liefert die erste Antwort zügig (≤ 0,8 s)." });
    } else if (perf.ttfb <= 1800) {
      findings.push({ id: "perf.ttfb-medium", category: "performance", title: `Träge Serverantwort (TTFB ${fmtMs(perf.ttfb)})`, status: "warn", severity: "low", description: "Der Server braucht relativ lange bis zur ersten Antwort.", recommendation: "Server-Caching, schnelleres Hosting oder ein CDN prüfen." });
    } else {
      findings.push({ id: "perf.ttfb-bad", category: "performance", title: `Sehr langsame Serverantwort (TTFB ${fmtMs(perf.ttfb)})`, status: "fail", severity: "medium", description: "Der Server braucht über 1,8 s bis zur ersten Antwort — das bremst alles Weitere aus.", recommendation: "Hosting/Backend optimieren, Caching aktivieren, CDN einsetzen." });
    }
  }

  // ---------- 4. Seitengewicht ----------
  if (perf.transferBytes > 0) {
    const mb = perf.transferBytes / 1_048_576;
    if (mb <= 2) {
      findings.push({ id: "perf.weight-good", category: "performance", title: `Schlanke Seite (${fmtMb(perf.transferBytes)})`, status: "pass", severity: "info", description: "Die übertragene Datenmenge ist gering — gut für mobile Verbindungen." });
    } else if (mb <= 5) {
      findings.push({ id: "perf.weight-medium", category: "performance", title: `Mittleres Seitengewicht (${fmtMb(perf.transferBytes)})`, status: "warn", severity: "low", description: "Die Seite überträgt relativ viele Daten — auf mobilen Verbindungen spürbar.", recommendation: "Bilder komprimieren, ungenutztes CSS/JS entfernen, moderne Bildformate nutzen." });
    } else {
      findings.push({ id: "perf.weight-bad", category: "performance", title: `Schwere Seite (${fmtMb(perf.transferBytes)})`, status: "fail", severity: "medium", description: "Die Seite überträgt sehr viele Daten. Das verlängert Ladezeiten massiv, besonders mobil.", recommendation: "Bilder drastisch optimieren (WebP/AVIF, responsive Größen), JS-Bundles aufteilen, Schriftarten reduzieren." });
    }
  }

  // ---------- 5. Anzahl Requests ----------
  if (perf.requestCount > 100) {
    findings.push({ id: "perf.requests-many", category: "performance", title: `Viele HTTP-Requests (${perf.requestCount})`, status: "warn", severity: "low", description: "Die Seite lädt sehr viele einzelne Dateien. Jeder Request kostet Zeit.", recommendation: "Dateien bündeln, Drittanbieter-Skripte reduzieren, Sprites/Icon-Fonts statt vieler Einzelbilder." });
  }

  // ---------- 6. DOM-Größe ----------
  if (perf.domNodes > 3000) {
    findings.push({ id: "perf.dom-large", category: "performance", title: `Sehr großes DOM (${perf.domNodes} Elemente)`, status: "warn", severity: "low", description: "Eine sehr hohe Anzahl an HTML-Elementen verlangsamt Rendering und erhöht den Speicherbedarf im Browser.", recommendation: "Seitenstruktur verschlanken, Inhalte ggf. paginieren oder nachladen (Lighthouse: < 1.500 Knoten ideal)." });
  }

  // ---------- 7. Bilder: geliefert gegen dargestellt ----------
  //
  // Der häufigste Ladezeit-Killer, den man im HTML NICHT sieht: ein 4000 px
  // breites Foto in einem 400 px breiten Container. Der Browser lädt die volle
  // Datei und rechnet sie dann klein — die Differenz ist reine Wartezeit für
  // den Besucher. Faktor 2 ist wegen hochauflösender Displays normal und
  // bleibt unbeanstandet; ab Faktor 3 ist es Verschwendung.
  const zuGross = bilder
    .filter((b) => b.natuerlicheBreite > b.angezeigteBreite * 3 && b.angezeigteBreite >= 40)
    .sort((a, b) => b.bytes - a.bytes);

  if (zuGross.length > 0) {
    const verschwendet = zuGross.reduce((sum, b) => {
      if (!b.bytes) return sum;
      // Datenmenge skaliert grob mit der Fläche, also quadratisch zur Breite.
      const noetig = b.bytes * Math.pow((b.angezeigteBreite * 2) / b.natuerlicheBreite, 2);
      return sum + Math.max(0, b.bytes - noetig);
    }, 0);
    const mb = verschwendet / 1_048_576;
    findings.push({
      id: "perf.oversized-images",
      category: "performance",
      title: `${zuGross.length} Bild(er) deutlich größer geladen als dargestellt${mb >= 0.1 ? ` (~${mb.toFixed(1)} MB unnötig)` : ""}`,
      status: mb >= 1 ? "fail" : "warn",
      severity: mb >= 1 ? "medium" : "low",
      description:
        "Diese Bilder werden in einer viel höheren Auflösung geladen, als sie auf der Seite dargestellt werden. Der Browser überträgt die volle Datei und rechnet sie anschließend klein — die Differenz ist reine Wartezeit, besonders auf dem Mobilfunknetz.",
      recommendation:
        "Bilder in der tatsächlich benötigten Größe ausliefern (doppelte Anzeigebreite genügt für hochauflösende Displays) und über srcset mehrere Größen anbieten.",
      evidence: zuGross.slice(0, 6).map((b) => {
        const name = b.url.split("/").pop()?.split("?")[0] || b.url;
        const kb = b.bytes ? `, ${Math.round(b.bytes / 1024)} kB` : "";
        return `${name}: ${b.natuerlicheBreite} px geliefert, ${b.angezeigteBreite} px dargestellt${kb}`;
      }),
    });
  } else if (bilder.length > 0) {
    findings.push({
      id: "perf.image-sizing-ok",
      category: "performance",
      title: "Bildgrößen passen zur Darstellung",
      status: "pass",
      severity: "info",
      description: `${bilder.length} Bild(er) geprüft — keines wird wesentlich größer geladen als es angezeigt wird.`,
    });
  }

  // Wenn keine echten CWV-Werte ermittelt werden konnten, transparent machen.
  if (findings.length === 0) {
    findings.push({ id: "perf.no-data", category: "performance", title: "Keine belastbaren Performance-Daten", status: "warn", severity: "low", description: "Es konnten keine aussagekräftigen Performance-Metriken erhoben werden (z. B. wegen Bot-Schutz oder sehr langsamer Antwort).", recommendation: "Performance gezielt mit Google PageSpeed Insights / Lighthouse nachmessen." });
  }

  return findings;
}
