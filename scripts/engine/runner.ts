// Runner: orchestriert alle Module und baut den finalen Report.
// Browser-, Security- und DNS-Scan laufen parallel (unabhängig),
// das Content-Modul nutzt anschließend das HTML aus dem Browser-Scan.

import { ScanReport } from "./types";
import { runSecurity } from "./modules/security";
import { runDns } from "./modules/dns";
import { runBrowserScan } from "./modules/browser";
import { runContent } from "./modules/content";
import { runSeo } from "./modules/seo";
import { runGeo } from "./modules/geo";
import { runPsychology } from "./modules/psychology";
import { runPerformance } from "./modules/performance";
import { runAccessibility } from "./modules/accessibility";
import { runDomain } from "./modules/domain";
import { runTechStack } from "./modules/techstack";
import { buildScores } from "./scoring";
import { assertPublicHost } from "./ssrf";

// Kurz-Cache: dieselbe URL wird nicht innerhalb 1 h erneut (teuer) gescannt.
const CACHE_TTL_MS = 60 * 60_000;
const cache = new Map<string, { report: ScanReport; at: number }>();

// Interne/private Ziele, die nicht gescannt werden dürfen (SSRF-Schutz):
// verhindert, dass das öffentliche Tool als Proxy ins interne Netz missbraucht wird.
const BLOCKED_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/i;

// URL normalisieren: Schema ergänzen, validieren, interne Ziele blocken.
export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u); // wirft bei Unfug
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http/https-URLs sind erlaubt.");
  }
  if (BLOCKED_HOST.test(parsed.hostname)) {
    throw new Error("Interne/lokale Adressen können nicht gescannt werden.");
  }
  return parsed.toString();
}

export async function runScan(rawUrl: string): Promise<ScanReport> {
  const started = Date.now();
  const url = normalizeUrl(rawUrl);
  const hostname = new URL(url).hostname;

  // Cache-Treffer? Dann sofort zurück (spart einen kompletten Browser-Scan).
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.report, cached: true };
  }

  // SSRF-Härtung: echte IP prüfen, bevor wir die Seite abrufen.
  await assertPublicHost(hostname);

  // Parallel: das Langsamste (Browser) bestimmt die Wartezeit.
  const [browserResult, securityFindings, dnsFindings, domainFindings] = await Promise.all([
    runBrowserScan(url),
    runSecurity(url),
    runDns(hostname),
    runDomain(hostname),
  ]);

  // Module, die auf dem bereits geladenen HTML arbeiten.
  // GEO ruft zusätzlich robots.txt / llms.txt / sitemap.xml ab (async) und
  // läuft daher parallel zu den synchronen HTML-Auswertungen.
  const contentFindings = runContent(browserResult.html, browserResult.finalUrl, browserResult.axeRan);
  const seoFindings = runSeo(browserResult.html, browserResult.finalUrl);
  const psychologyFindings = runPsychology(browserResult.html);
  const performanceFindings = runPerformance(browserResult.perf);
  const accessibilityFindings = runAccessibility(browserResult.axeViolations, browserResult.axeRan);
  const techStackFindings = runTechStack(browserResult.html);
  const geoFindings = await runGeo(browserResult.html, browserResult.finalUrl);

  const allFindings = [
    ...browserResult.findings,
    ...securityFindings,
    ...dnsFindings,
    ...domainFindings,
    ...contentFindings,
    ...seoFindings,
    ...geoFindings,
    ...psychologyFindings,
    ...performanceFindings,
    ...accessibilityFindings,
    ...techStackFindings,
  ];

  const { categories, overallScore, overallGrade } = buildScores(allFindings);

  const report: ScanReport = {
    url,
    finalUrl: browserResult.finalUrl,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    overallScore,
    overallGrade,
    categories,
  };

  cache.set(url, { report, at: Date.now() });
  if (cache.size > 500) {
    // ältesten Eintrag entfernen (Map merkt sich Einfüge-Reihenfolge)
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  return report;
}
