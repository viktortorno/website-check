// Technologie-Stack-Modul: erkennt heuristisch die eingesetzten Technologien
// (CMS, Website-Baukasten, JS-Frameworks, Bibliotheken) aus dem HTML — und
// warnt bei veralteten Komponenten mit bekannten Sicherheitslücken.
//
// Rein HTML-basiert (kein Versions-API), daher TLD-unabhängig und schnell.
// Findings laufen unter "security" (Stack-Transparenz + veraltete Software).

import { Finding } from "../types";

// Anzeigename → Erkennungsmuster (eines reicht).
const SIGNATURES: { name: string; patterns: RegExp[] }[] = [
  // CMS
  { name: "WordPress", patterns: [/wp-content/i, /wp-includes/i, /wp-json/i, /name=["']generator["'][^>]*WordPress/i] },
  { name: "Joomla", patterns: [/\/media\/jui\//i, /name=["']generator["'][^>]*Joomla/i] },
  { name: "Drupal", patterns: [/sites\/(all|default)\/(themes|modules)/i, /name=["']generator["'][^>]*Drupal/i, /drupal-settings-json/i] },
  { name: "TYPO3", patterns: [/typo3conf|typo3temp/i, /name=["']generator["'][^>]*TYPO3/i] },
  // Baukästen
  { name: "Shopify", patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i] },
  { name: "Wix", patterns: [/static\.wixstatic\.com/i, /\.wix\.com/i] },
  { name: "Squarespace", patterns: [/static\.squarespace\.com/i, /squarespace\.com/i] },
  { name: "Jimdo", patterns: [/\.jimdo(fa)?\.com/i, /jimdo/i] },
  { name: "Webflow", patterns: [/\.webflow\.io/i, /data-wf-site/i] },
  { name: "Webnode", patterns: [/webnode/i] },
  // JS-Frameworks
  { name: "Next.js", patterns: [/\/_next\//i, /__NEXT_DATA__/i] },
  { name: "Nuxt", patterns: [/__NUXT__/i, /\/_nuxt\//i] },
  { name: "Gatsby", patterns: [/___gatsby/i, /gatsby/i] },
  { name: "React", patterns: [/data-reactroot/i, /react(?:-dom)?(?:\.production)?(?:\.min)?\.js/i] },
  { name: "Vue.js", patterns: [/data-v-[0-9a-f]{8}/i, /vue(?:\.runtime)?(?:\.min)?\.js/i] },
  { name: "Angular", patterns: [/ng-version=/i, /ng-app=/i] },
  // UI / Libraries
  { name: "Bootstrap", patterns: [/bootstrap(?:\.min)?\.(?:css|js)/i] },
  { name: "jQuery", patterns: [/jquery[.\-]/i, /jquery(?:\.min)?\.js/i] },
  // Tag-/Analytics
  { name: "Google Tag Manager", patterns: [/googletagmanager\.com\/gtm/i] },
  { name: "Google Analytics", patterns: [/google-analytics\.com|gtag\(/i] },
];

export function runTechStack(html: string): Finding[] {
  const findings: Finding[] = [];
  if (!html) return findings;

  // --- 1. Eingesetzte Technologien erkennen ---
  const detected = SIGNATURES.filter((s) => s.patterns.some((p) => p.test(html))).map((s) => s.name);

  if (detected.length > 0) {
    findings.push({
      id: "security.tech-stack",
      category: "security",
      title: `Erkannte Technologien: ${detected.join(", ")}`,
      status: "pass",
      severity: "info",
      description: "Aus dem Seitenquelltext ableitbare Technologien. Bekannte Systeme erleichtern gezielte Angriffe — daher Updates konsequent einspielen.",
      evidence: detected,
    });
  }

  // --- 2. Veraltetes jQuery (bekannte XSS-Lücken vor 3.5.0) ---
  // Version aus Dateinamen oder ?ver=-Parameter ziehen.
  const jqMatch =
    html.match(/jquery[.\-]?v?(\d+\.\d+\.\d+)/i) ||
    html.match(/jquery[^"']*?[?&]ver=(\d+\.\d+\.\d+)/i);
  if (jqMatch) {
    const ver = jqMatch[1];
    const [maj, min] = ver.split(".").map(Number);
    const isOld = maj < 3 || (maj === 3 && min < 5); // < 3.5.0 → CVE-2020-11022/11023
    if (isOld) {
      findings.push({
        id: "security.jquery-outdated",
        category: "security",
        title: `Veraltetes jQuery ${ver}`,
        status: "warn",
        severity: maj < 2 ? "medium" : "low",
        description: `Es wird jQuery ${ver} eingesetzt. Versionen vor 3.5.0 haben bekannte XSS-Schwachstellen (CVE-2020-11022 / 11023).`,
        recommendation: "jQuery auf die aktuelle 3.x-Version aktualisieren — oder prüfen, ob es noch gebraucht wird.",
        evidence: [`jQuery ${ver}`],
      });
    }
  }

  // --- 3. Versions-Leak im generator-Meta (z. B. WordPress 5.2) ---
  const gen = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i);
  if (gen && /\d+\.\d+/.test(gen[1])) {
    findings.push({
      id: "security.version-leak",
      category: "security",
      title: "Software-Version im Quelltext sichtbar",
      status: "warn",
      severity: "low",
      description: `Der Quelltext verrät eine konkrete Version: „${gen[1].trim()}". Das erleichtert Angreifern, gezielt nach passenden Exploits zu suchen.`,
      recommendation: "Versions-Angabe im generator-Meta entfernen und System/Plugins aktuell halten.",
      evidence: [gen[1].trim()],
    });
  }

  return findings;
}
