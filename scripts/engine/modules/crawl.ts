// Begrenzter Website-Crawl: die Prüfungen, die man erst über MEHRERE Seiten
// sieht.
//
// Bis hierher bewertet die Engine eine Seite. Manche der wichtigsten SEO-Fehler
// sind aber nur seitenübergreifend erkennbar: Zwanzig Seiten mit demselben
// Title, ein interner Link ins Leere, eine Redirect-Kette, eine noindex-Seite,
// die trotzdem in der Sitemap steht. Google nennt Crawling, Sitemaps und
// crawlbare Links als zentrale technische Bereiche.
//
// Der Architektur-Trick, der das ohne Warteschlange möglich macht: Diese Checks
// brauchen KEIN Chromium. Title, Description, H1, Canonical, noindex,
// Statuscode und Redirect-Kette stehen alle im rohen HTTP-Response. Ein Crawl
// aus reinen HTTP-Abrufen (25 URLs, parallel, hartes Zeitlimit) läuft in
// Sekunden und passt synchron in den bestehenden Scan — der teure Browser-Scan
// bleibt der EINEN Start-URL vorbehalten.
//
// Ehrliche Grenzen, im Bericht ausgewiesen:
//   - Umfang gedeckelt (MAX_URLS). Große Sites werden nicht vollständig erfasst;
//     der Deckel wird gemeldet, nicht verschwiegen.
//   - „Verwaiste Seite“ ist eine Näherung: in der Sitemap, aber nicht von der
//     STARTSEITE verlinkt. Ein echter Nachweis bräuchte den vollen Linkgraph.
//   - Ohne Chromium sehen wir das SERVERSEITIGE HTML. Rein per JavaScript
//     nachgeladene Titles/Links fehlen — das deckt der Browser-Scan der
//     Startseite ab und ist dort als geo.js-dependency vermerkt.

import { Finding } from "../types";
import { assertPublicUrl, leseBegrenzt } from "../ssrf";

const MAX_URLS = 25;          // zusätzlich zur Startseite
const CONCURRENCY = 6;        // gleichzeitige Abrufe — schont Ziel und uns
const GESAMT_TIMEOUT_MS = 15_000;
const PRO_ABRUF_MS = 6_000;
const BOT_UA = "ComplianceCheckerBot/1.0 (+https://check.viktortorno.de)";

