// GEO-Modul: Generative Engine Optimization — wie gut ist die Seite darauf
// vorbereitet, von KI-Suchsystemen (ChatGPT, Claude, Perplexity, Gemini,
// Google AI Overviews) gefunden, verstanden und ZITIERT zu werden?
//
// KI-Suche funktioniert anders als die klassische Linkliste: Antwort-Engines
// extrahieren faktendichte, in sich abgeschlossene Passagen und brauchen klare
// Entitäts-/Autoren-Signale. Geprüft werden daher:
//   - Zugang für KI-Crawler (robots.txt: GPTBot, ClaudeBot, PerplexityBot …)
//   - llms.txt (aufkommender Standard, der KI die Seitenstruktur erklärt)
//   - sitemap.xml (Auffindbarkeit aller Inhalte)
//   - Zitierbarkeit: Schema.org, FAQ-/Frage-Struktur, Autor & Datum (E-E-A-T)
//
// Hinweis: Marken-Erwähnungen auf Drittplattformen (Reddit, YouTube, Wikipedia)
// korrelieren stark mit KI-Sichtbarkeit, sind aber nur mit externen APIs
// messbar — bewusst ausgeklammert und im Report als Hinweis vermerkt.

import { Finding } from "../types";

// Bekannte KI-/Answer-Engine-Crawler (Stand 2026).
const AI_BOTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", // OpenAI
  "ClaudeBot", "Claude-Web", "anthropic-ai", // Anthropic
  "PerplexityBot", "Perplexity-User",         // Perplexity
  "Google-Extended",                          // Google Gemini / AI Overviews
  "Applebot-Extended",                        // Apple Intelligence
  "Bytespider", "Amazonbot", "cohere-ai", "Meta-ExternalAgent",
];

// Kleiner, abgesicherter GET mit Timeout — nur auf demselben (bereits per
// SSRF-Check freigegebenen) Origin wie die gescannte Seite.
async function fetchText(url: string, timeoutMs = 6000): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "ComplianceCheckerBot/1.0 (+https://check.viktortorno.de)" },
    });
    const text = res.ok ? (await res.text()).slice(0, 200_000) : "";
    return { ok: res.ok, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(t);
  }
}

