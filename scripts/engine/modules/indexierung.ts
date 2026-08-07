// Indexierungs-Diagnose: Darf diese Seite in den Index, und sind ihre Signale
// widerspruchsfrei?
//
// Das SEO-Modul prüft bereits, OB ein Canonical und ein robots-Meta da sind.
// Dieses Modul prüft, ob sie zusammenpassen — der Bereich, in dem die teuersten
// SEO-Fehler stecken, weil sie unsichtbar sind: Eine Seite rankt einfach nicht,
// und niemand sieht warum.
//
// Vier Signalquellen, die sich widersprechen können:
//   1. robots-Meta im HTML          (<meta name="robots" content="noindex">)
//   2. X-Robots-Tag im HTTP-Header  (dasselbe, nur serverseitig)
//   3. Canonical                    (welche URL ist die maßgebliche?)
//   4. hreflang                     (welche Sprachvariante für wen?)
//
// Ehrliche Grenze, die dieses Modul NICHT überschreitet: Vollständige
// hreflang-Reziprozität hieße, jede verlinkte Sprachvariante abzurufen und zu
// prüfen, ob sie zurückzeigt — bei zwanzig Sprachen zwanzig Extra-Abrufe für
// EINE geprüfte Seite. Das sprengt einen Ein-Seiten-Scan. Geprüft wird deshalb
// die Selbstreferenz (fehlt sie, ignoriert Google das ganze Set — der häufigste
// Fehler) und die Gültigkeit der Sprachcodes. Die Cross-Reziprozität bleibt dem
// späteren Multi-Page-Crawl vorbehalten und ist hier ausdrücklich offen.

import { Finding } from "../types";
import { safeFetch, leseBegrenzt, assertPublicUrl } from "../ssrf";

const BOT_UA = "ComplianceCheckerBot/1.0 (+https://check.viktortorno.de)";