// Assets und Nicht-HTML-Ziele gar nicht erst crawlen.
const NICHT_HTML = /\.(jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|pdf|zip|docx?|xlsx?|mp4|webm|woff2?|ttf|eot)(\?|#|$)/i;

interface CrawlSeite {
  url: string;
  finalUrl: string;
  status: number;       // 0 = nicht erreichbar
  hops: number;         // Zahl der Weiterleitungen
  title: string | null;
  description: string | null;
  h1: string | null;
  canonical: string | null;
  noindex: boolean;
  inSitemap: boolean;
  vonStartseiteVerlinkt: boolean;
}

function norm(roh: string, basis: string): string | null {
  try {
    const u = new URL(roh, basis);
    u.hash = "";
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

function ersterTreffer(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

// Eine Seite holen und die Redirect-Kette von Hand verfolgen (für die
// Ketten-Erkennung), mit IP-Prüfung vor jedem Hop.
async function holeSeite(url: string, inSitemap: boolean, vonStart: boolean): Promise<CrawlSeite> {
  const leer: CrawlSeite = {
    url, finalUrl: url, status: 0, hops: 0,
    title: null, description: null, h1: null, canonical: null, noindex: false,
    inSitemap, vonStartseiteVerlinkt: vonStart,
  };
  let current = url;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PRO_ABRUF_MS);
  try {
    for (let hops = 0; hops <= 5; hops++) {
      try { await assertPublicUrl(current); } catch { return { ...leer, finalUrl: current, hops }; }
      const res = await fetch(current, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": BOT_UA } });

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        const ziel = norm(res.headers.get("location")!, current);
        if (!ziel) return { ...leer, finalUrl: current, status: res.status, hops };
        current = ziel;
        continue;
      }

      const xRobots = res.headers.get("x-robots-tag") ?? "";
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ...leer, finalUrl: current, status: res.status, hops, noindex: /noindex/i.test(xRobots) };
      }
      const { text } = await leseBegrenzt(res, 150_000);
      const metaRobots = ersterTreffer(text, /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i) ?? "";
      const canonRoh = ersterTreffer(text, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
      return {
        url,
        finalUrl: current,
        status: res.status,
        hops,
        title: ersterTreffer(text, /<title[^>]*>([\s\S]*?)<\/title>/i),
        description: ersterTreffer(text, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i),
        h1: ersterTreffer(text, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, " ").trim() || null,
        canonical: canonRoh ? norm(canonRoh, current) : null,
        noindex: /noindex/i.test(metaRobots) || /noindex/i.test(xRobots),
        inSitemap,
        vonStartseiteVerlinkt: vonStart,
      };
    }
    return { ...leer, finalUrl: current, status: 0, hops: 6 };
  } catch {
    return leer;
  } finally {
    clearTimeout(t);
  }
}

// Sitemap(s) einlesen — /sitemap.xml plus die in robots.txt genannten. Ein
// Sitemap-Index (verweist auf weitere Sitemaps) wird eine Ebene tief aufgelöst.
async function sammleSitemapUrls(origin: string): Promise<Set<string>> {
  const urls = new Set<string>();
  const holen = async (sm: string): Promise<string[]> => {
    try {
      await assertPublicUrl(sm);
      const res = await fetch(sm, { signal: AbortSignal.timeout(PRO_ABRUF_MS), headers: { "User-Agent": BOT_UA } });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); return []; }
      const { text } = await leseBegrenzt(res, 1_000_000);
      return [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    } catch { return []; }
  };

  const start = [...await holen(`${origin}/sitemap.xml`)];
  // robots.txt nach weiteren Sitemaps fragen
  try {
    await assertPublicUrl(`${origin}/robots.txt`);
    const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(PRO_ABRUF_MS), headers: { "User-Agent": BOT_UA } });
    if (res.ok) {
      const { text } = await leseBegrenzt(res, 200_000);
      for (const m of text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) start.push(m[1]);
    } else { await res.body?.cancel().catch(() => {}); }
  } catch { /* egal */ }

  for (const eintrag of start) {
    const n = norm(eintrag, origin);
    if (!n) continue;
    // Ein Sitemap-Index verweist auf weitere .xml-Sitemaps → eine Ebene folgen.
    if (/\.xml(\?|#|$)/i.test(n) && urls.size < MAX_URLS * 4) {
      for (const u of await holen(n)) { const nn = norm(u, origin); if (nn) urls.add(nn); }
    } else {
      urls.add(n);
    }
    if (urls.size > MAX_URLS * 4) break;
  }
  return urls;
}

