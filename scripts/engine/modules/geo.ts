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
import { safeFetch } from "../ssrf";

// Bekannte KI-/Answer-Engine-Crawler (Stand 2026).
const AI_BOTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", // OpenAI
  "ClaudeBot", "Claude-Web", "anthropic-ai", // Anthropic
  "PerplexityBot", "Perplexity-User",         // Perplexity
  "Google-Extended",                          // Google Gemini / AI Overviews
  "Applebot-Extended",                        // Apple Intelligence
  "Bytespider", "Amazonbot", "cohere-ai", "Meta-ExternalAgent",
];

// Kleiner, abgesicherter GET mit Timeout. safeFetch folgt Redirects manuell und
// prüft vor jedem Hop die echte Ziel-IP — sonst könnte /robots.txt per 30x ins
// interne Netz umleiten. Fehler (auch geblockte Ziele) → { ok: false }.
const EIGENER_UA = "ComplianceCheckerBot/1.0 (+https://check.viktortorno.de)";
// Ein echter Browser-UA für den Rohabruf: manche Server liefern unbekannten
// Clients abweichendes HTML, was den Vergleich "Quelltext vs. gerendert" sonst
// verfälschen würde.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchText(
  url: string,
  timeoutMs = 6000,
  userAgent = EIGENER_UA,
  // Obergrenze je Antwort. 200 KB reichen für robots.txt/llms.txt/sitemap.xml,
  // NICHT für eine Seite: heise.de liefert 920 KB, und ein Abschneiden bei
  // 200 KB hätte den Vergleich "Quelltext vs. gerendert" auf 14 % gedrückt —
  // ein erfundener Mangel. Deshalb ist die Grenze ein Parameter.
  maxZeichen = 200_000
): Promise<{ ok: boolean; status: number; text: string; gekappt: boolean }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": userAgent },
    });
    const voll = res.ok ? await res.text() : "";
    return { ok: res.ok, status: res.status, text: voll.slice(0, maxZeichen), gekappt: voll.length > maxZeichen };
  } catch {
    return { ok: false, status: 0, text: "", gekappt: false };
  } finally {
    clearTimeout(t);
  }
}

// Sichtbaren Text aus HTML gewinnen. Bewusst grob: es geht nicht um exakte
// Darstellung, sondern um den MENGENVERGLEICH zwischen Quelltext und
// gerendertem DOM. Script/Style/Template müssen raus, sonst zählt ein
// eingebetteter JSON-Zustand (Next.js `__next_f`) als "Inhalt".
function sichtbarerText(html: string): string {
  return html
    .replace(/<(script|style|template|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wortzahl(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

// Alle JSON-LD-Blöcke geparst zurückgeben (fehlerhafte werden übersprungen —
// kaputtes JSON-LD ist häufig und darf den Scan nicht kippen).
function jsonLdObjekte(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* ungültiges JSON-LD ignorieren */ }
  }
  return out;
}

// Rekursiv nach einem Feld in verschachteltem JSON-LD suchen (@graph, Arrays).
function feldSuchen(objekte: unknown[], feld: string): string[] {
  const treffer: string[] = [];
  const lauf = (n: unknown, tiefe: number) => {
    if (!n || typeof n !== "object" || tiefe > 6) return;
    if (Array.isArray(n)) return n.forEach((x) => lauf(x, tiefe + 1));
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === feld) {
        if (typeof v === "string") treffer.push(v);
        else if (Array.isArray(v)) treffer.push(...v.filter((x): x is string => typeof x === "string"));
      }
      lauf(v, tiefe + 1);
    }
  };
  objekte.forEach((o) => lauf(o, 0));
  return treffer;
}