// Absolute, vergleichbare Form einer URL: ohne Fragment, ohne trailing slash-
// Unterschied. Damit "https://x.de/a" und "https://x.de/a/" nicht fälschlich als
// verschiedene Canonical-Ziele gelten.
function normUrl(roh: string, basis: string): string | null {
  try {
    const u = new URL(roh, basis);
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

// robots-Direktiven aus HTML-Meta UND HTTP-Header zusammenführen. Beide zählen;
// Google nimmt die restriktivste. Rückgabe: enthält das Gesamtsignal "noindex"?
function istNoindex(html: string, header: string | null): boolean {
  const meta = firstMatch(html, /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  return /noindex/i.test(meta ?? "") || /noindex/i.test(header ?? "");
}

interface Zielinfo {
  status: number;
  canonical: string | null; // normalisiert
  noindex: boolean;
}

// Das Canonical-Ziel EINMAL nachladen (eine Ebene, nicht rekursiv), um Kette,
// Schleife und ein nicht-indexierbares Ziel zu erkennen.
async function ladeZiel(url: string): Promise<Zielinfo | null> {
  try {
    await assertPublicUrl(url);
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": BOT_UA },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, canonical: null, noindex: false };
    }
    const xRobots = res.headers.get("x-robots-tag");
    const { text } = await leseBegrenzt(res, 150_000);
    const canonRoh = firstMatch(text, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
      ?? firstMatch(text, /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
    return {
      status: res.status,
      canonical: canonRoh ? normUrl(canonRoh, url) : null,
      noindex: istNoindex(text, xRobots),
    };
  } catch {
    return null;
  }
}

// Wie viele Links sind für einen Suchmaschinen-Crawler tatsächlich folgbar?
//
// Ein Crawler folgt einem `href`. Ein `<a>` ohne href, mit href="#" oder mit
// href="javascript:…", das die Navigation per onclick im Browser erledigt, ist
// für ihn eine Sackgasse — die Zielseite wird nie entdeckt. Häufig bei
// JavaScript-lastigen Seiten (SPAs, Baukästen). Google rendert zwar JS, folgt
// solchen Pseudo-Links aber unzuverlässig.
//
// Exportiert und rein (kein Netz), damit direkt testbar.
export interface LinkFolgbarkeit {
  gesamt: number;
  nichtFolgbar: number;
}

export function analysiereLinkFolgbarkeit(html: string): LinkFolgbarkeit {
  let gesamt = 0, nichtFolgbar = 0;
  for (const m of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attr = m[1];
    gesamt++;
    const href = /\shref=["']([^"']*)["']/i.exec(attr)?.[1];
    // Kein href, leeres href, reiner Anker oder javascript:-Pseudolink = tot.
    if (href == null || href.trim() === "" || href.trim() === "#" || /^javascript:/i.test(href.trim())) {
      nichtFolgbar++;
    }
  }
  return { gesamt, nichtFolgbar };
}

export async function runIndexierung(html: string, finalUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  if (!html) return findings;
  const selbst = normUrl(finalUrl, finalUrl);
  if (!selbst) return findings;

  // --- 1. X-Robots-Tag im HTTP-Header -------------------------------------
  // Ein eigener Abruf: Der Browser hat die Header nicht durchgereicht, und das
  // Signal ist wichtig — noindex im Header wirkt genauso wie im Meta, ist aber
  // im Quelltext unsichtbar und wird deshalb ständig übersehen.
  let headerRobots: string | null = null;
  try {
    await assertPublicUrl(finalUrl);
    const res = await safeFetch(finalUrl, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": BOT_UA } });
    headerRobots = res.headers.get("x-robots-tag");
    await res.body?.cancel().catch(() => {});
  } catch { /* Header-Abruf optional — ohne ihn zählt nur das Meta */ }

  const metaRobots = firstMatch(html, /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  const metaNoindex = /noindex/i.test(metaRobots ?? "");
  const headerNoindex = /noindex/i.test(headerRobots ?? "");

  if (headerNoindex) {
    findings.push({
      id: "seo.x-robots-noindex", category: "seo",
      title: "noindex im HTTP-Header (X-Robots-Tag)",
      status: "fail", severity: "high",
      description: `Der Server sendet den Header X-Robots-Tag mit „noindex“ (${headerRobots}). Diese Seite wird aus dem Suchindex ausgeschlossen — im Quelltext ist davon nichts zu sehen, weshalb solche Fälle oft lange unbemerkt bleiben.`,
      recommendation: "Falls die Seite ranken soll: den X-Robots-Tag-Header serverseitig entfernen (nginx/Apache/CDN prüfen).",
      legalRef: undefined,
      evidence: [`X-Robots-Tag: ${headerRobots}`],
    });
  }

  // Widerspruch zwischen den beiden Quellen: nicht schlimmer, aber ein Zeichen
  // für ein Konfigurationsversehen — meist bleibt die restriktivere (noindex)
  // wirksam, und die Absicht ist unklar.
  if (metaNoindex !== headerNoindex && (metaNoindex || headerNoindex)) {
    findings.push({
      id: "seo.robots-conflict", category: "seo",
      title: "Widersprüchliche Index-Signale",
      status: "warn", severity: "low",
      description: `Meta-robots (${metaNoindex ? "noindex" : "index"}) und X-Robots-Tag (${headerNoindex ? "noindex" : "index"}) sagen Unterschiedliches. Google folgt der restriktiveren Angabe — die Seite verhält sich also wie „noindex“, obwohl eine Quelle das Gegenteil sagt.`,
      recommendation: "Beide Quellen auf denselben Stand bringen; die widersprüchliche entfernen.",
    });
  }

  // --- 2. Canonical-Analyse ------------------------------------------------
  const canonRoh = firstMatch(html, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    ?? firstMatch(html, /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const canon = canonRoh ? normUrl(canonRoh, finalUrl) : null;

  if (canon && canon !== selbst) {
    // Diese Seite verweist auf eine ANDERE als die maßgebliche. Das ist
    // legitim (Parameter-Variante, Druckansicht) — aber nur, wenn das Ziel
    // sauber ist. Deshalb einmal nachladen.
    const ziel = await ladeZiel(canon);

    if (!ziel || ziel.status === 0) {
      findings.push({
        id: "seo.canonical-unreachable", category: "seo",
        title: "Canonical-Ziel nicht erreichbar",
        status: "fail", severity: "medium",
        description: `Das Canonical zeigt auf ${canon}, aber diese Adresse antwortet nicht. Google kann das Signal dann nicht auflösen und ignoriert es im Zweifel — die Seite konkurriert mit sich selbst.`,
        recommendation: "Canonical auf eine erreichbare, indexierbare URL setzen (idealerweise die Seite selbst).",
        evidence: [canon],
      });
    } else if (ziel.status >= 400) {
      findings.push({
        id: "seo.canonical-unreachable", category: "seo",
        title: `Canonical-Ziel liefert HTTP ${ziel.status}`,
        status: "fail", severity: "medium",
        description: `Das Canonical zeigt auf ${canon}, das mit Fehlercode ${ziel.status} antwortet. Ein Canonical auf eine Fehlerseite ist ein widersprüchliches Signal.`,
        recommendation: "Canonical auf eine gültige URL (HTTP 200) setzen.",
        evidence: [canon],
      });
    } else if (ziel.noindex) {
      findings.push({
        id: "seo.canonical-noindex", category: "seo",
        title: "Canonical zeigt auf eine noindex-Seite",
        status: "fail", severity: "high",
        description: `Diese Seite erklärt ${canon} zur maßgeblichen Version — doch jene Seite ist selbst auf „noindex“ gesetzt. Damit weist die Seite Google zu einer Adresse, die gar nicht in den Index darf. Ergebnis: keine der beiden rankt.`,
        recommendation: "Entweder das Canonical auf eine indexierbare URL richten oder den noindex am Ziel entfernen.",
        evidence: [canon],
      });
    } else if (ziel.canonical && ziel.canonical === selbst) {
      // A sagt „B ist maßgeblich“, B sagt „A ist maßgeblich“. Google kann sich
      // für keine entscheiden.
      findings.push({
        id: "seo.canonical-loop", category: "seo",
        title: "Canonical-Schleife",
        status: "fail", severity: "high",
        description: `Diese Seite verweist per Canonical auf ${canon}, und jene Seite verweist per Canonical zurück auf diese. Zwei Seiten, die sich gegenseitig zur maßgeblichen erklären — Google löst das nicht auf und indexiert im Zweifel keine.`,
        recommendation: "Genau eine der beiden Seiten zur maßgeblichen bestimmen; die andere muss auf sie zeigen, nicht umgekehrt.",
        evidence: [selbst, canon],
      });
    } else if (ziel.canonical && ziel.canonical !== canon) {
      // A→B, aber B→C. Das Signal führt nicht direkt zum Ziel.
      findings.push({
        id: "seo.canonical-chain", category: "seo",
        title: "Canonical-Kette",
        status: "warn", severity: "medium",
        description: `Diese Seite zeigt per Canonical auf ${canon}, das wiederum auf ${ziel.canonical} zeigt. Canonicals sollen direkt auf die maßgebliche URL verweisen — eine Kette schwächt das Signal, weil Google ihr nicht garantiert bis zum Ende folgt.`,
        recommendation: `Das Canonical direkt auf die endgültige Ziel-URL setzen (${ziel.canonical}).`,
        evidence: [selbst, canon, ziel.canonical],
      });
    } else {
      // Ziel ist sauber und kanonisch — der legitime Normalfall.
      findings.push({
        id: "seo.canonical-cross-ok", category: "seo",
        title: "Canonical auf eine andere, gültige Seite",
        status: "pass", severity: "info",
        description: `Diese Seite verweist als maßgebliche Version auf ${canon}. Jene Seite ist erreichbar, indexierbar und bestätigt sich selbst — ein sauberer Verweis.`,
        evidence: [canon],
      });
    }
  }
  // Der self-referencing-Fall (canon === selbst) und das Fehlen eines Canonicals
  // sind bereits im SEO-Modul abgedeckt — hier nicht doppeln.

  // --- 3. hreflang ---------------------------------------------------------
  const hreflangs = [...html.matchAll(/<link[^>]*rel=["']alternate["'][^>]*hreflang=["']([^"']+)["'][^>]*href=["']([^"']+)["']/gi)]
    .map((m) => ({ lang: m[1].trim(), href: normUrl(m[2], finalUrl) }));
  // Auch die umgekehrte Attribut-Reihenfolge (href vor hreflang) erfassen.
  for (const m of html.matchAll(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*hreflang=["']([^"']+)["']/gi)) {
    const href = normUrl(m[1], finalUrl);
    const lang = m[2].trim();
    if (!hreflangs.some((h) => h.lang === lang && h.href === href)) hreflangs.push({ lang, href });
  }

  if (hreflangs.length > 0) {
    // Gültige Werte: Sprachcode (de, en) optional mit Region (de-DE) oder der
    // Sonderwert x-default. BCP-47 ist reicher, aber diese Form deckt praktisch
    // alle realen hreflang-Angaben ab.
    const GUELTIG = /^([a-z]{2,3}(-[a-z]{2})?|x-default)$/i;
    const ungueltig = hreflangs.filter((h) => !GUELTIG.test(h.lang));
    const hatSelbst = hreflangs.some((h) => h.href === selbst);
    const hatXDefault = hreflangs.some((h) => h.lang.toLowerCase() === "x-default");

    if (ungueltig.length > 0) {
      findings.push({
        id: "seo.hreflang-invalid", category: "seo",
        title: `${ungueltig.length} ungültige${ungueltig.length === 1 ? "r" : ""} hreflang-Wert${ungueltig.length === 1 ? "" : "e"}`,
        status: "warn", severity: "medium",
        description: `Diese hreflang-Angaben sind keine gültigen Sprachcodes: ${ungueltig.map((u) => u.lang).join(", ")}. Google ignoriert fehlerhafte Einträge stillschweigend — die betroffene Sprachvariante wird dann nicht zugeordnet.`,
        recommendation: 'Gültige Codes verwenden: Sprache (z. B. „de“) oder Sprache-Region (z. B. „de-AT“), plus „x-default“ für die Fallback-Seite.',
        evidence: ungueltig.map((u) => `${u.lang} → ${u.href ?? "?"}`).slice(0, 6),
      });
    }

    if (!hatSelbst) {
      // Der häufigste hreflang-Fehler überhaupt.
      findings.push({
        id: "seo.hreflang-no-self", category: "seo",
        title: "hreflang ohne Selbstreferenz",
        status: "fail", severity: "medium",
        description: "Das hreflang-Set nennt andere Sprachvarianten, aber nicht diese Seite selbst. Ein gültiges Set muss jede Variante aufführen — inklusive der aktuellen. Fehlt die Selbstreferenz, verwirft Google das komplette Set.",
        recommendation: "Einen hreflang-Eintrag ergänzen, der auf die aktuelle URL mit ihrer eigenen Sprache zeigt.",
        evidence: [selbst],
      });
    } else if (ungueltig.length === 0) {
      findings.push({
        id: "seo.hreflang-ok", category: "seo",
        title: `hreflang gesetzt (${hreflangs.length} Varianten)`,
        status: "pass", severity: "info",
        description: `Es sind ${hreflangs.length} Sprach-/Regionsvarianten ausgezeichnet, die Selbstreferenz ist vorhanden${hatXDefault ? " und ein x-default ist gesetzt" : ""}. Hinweis: Ob jede andere Variante zurückverweist (Reziprozität), prüft dieser Ein-Seiten-Scan nicht.`,
      });
    }

    if (!hatXDefault && hreflangs.length >= 2) {
      findings.push({
        id: "seo.hreflang-no-xdefault", category: "seo",
        title: "Kein x-default im hreflang-Set",
        status: "warn", severity: "low",
        description: "Es fehlt ein „x-default“-Eintrag. Er bestimmt, welche Seite Nutzern ohne passende Sprachvariante gezeigt wird — ohne ihn trifft Google die Wahl selbst.",
        recommendation: 'Einen Eintrag mit hreflang="x-default" auf die Sprachauswahl- oder Hauptseite ergänzen.',
      });
    }
  }

  // --- 4. Crawlbare Links --------------------------------------------------
  // Konservativ: erst ab einem nennenswerten Anteil UND einer Mindestzahl, damit
  // einzelne echte JS-Buttons (Menü-Toggle, Modal-Öffner) keinen Fehlalarm
  // erzeugen. Es geht um Seiten, deren NAVIGATION ohne echte href auskommt.
  const links = analysiereLinkFolgbarkeit(html);
  if (links.gesamt >= 8 && links.nichtFolgbar >= 5 && links.nichtFolgbar > links.gesamt * 0.3) {
    findings.push({
      id: "seo.links-not-crawlable", category: "seo",
      title: `${links.nichtFolgbar} von ${links.gesamt} Links für Suchmaschinen nicht folgbar`,
      status: "warn", severity: "low",
      description: "Diese Links haben kein echtes Ziel (kein href, nur „#“ oder javascript:) und funktionieren allein per JavaScript. Ein Suchmaschinen-Crawler folgt ihnen unzuverlässig — die verlinkten Seiten werden womöglich nicht entdeckt.",
      recommendation: "Navigations- und Inhaltslinks als echte <a href=\"…\"> ausgeben. JavaScript-Verhalten kann zusätzlich per onclick darauf liegen, ersetzt das href aber nicht.",
    });
  }

  return findings;
}