// Einfacher Parallel-Pool mit fester Nebenläufigkeit.
async function poolMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function runCrawl(startHtml: string, startFinalUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  if (!startHtml) return findings;

  let origin: string, startHost: string;
  try {
    const u = new URL(startFinalUrl);
    origin = u.origin;
    startHost = u.hostname.replace(/^www\./i, "");
  } catch {
    return findings;
  }
  const startNorm = norm(startFinalUrl, startFinalUrl);
  if (!startNorm) return findings;

  // Interne Links aus dem Start-HTML (gleiche registrable domain, kein Asset).
  const startLinks = new Set<string>();
  for (const m of startHtml.matchAll(/<a\b[^>]*\shref=["']([^"']+)["']/gi)) {
    const n = norm(m[1], startFinalUrl);
    if (!n || NICHT_HTML.test(n)) continue;
    try {
      if (new URL(n).hostname.replace(/^www\./i, "") === startHost) startLinks.add(n);
    } catch { /* ungültig */ }
  }

  const sitemapUrls = await sammleSitemapUrls(origin);

  // Kandidatenliste bilden: Startseite zuerst, dann Sitemap, dann Start-Links.
  // So bleibt bei knappem Deckel das Wichtigste drin.
  const kandidaten: string[] = [];
  const gesehen = new Set<string>();
  const add = (u: string) => {
    if (gesehen.has(u) || NICHT_HTML.test(u)) return;
    try { if (new URL(u).hostname.replace(/^www\./i, "") !== startHost) return; } catch { return; }
    gesehen.add(u); kandidaten.push(u);
  };
  add(startNorm);
  for (const u of sitemapUrls) add(u);
  for (const u of startLinks) add(u);

  const zuPruefen = kandidaten.slice(0, MAX_URLS + 1);
  const gedeckelt = kandidaten.length > zuPruefen.length;

  // Alle Abrufe unter einem gemeinsamen Zeitdeckel — der Crawl darf den
  // Gesamt-Scan nicht sprengen. Was nicht rechtzeitig kam, fehlt eben.
  const seiten = await Promise.race([
    poolMap(zuPruefen, CONCURRENCY, (u) =>
      holeSeite(u, sitemapUrls.has(u), startLinks.has(u) || u === startNorm)
    ),
    new Promise<CrawlSeite[]>((resolve) => setTimeout(() => resolve([]), GESAMT_TIMEOUT_MS)),
  ]);

  // Timeout getroffen (leeres Ergebnis) oder zu wenig Seiten → kein belastbarer
  // Mehrwert, still aussteigen. Der Einzelseiten-Scan steht ohnehin.
  if (seiten.length < 2) return findings;

  const erreichbar = seiten.filter((s) => s.status > 0);
  const html2xx = erreichbar.filter((s) => s.status >= 200 && s.status < 300);

  // --- 1. Interne 404er / kaputte Links -----------------------------------
  const kaputt = seiten.filter((s) => s.vonStartseiteVerlinkt && s.status >= 400);
  if (kaputt.length > 0) {
    findings.push({
      id: "seo.internal-broken-links", category: "seo",
      title: `${kaputt.length} interne${kaputt.length === 1 ? "r" : ""} Link${kaputt.length === 1 ? "" : "s"} ins Leere`,
      status: "fail", severity: "medium",
      description: "Von der Startseite führen Links auf Seiten, die mit einem Fehlercode antworten. Kaputte interne Links kosten Besucher und verschwenden das Crawl-Budget von Google.",
      recommendation: "Die Links korrigieren oder entfernen; dauerhaft verschobene Ziele per 301 weiterleiten.",
      evidence: kaputt.slice(0, 8).map((s) => `${s.url} → HTTP ${s.status}`),
    });
  }

  // --- 2. Redirect-Ketten --------------------------------------------------
  const ketten = seiten.filter((s) => s.hops >= 2);
  if (ketten.length > 0) {
    findings.push({
      id: "seo.redirect-chains", category: "seo",
      title: `${ketten.length} Redirect-Kette${ketten.length === 1 ? "" : "n"} (mehrfache Weiterleitung)`,
      status: "warn", severity: "low",
      description: "Diese URLs leiten über mehrere Stationen weiter (A → B → C). Jede Weiterleitung kostet Zeit, und Google folgt langen Ketten nicht unbegrenzt.",
      recommendation: "Direkt auf das Endziel weiterleiten (eine Weiterleitung statt einer Kette).",
      evidence: ketten.slice(0, 6).map((s) => `${s.url} — ${s.hops} Weiterleitungen → ${s.finalUrl}`),
    });
  }

  // --- 3. Doppelte Titles --------------------------------------------------
  const dubletten = (feld: (s: CrawlSeite) => string | null): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const s of html2xx) {
      const v = feld(s)?.toLowerCase().trim();
      if (!v) continue;
      (map.get(v) ?? map.set(v, []).get(v)!).push(s.url);
    }
    return new Map([...map].filter(([, urls]) => urls.length > 1));
  };

  const titelDup = dubletten((s) => s.title);
  if (titelDup.size > 0) {
    const betroffen = [...titelDup.values()].reduce((n, u) => n + u.length, 0);
    findings.push({
      id: "seo.duplicate-titles", category: "seo",
      title: `${betroffen} Seiten teilen sich ${titelDup.size} Title${titelDup.size === 1 ? "" : "s"}`,
      status: "warn", severity: "medium",
      description: "Mehrere Seiten haben denselben <title>. Google kann sie dann schlechter auseinanderhalten und wählt bei der Anzeige oft selbst einen Titel. Jede Seite braucht einen eigenen, beschreibenden Title.",
      recommendation: "Jeder Seite einen eindeutigen Title geben, der ihren spezifischen Inhalt benennt.",
      evidence: [...titelDup.entries()].slice(0, 5).map(([t, u]) => `„${t.slice(0, 50)}“ → ${u.length} Seiten`),
    });
  }

  // --- 4. Doppelte Descriptions -------------------------------------------
  const descDup = dubletten((s) => s.description);
  if (descDup.size > 0) {
    const betroffen = [...descDup.values()].reduce((n, u) => n + u.length, 0);
    findings.push({
      id: "seo.duplicate-descriptions", category: "seo",
      title: `${betroffen} Seiten teilen sich ${descDup.size} Meta-Description${descDup.size === 1 ? "" : "s"}`,
      status: "warn", severity: "low",
      description: "Mehrere Seiten haben dieselbe Meta-Description. Eine eigene Beschreibung je Seite verbessert die Klickrate aus den Suchergebnissen.",
      recommendation: "Für jede Seite eine eigene, zum Inhalt passende Meta-Description schreiben.",
      evidence: [...descDup.entries()].slice(0, 5).map(([d, u]) => `„${d.slice(0, 50)}…“ → ${u.length} Seiten`),
    });
  }

  // --- 5. noindex-Seiten in der Sitemap -----------------------------------
  const noindexInSitemap = html2xx.filter((s) => s.inSitemap && s.noindex);
  if (noindexInSitemap.length > 0) {
    findings.push({
      id: "seo.sitemap-noindex", category: "seo",
      title: `${noindexInSitemap.length} Seite${noindexInSitemap.length === 1 ? "" : "n"} mit „noindex“ in der Sitemap`,
      status: "warn", severity: "medium",
      description: "Die Sitemap sagt Google „indexiere diese Seiten“, die Seiten selbst sagen „noindex“. Ein widersprüchliches Signal, das Crawl-Budget verschwendet und die Sitemap unglaubwürdig macht.",
      recommendation: "Entweder das „noindex“ entfernen (wenn die Seite ranken soll) oder die URL aus der Sitemap nehmen.",
      evidence: noindexInSitemap.slice(0, 8).map((s) => s.url),
    });
  }

  // --- 6. Verwaiste Seiten (Näherung) -------------------------------------
  const verwaist = html2xx.filter((s) => s.inSitemap && !s.vonStartseiteVerlinkt && s.url !== startNorm);
  if (verwaist.length > 0 && startLinks.size > 0) {
    findings.push({
      id: "seo.orphan-pages", category: "seo",
      title: `${verwaist.length} Seite${verwaist.length === 1 ? "" : "n"} in der Sitemap, aber nicht von der Startseite verlinkt`,
      status: "warn", severity: "low",
      description: "Diese Seiten stehen in der Sitemap, sind aber über die Startseiten-Navigation nicht erreichbar. Intern schwach verlinkte Seiten ranken schlechter. (Näherung: geprüft wurde die Verlinkung ab der Startseite, nicht der komplette interne Linkgraph.)",
      recommendation: "Wichtige Seiten aus der Navigation oder von thematisch passenden Seiten verlinken.",
      evidence: verwaist.slice(0, 8).map((s) => s.url),
    });
  }

  // --- 7. Crawl-Übersicht (immer, als Beleg + Transparenz zum Umfang) ------
  findings.push({
    id: "seo.crawl-summary", category: "seo",
    title: `Website-Crawl: ${erreichbar.length} Seiten geprüft`,
    status: "pass", severity: "info",
    description:
      `Über die Startseite hinaus wurden ${erreichbar.length} weitere Seiten aus Sitemap und interner Verlinkung geprüft` +
      (gedeckelt ? `. Die Website ist größer als der Prüfumfang (${MAX_URLS} Seiten) — die Auswahl deckt Startseite, Sitemap und Startseiten-Links ab.` : ".") +
      " Geprüft wurden Titles, Descriptions, Statuscodes, Weiterleitungen und Indexierbarkeit seitenübergreifend.",
  });

  return findings;
}