export async function runGeo(html: string, finalUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const origin = (() => { try { return new URL(finalUrl).origin; } catch { return ""; } })();
  if (!origin) return findings;

  // Robots.txt, llms.txt und sitemap.xml parallel holen.
  const [robots, llms, sitemap] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/llms.txt`),
    fetchText(`${origin}/sitemap.xml`),
  ]);

  // ---------- 1. KI-Crawler-Zugang (robots.txt) ----------
  if (!robots.ok || !robots.text.trim()) {
    findings.push({ id: "geo.no-robots", category: "geo", title: "Keine robots.txt gefunden", status: "warn", severity: "low", description: "Es wurde keine robots.txt gefunden. Ohne sie crawlen KI-Bots zwar meist trotzdem, aber du hast keine Steuerung darüber, was sie sehen dürfen.", recommendation: "Eine robots.txt anlegen und KI-Crawler bewusst zulassen (oder gezielt ausschließen)." });
  } else {
    const txt = robots.text;
    // Pro Bot prüfen, ob es einen expliziten Disallow-Block gibt.
    const blocked = AI_BOTS.filter((bot) => {
      const re = new RegExp(`User-agent:\\s*${bot}[\\s\\S]*?Disallow:\\s*/\\s*(?:\\n|$)`, "i");
      return re.test(txt);
    });
    // Globaler Block (User-agent: * → Disallow: /) trifft auch KI-Bots.
    const globalBlock = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*(?:\n|$)/i.test(txt);

    if (globalBlock) {
      findings.push({ id: "geo.robots-global-block", category: "geo", title: "robots.txt sperrt alle Bots aus", status: "fail", severity: "high", description: "Die robots.txt verbietet allen Crawlern (User-agent: *) den Zugriff. Damit können auch KI-Suchsysteme die Seite nicht lesen und nicht zitieren.", recommendation: "Den globalen Disallow auflösen und KI-/Suchmaschinen-Bots gezielt zulassen.", evidence: [`${origin}/robots.txt`] });
    } else if (blocked.length > 0) {
      findings.push({ id: "geo.ai-bots-blocked", category: "geo", title: `${blocked.length} KI-Crawler ausgesperrt`, status: "warn", severity: "medium", description: `Folgende KI-Bots werden in der robots.txt blockiert: ${blocked.join(", ")}. Dann erscheint die Marke nicht in deren Antworten.`, recommendation: "Bewusst entscheiden: Sollen diese KI-Systeme zitieren dürfen? Wenn ja, Disallow für sie entfernen.", evidence: blocked });
    } else {
      findings.push({ id: "geo.ai-bots-allowed", category: "geo", title: "KI-Crawler haben Zugang", status: "pass", severity: "info", description: "Die robots.txt sperrt keine bekannten KI-Crawler explizit aus — gut für die Sichtbarkeit in KI-Antworten." });
    }
  }

  // ---------- 2. llms.txt (KI-Strukturhinweis) ----------
  // Ehrlich eingeordnet: llms.txt ist KEIN bestätigter Ranking-/Zitier-Hebel,
  // aber ein günstiges, zukunftsgerichtetes Signal und low-risk.
  if (llms.ok && llms.text.trim().length > 20) {
    findings.push({ id: "geo.llms-txt-ok", category: "geo", title: "llms.txt vorhanden", status: "pass", severity: "info", description: "Eine llms.txt ist hinterlegt — sie bietet KI-Systemen eine kuratierte Übersicht der wichtigsten Inhalte." });
  } else {
    findings.push({ id: "geo.no-llms-txt", category: "geo", title: "Keine llms.txt", status: "warn", severity: "low", description: "Es gibt keine llms.txt. Der Standard ist noch jung und kein bestätigter Ranking-Faktor, aber ein günstiges, zukunftssicheres Signal, das KI die Orientierung erleichtert.", recommendation: "Eine /llms.txt mit Kurzbeschreibung der Marke und Links zu den wichtigsten Seiten anlegen." });
  }

  // ---------- 3. sitemap.xml ----------
  if (sitemap.ok && /<(urlset|sitemapindex)/i.test(sitemap.text)) {
    const count = (sitemap.text.match(/<loc>/gi) || []).length;
    findings.push({ id: "geo.sitemap-ok", category: "geo", title: "XML-Sitemap vorhanden", status: "pass", severity: "info", description: `Eine sitemap.xml wurde gefunden${count ? ` (${count} Einträge)` : ""} — hilft allen Such- und KI-Crawlern, alle Inhalte zu erfassen.` });
  } else {
    findings.push({ id: "geo.no-sitemap", category: "geo", title: "Keine XML-Sitemap", status: "warn", severity: "low", description: "Es wurde keine sitemap.xml gefunden. Ohne sie finden Crawler tief verlinkte Seiten schlechter.", recommendation: "Eine sitemap.xml generieren und in der robots.txt referenzieren." });
  }

  // ---------- 4. Zitierbarkeit: Frage-basierte Überschriften ----------
  // Answer-Engines bevorzugen Inhalte, die konkrete Fragen direkt beantworten.
  const headings = [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  );
  const questionHeadings = headings.filter((h) => /\?$/.test(h) || /^(wie|was|warum|wann|wo|wer|welche|wieso|kann|ist|sind|sollte)\b/i.test(h));
  const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/i.test(html);
  if (questionHeadings.length >= 2 || hasFaqSchema) {
    findings.push({ id: "geo.qa-structure", category: "geo", title: "Frage-Antwort-Struktur erkannt", status: "pass", severity: "info", description: `${hasFaqSchema ? "FAQ-Schema und/oder " : ""}frage-basierte Überschriften gefunden — solche Passagen werden von KI-Antwortsystemen besonders gerne zitiert.`, evidence: questionHeadings.slice(0, 5) });
  } else {
    findings.push({ id: "geo.no-qa-structure", category: "geo", title: "Kaum Frage-Antwort-Struktur", status: "warn", severity: "medium", description: "Es wurden kaum frage-basierte Überschriften oder ein FAQ-Bereich gefunden. KI-Antwortsysteme zitieren bevorzugt Inhalte, die eine konkrete Frage in einem in sich geschlossenen Absatz beantworten.", recommendation: "Wichtige Themen als Fragen formulieren (H2/H3) und direkt darunter in 40–120 Wörtern faktendicht beantworten; ggf. FAQPage-Schema ergänzen." });
  }

  // ---------- 5. Entitäts-/Autoritäts-Signal: Organization/Person-Schema ----------
  const hasOrgSchema = /"@type"\s*:\s*"(Organization|LocalBusiness|Person)"/i.test(html);
  if (hasOrgSchema) {
    findings.push({ id: "geo.entity-schema", category: "geo", title: "Entitäts-Schema vorhanden", status: "pass", severity: "info", description: "Organization-/Person-/LocalBusiness-Schema gefunden. Das hilft KI-Systemen, die Marke als eindeutige Entität zu erkennen und korrekt zuzuordnen." });
  } else {
    findings.push({ id: "geo.no-entity-schema", category: "geo", title: "Kein Entitäts-Schema", status: "warn", severity: "medium", description: "Es fehlt ein Organization-/Person-Schema. KI-Systeme bauen ein „Wissensgraph”-Verständnis von Entitäten auf — ohne klare Auszeichnung wird die Marke schlechter erkannt und zugeordnet.", recommendation: "Organization-Schema (Name, Logo, sameAs zu Social-Profilen) als JSON-LD ergänzen." });
  }

  // ---------- 6. Autor & Aktualität (E-E-A-T-Signale) ----------
  const hasAuthor = /"@type"\s*:\s*"Person"/i.test(html) || /rel=["']author["']/i.test(html) || /<meta[^>]*name=["']author["']/i.test(html);
  const hasDate = /datePublished|dateModified/i.test(html) || /<time[^>]*datetime=/i.test(html) || /<meta[^>]*property=["']article:(published|modified)_time["']/i.test(html);
  if (hasAuthor || hasDate) {
    findings.push({ id: "geo.eeat-ok", category: "geo", title: "E-E-A-T-Signale vorhanden", status: "pass", severity: "info", description: `Gefunden: ${[hasAuthor ? "Autoren-Angabe" : null, hasDate ? "Datums-Angabe" : null].filter(Boolean).join(" & ")}. Autor und Aktualität stärken Vertrauen bei Google und KI-Systemen.` });
  } else {
    findings.push({ id: "geo.no-eeat", category: "geo", title: "Schwache E-E-A-T-Signale", status: "warn", severity: "low", description: "Es wurden weder klare Autoren- noch Datumsangaben gefunden. Für Expertise/Vertrauenswürdigkeit (E-E-A-T) sind Autorenschaft und Aktualität wichtig — gerade für KI-Zitate.", recommendation: "Sichtbare Autoren-Angabe mit Qualifikation sowie Veröffentlichungs-/Aktualisierungsdatum ergänzen (auch als Schema)." });
  }

  // ---------- 7. Hinweis: Off-Site-Signale ----------
  findings.push({ id: "geo.offsite-note", category: "geo", title: "Hinweis: Marken-Erwähnungen zählen extra", status: "pass", severity: "info", description: "KI-Sichtbarkeit hängt stark von Erwähnungen auf Drittplattformen (Wikipedia, Reddit, YouTube, Fachportale) ab. Dieser automatische Check misst nur die Website selbst — die Off-Site-Präsenz wird im persönlichen Beratungsgespräch bewertet." });

  return findings;
}