export async function runGeo(html: string, finalUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const origin = (() => { try { return new URL(finalUrl).origin; } catch { return ""; } })();
  if (!origin) return findings;

  // Alles Nachzuladende parallel — die Fetches bestimmen sonst die Scandauer.
  //
  // Neu neben robots/llms/sitemap:
  //   rohSeite  — dieselbe URL ohne Browser: zeigt, was ein Crawler OHNE
  //               JavaScript zu sehen bekommt.
  //   botGpt/botPpl — dieselbe URL als GPTBot bzw. PerplexityBot. Viele Seiten
  //               erlauben die Bots in der robots.txt und lassen sie trotzdem
  //               von einer WAF mit 403 abweisen. Die robots.txt allein zu
  //               prüfen, hätte das nie gezeigt.
  const [robots, llms, sitemap, rohSeite, botGpt, botPpl] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/llms.txt`),
    fetchText(`${origin}/sitemap.xml`),
    fetchText(finalUrl, 8000, BROWSER_UA, 4_000_000),
    fetchText(finalUrl, 8000, "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot"),
    fetchText(finalUrl, 8000, "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot"),
  ]);

  // ---------- 1. KI-Crawler-Zugang (robots.txt) ----------
  if (!robots.ok || !robots.text.trim()) {
    findings.push({ id: "geo.no-robots", category: "geo", title: "Keine robots.txt gefunden", status: "warn", severity: "low", description: "Es wurde keine robots.txt gefunden. Ohne sie crawlen KI-Bots zwar meist trotzdem, aber du hast keine Steuerung darüber, was sie sehen dürfen.", recommendation: "Eine robots.txt anlegen und KI-Crawler bewusst zulassen (oder gezielt ausschließen)." });
  } else {
    // robots.txt in Gruppen zerlegen, statt mit einer Regex über die ganze
    // Datei zu laufen.
    //
    // Die alte Prüfung suchte "User-agent: *" und danach per [\s\S]*? irgendwo
    // ein "Disallow: /". heise.de listet unter "# Malicious Crawler" hunderte
    // Bots mit je eigenem "Disallow: /" — die Regex sprang über alle Blöcke
    // hinweg auf den erstbesten Treffer und meldete "sperrt ALLE Bots aus"
    // (fail/high). Das traf jede Seite, die auch nur einen Bot aussperrt.
    //
    // Aufbau nach RFC 9309: aufeinanderfolgende User-agent-Zeilen bilden EINE
    // Gruppe, die bis zur nächsten User-agent-Zeile nach einer Regel gilt.
    const gruppen: { agents: string[]; disallowAll: boolean }[] = [];
    let aktuell: { agents: string[]; disallowAll: boolean } | null = null;
    let letzteZeileWarAgent = false;
    for (const roh of robots.text.split(/\r?\n/)) {
      const zeile = roh.replace(/#.*$/, "").trim();
      if (!zeile) continue;
      const ua = zeile.match(/^User-agent:\s*(.+)$/i);
      if (ua) {
        if (!aktuell || !letzteZeileWarAgent) {
          aktuell = { agents: [], disallowAll: false };
          gruppen.push(aktuell);
        }
        aktuell.agents.push(ua[1].trim());
        letzteZeileWarAgent = true;
        continue;
      }
      letzteZeileWarAgent = false;
      // Nur ein Disallow auf die reine Wurzel sperrt alles. "Disallow: /forum/"
      // ist eine Pfadregel, "Disallow:" (leer) erlaubt sogar ausdrücklich alles.
      if (aktuell && /^Disallow:\s*\/\s*$/i.test(zeile)) aktuell.disallowAll = true;
    }

    const sperrtAlles = (name: string) =>
      gruppen.some((g) => g.disallowAll && g.agents.some((a) => a.toLowerCase() === name.toLowerCase()));

    const blocked = AI_BOTS.filter(sperrtAlles);
    const globalBlock = sperrtAlles("*");

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

  // ---------- 7. Sieht ein KI-Crawler den Inhalt überhaupt? ----------
  //
  // Die wichtigste Prüfung dieses Moduls. GPTBot, PerplexityBot und ClaudeBot
  // führen überwiegend KEIN JavaScript aus — sie lesen das ausgelieferte HTML.
  // Eine Single-Page-App kann im Browser prächtig aussehen und für jedes
  // KI-System eine leere Hülle sein. Alle Tag-Prüfungen dieses Moduls laufen
  // auf dem gerenderten DOM und würden das nie bemerken.
  const domText = sichtbarerText(html);
  const rohText = rohSeite.ok ? sichtbarerText(rohSeite.text) : "";
  const domWorte = wortzahl(domText);
  const rohWorte = wortzahl(rohText);

  if (rohSeite.ok && domWorte >= 50) {
    const anteil = rohWorte / domWorte;
    const belege = [
      `Im Quelltext: ${rohWorte} Wörter`,
      `Nach JavaScript: ${domWorte} Wörter`,
      `Anteil ohne JavaScript: ${Math.round(anteil * 100)} %`,
    ];
    if (anteil < 0.3) {
      findings.push({ id: "geo.js-dependency", category: "geo", title: `Nur ${Math.round(anteil * 100)} % des Inhalts stehen ohne JavaScript im Quelltext`, status: "fail", severity: "high", description: "Der Text entsteht fast vollständig erst im Browser. KI-Crawler wie GPTBot, PerplexityBot und ClaudeBot führen in der Regel kein JavaScript aus — sie sehen eine nahezu leere Seite und können nichts zitieren. Auch für die klassische Suche ist das ein Risiko.", recommendation: "Inhalte serverseitig rendern (SSR/SSG) oder als statisches HTML ausliefern, statt sie erst im Browser aufzubauen.", evidence: belege });
    } else if (anteil < 0.7) {
      findings.push({ id: "geo.js-dependency-partial", category: "geo", title: `${Math.round((1 - anteil) * 100)} % des Inhalts erscheinen erst durch JavaScript`, status: "warn", severity: "medium", description: "Ein erheblicher Teil des Textes steht nicht im ausgelieferten HTML, sondern wird erst im Browser nachgeladen. Für KI-Crawler ohne JavaScript-Ausführung fehlt genau dieser Teil.", recommendation: "Die wichtigsten Inhalte (Kernaussagen, Leistungen, FAQ) serverseitig ausliefern.", evidence: belege });
    } else {
      findings.push({ id: "geo.no-js-dependency", category: "geo", title: "Inhalt steht ohne JavaScript im Quelltext", status: "pass", severity: "info", description: "Der Text ist bereits im ausgelieferten HTML enthalten — KI-Crawler ohne JavaScript-Ausführung erfassen die Seite vollständig.", evidence: belege });
    }
  }

  // ---------- 8. Serverseitige Bot-Sperren ----------
  // robots.txt ist eine Bitte, die WAF ist eine Tür. Cloudflare & Co. blocken
  // KI-Bots oft per Voreinstellung, während die robots.txt sie erlaubt.
  const botAbrufe = [
    { name: "GPTBot (OpenAI)", res: botGpt },
    { name: "PerplexityBot", res: botPpl },
  ];
  const gesperrt = botAbrufe.filter((b) => [401, 403, 405, 406, 418, 429, 451, 503].includes(b.res.status));
  const erreichbar = botAbrufe.filter((b) => b.res.ok);
  if (gesperrt.length > 0) {
    findings.push({ id: "geo.bot-blocked-server", category: "geo", title: `${gesperrt.length} KI-Crawler werden vom Server abgewiesen`, status: "fail", severity: "medium", description: "Beim Abruf mit KI-Bot-Kennung antwortet der Server mit einem Fehlercode. Das kommt meist von einem Schutzdienst (Cloudflare, WAF) und wirkt unabhängig von der robots.txt: Die Bots dürfen laut robots.txt, kommen aber technisch nicht durch — die Marke taucht in deren Antworten nicht auf.", recommendation: "Im Schutzdienst prüfen, ob KI-Bots bewusst blockiert werden sollen. Wenn nicht: GPTBot, ClaudeBot, PerplexityBot & Co. von der Bot-Abwehr ausnehmen.", evidence: gesperrt.map((b) => `${b.name}: HTTP ${b.res.status}`) });
  } else if (erreichbar.length === botAbrufe.length) {
    findings.push({ id: "geo.bot-access-ok", category: "geo", title: "KI-Crawler kommen auch technisch durch", status: "pass", severity: "info", description: "Testabrufe mit GPTBot- und PerplexityBot-Kennung wurden normal beantwortet — es gibt keine serverseitige Bot-Sperre zusätzlich zur robots.txt.", evidence: botAbrufe.map((b) => `${b.name}: HTTP ${b.res.status}`) });
  }

  // ---------- 9. Zitierfähige Passagen ----------
  // Answer-Engines extrahieren Absätze, die für sich allein stehen. Sehr kurze
  // Fragmente tragen keine Aussage, sehr lange Blöcke werden nicht am Stück
  // übernommen. 40–120 Wörter ist das Fenster, das in der Praxis zitiert wird.
  const absaetze = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => sichtbarerText(m[1]))
    .filter((t) => wortzahl(t) >= 15);
  if (absaetze.length >= 3) {
    const zitierfaehig = absaetze.filter((t) => {
      const w = wortzahl(t);
      return w >= 40 && w <= 120;
    });
    const quote = zitierfaehig.length / absaetze.length;
    if (quote < 0.2) {
      findings.push({ id: "geo.few-citable-chunks", category: "geo", title: "Kaum zitierfähige Absätze", status: "warn", severity: "medium", description: `Von ${absaetze.length} Textabsätzen liegen nur ${zitierfaehig.length} im Bereich von 40–120 Wörtern. KI-Antwortsysteme übernehmen Passagen, die für sich allein eine vollständige Aussage tragen — zu kurze Fragmente sagen nichts, zu lange Blöcke werden nicht am Stück zitiert.`, recommendation: "Kernaussagen in eigenständige Absätze von 40–120 Wörtern fassen, jeweils mit Kontext im ersten Satz (kein „das“ oder „dabei“ als Einstieg).", evidence: [`${zitierfaehig.length} von ${absaetze.length} Absätzen im Zielbereich`] });
    } else {
      findings.push({ id: "geo.citable-chunks", category: "geo", title: "Zitierfähige Absätze vorhanden", status: "pass", severity: "info", description: `${zitierfaehig.length} von ${absaetze.length} Absätzen liegen im gut zitierbaren Bereich von 40–120 Wörtern.` });
    }
  }

  // ---------- 10. Faktendichte ----------
  // KI-Systeme belegen Antworten gern mit Konkretem. Prozentwerte, Beträge,
  // Jahreszahlen und Mengenangaben sind das, was zitiert wird — Adjektive nicht.
  if (domWorte >= 150) {
    const zahlen = (domText.match(/\b\d+(?:[.,]\d+)?\s*(?:%|€|EUR|\$|km|kg|h|Std\.?|Min\.?|Tage?|Wochen|Monate?|Jahre?|Mio\.?|Mrd\.?|x)\b/gi) || []).length
      + (domText.match(/\b(?:19|20)\d{2}\b/g) || []).length;
    const dichte = (zahlen / domWorte) * 100;
    if (dichte < 0.4) {
      findings.push({ id: "geo.low-fact-density", category: "geo", title: "Wenig konkrete Zahlen im Text", status: "warn", severity: "low", description: `Auf ${domWorte} Wörter kommen nur ${zahlen} Zahlenangaben (Beträge, Prozente, Zeiträume, Jahreszahlen). KI-Antwortsysteme zitieren bevorzugt überprüfbare Fakten; rein qualitative Werbetexte werden selten übernommen.`, recommendation: "Aussagen mit Zahlen belegen: Dauer, Preise, Mengen, Ergebnisse, Jahreszahlen — statt „schnell“ und „umfassend“.", evidence: [`${zahlen} Zahlenangaben auf ${domWorte} Wörter (${dichte.toFixed(2)} je 100)`] });
    } else {
      findings.push({ id: "geo.fact-density", category: "geo", title: "Text enthält konkrete Zahlen", status: "pass", severity: "info", description: `${zahlen} überprüfbare Angaben auf ${domWorte} Wörter — gute Grundlage, um in KI-Antworten zitiert zu werden.` });
    }
  }

  // ---------- 11. Definitionssätze ----------
  // "X ist ein Y, das Z" ist das Satzmuster, aus dem Antwortsysteme ihre
  // Erklärungen bauen. Fehlt es völlig, hat die KI nichts zum Übernehmen.
  if (domWorte >= 150) {
    const definitionen = (domText.match(/\b[A-ZÄÖÜ][\wäöüß-]{2,}(?:\s+[\wäöüß-]+){0,3}\s+(?:ist|sind|bezeichnet|bedeutet|beschreibt)\s+(?:ein|eine|einer|der|die|das|kein|keine)\b/g) || []).length;
    if (definitionen === 0) {
      findings.push({ id: "geo.no-definitions", category: "geo", title: "Keine Definitionssätze gefunden", status: "warn", severity: "low", description: "Es wurde kein Satz im Muster „X ist ein/eine …“ gefunden. Genau diese Sätze übernehmen KI-Systeme, wenn sie einen Begriff erklären — ohne sie wird eher die Konkurrenz zitiert.", recommendation: "Zentrale Begriffe der eigenen Leistung einmal ausdrücklich definieren („Ein KI-Audit ist eine strukturierte Prüfung, die …“)." });
    } else {
      findings.push({ id: "geo.definitions", category: "geo", title: "Definitionssätze vorhanden", status: "pass", severity: "info", description: `${definitionen} Satz/Sätze im Muster „X ist ein/eine …“ — daraus bauen Antwortsysteme ihre Erklärungen.` });
    }
  }

  // ---------- 12. Autor als Entität (sameAs) ----------
  // Ein Name im Impressum macht noch keine Entität. Erst sameAs-Verweise auf
  // etablierte Profile verknüpfen die Person mit dem Wissensgraph.
  const ld = jsonLdObjekte(html);
  const sameAs = feldSuchen(ld, "sameAs");
  if (sameAs.length > 0) {
    findings.push({ id: "geo.sameas-ok", category: "geo", title: `Entität mit ${sameAs.length} sameAs-Verweis(en) verknüpft`, status: "pass", severity: "info", description: "Über sameAs ist die Marke bzw. Person mit externen Profilen verknüpft (LinkedIn, Wikipedia, Branchenverzeichnisse). Das hilft KI-Systemen, sie eindeutig zuzuordnen.", evidence: sameAs.slice(0, 6) });
  } else {
    findings.push({ id: "geo.no-sameas", category: "geo", title: "Keine sameAs-Verknüpfung", status: "warn", severity: "low", description: "Im Schema fehlen sameAs-Verweise auf externe Profile. Ohne sie bleibt die Marke für KI-Systeme ein Name auf einer Website statt einer eindeutigen Entität.", recommendation: "Im Organization-/Person-Schema sameAs mit LinkedIn, Xing, Branchenverzeichnissen und ggf. Wikipedia ergänzen." });
  }

  // ---------- 13. Aktualität ----------
  const daten = [...feldSuchen(ld, "dateModified"), ...feldSuchen(ld, "datePublished")]
    .map((d) => Date.parse(d))
    .filter((t) => Number.isFinite(t) && t > 0);
  if (daten.length > 0) {
    const juengstes = Math.max(...daten);
    const tage = Math.floor((Date.now() - juengstes) / 86_400_000);
    const datum = new Date(juengstes).toISOString().slice(0, 10);
    if (tage > 730) {
      findings.push({ id: "geo.stale-content", category: "geo", title: `Inhalt zuletzt vor ${Math.floor(tage / 365)} Jahren aktualisiert`, status: "warn", severity: "medium", description: `Das jüngste im Schema hinterlegte Datum ist der ${datum}. KI-Systeme gewichten Aktualität stark und bevorzugen bei konkurrierenden Quellen die jüngere.`, recommendation: "Inhalte überarbeiten und dateModified pflegen — ein gepflegtes Datum ohne inhaltliche Änderung hilft dagegen nicht." });
    } else {
      findings.push({ id: "geo.freshness-ok", category: "geo", title: "Aktualitätsdatum hinterlegt", status: "pass", severity: "info", description: `Jüngstes Schema-Datum: ${datum} (vor ${tage} Tagen). Aktualität ist ein starkes Signal für KI-Systeme.` });
    }
  } else {
    findings.push({ id: "geo.no-date-schema", category: "geo", title: "Kein Datum im Schema", status: "warn", severity: "low", description: "Weder datePublished noch dateModified sind ausgezeichnet. KI-Systeme können die Aktualität dann nicht einschätzen und greifen im Zweifel zu einer datierten Quelle.", recommendation: "datePublished und dateModified im JSON-LD pflegen (und sichtbar auf der Seite zeigen)." });
  }

  // ---------- 14. Belege durch ausgehende Quellen ----------
  // Seiten, die selbst belegen, gelten als vertrauenswürdiger — und Antwort-
  // systeme folgen den Verweisen. Social-Profile zählen dabei nicht als Beleg.
  const eigeneDomain = (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const externeHosts = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi)) {
    try {
      const h = new URL(m[1]).hostname.replace(/^www\./, "");
      if (h && h !== eigeneDomain && !/facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|xing|pinterest|whatsapp/i.test(h)) {
        externeHosts.add(h);
      }
    } catch { /* kaputte URL überspringen */ }
  }
  if (externeHosts.size === 0) {
    findings.push({ id: "geo.no-sources", category: "geo", title: "Keine ausgehenden Quellen verlinkt", status: "warn", severity: "low", description: "Die Seite verlinkt keine externen Fachquellen. Belegte Aussagen (Gesetzestexte, Studien, Hersteller-Dokumentation) wirken auf Bewertungssysteme und KI glaubwürdiger als unbelegte Behauptungen.", recommendation: "Zentrale Aussagen mit Verweisen auf Primärquellen belegen — Gesetzestext, Studie, offizielle Dokumentation." });
  } else {
    findings.push({ id: "geo.sources-ok", category: "geo", title: `${externeHosts.size} externe Quelle(n) verlinkt`, status: "pass", severity: "info", description: "Die Seite belegt Aussagen mit Verweisen auf externe Quellen — ein Vertrauenssignal für Suchmaschinen und KI-Systeme.", evidence: [...externeHosts].slice(0, 6) });
  }

  // ---------- 15. Hinweis: Off-Site-Signale ----------
  findings.push({ id: "geo.offsite-note", category: "geo", title: "Hinweis: Marken-Erwähnungen zählen extra", status: "pass", severity: "info", description: "KI-Sichtbarkeit hängt stark von Erwähnungen auf Drittplattformen (Wikipedia, Reddit, YouTube, Fachportale) ab. Dieser automatische Check misst nur die Website selbst — die Off-Site-Präsenz wird im persönlichen Beratungsgespräch bewertet." });

  return findings;
}
