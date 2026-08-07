// Rechtsseiten-Modul: öffnet Impressum und Datenschutzerklärung WIRKLICH
// und prüft die Pflichtangaben im Text.
//
// Warum eigenes Modul: content.ts erkennt nur, ob ein Link existiert. Der
// häufigste echte Mangel in der Praxis ist aber nicht der fehlende Link,
// sondern die dahinterliegende Seite — Impressum ohne ladungsfähige Anschrift,
// Datenschutzerklärung ohne Betroffenenrechte, oder ein Link, der ins Leere
// zeigt. Genau das prüft dieses Modul.
//
// Abgerufen wird ausschließlich über safeFetch (IP-Prüfung vor jedem
// Redirect-Hop) und nur auf demselben Origin wie die gescannte Seite.

import { Finding } from "../types";
import { safeFetch, leseBegrenzt } from "../ssrf";

// Kandidaten-Pfade, falls die Startseite gar nicht verlinkt (häufig bei
// Seiten, die die Rechtsseiten nur im Footer-Script nachladen).
const IMPRESSUM_FALLBACKS = ["/impressum", "/impressum.html", "/imprint", "/legal"];
const PRIVACY_FALLBACKS = ["/datenschutz", "/datenschutzerklaerung", "/datenschutz.html", "/privacy", "/privacy-policy"];

// HTML zu reinem Text machen: Skripte/Styles raus, Tags weg, Entities lösen.
// Bewusst simpel — wir suchen nach Stichworten, nicht nach Struktur.
function toText(html: string): string {
  return stripTags(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " "));
}

// Wie toText, aber MIT den Inhalten von <script>/<template>.
//
// Warum das nötig ist: Viele One-Pager legen Impressum und Datenschutz in einen
// Template-Block und blenden sie per Klick in ein Modal ein. Im gerenderten DOM
// steht der Text dann nicht — die Erklärung EXISTIERT aber. Ohne diese zweite
// Sicht meldet die Prüfung "nicht auffindbar", obwohl der Kunde alles korrekt
// hinterlegt hat. Ein falscher Rechtsbefund ist schlimmer als gar keiner.
function rawText(html: string): string {
  return stripTags(html);
}

// Pure Hilfsfunktion für Tests: welche Pflichtangaben fehlen im Text?
export function missingFields(checks: { label: string; re: RegExp }[], text: string): string[] {
  return checks.filter((c) => !c.re.test(text)).map((c) => c.label);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(auml|ouml|uuml|szlig);/gi, (m) => ({ "&auml;": "ä", "&ouml;": "ö", "&uuml;": "ü", "&szlig;": "ß" }[m.toLowerCase()] || m))
    .replace(/\s+/g, " ")
    .trim();
}

// Alle Links der Startseite nach einem Muster durchsuchen und absolut auflösen.
function findLink(html: string, pattern: RegExp, base: string): string | null {
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, " ");
    // javascript:, mailto: und leere Ziele führen nirgendwohin.
    if (!href || /^(javascript:|mailto:|tel:)/i.test(href)) continue;
    if (pattern.test(href) || pattern.test(text)) {
      try {
        const abs = new URL(href, base);
        // Nur derselbe Origin — ein Impressum auf fremder Domain (z.B. ein
        // Anbieter-Portal) prüfen wir nicht, das wäre eine fremde Seite.
        if (abs.origin === new URL(base).origin) return abs.toString();
      } catch { /* kaputter href */ }
    }
  }
  return null;
}

// Zeigt der Link auf die Startseite selbst (One-Pager mit Anker oder Modal)?
// Ohne diese Prüfung würde die Startseite als "Datenschutzseite" bewertet und
// die Pflichtangaben im Fließtext der Startseite gesucht — ein Fehlbefund in
// beide Richtungen.
function isSamePage(target: string, finalUrl: string): boolean {
  try {
    const a = new URL(target);
    const b = new URL(finalUrl);
    a.hash = ""; b.hash = "";
    // Trailing Slash vereinheitlichen, sonst gilt "/" != ""
    const norm = (u: URL) => u.origin + u.pathname.replace(/\/$/, "") + u.search;
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

interface PageText {
  ok: boolean;
  status: number;
  text: string; // sichtbarer Text (ohne Script/Style)
  raw: string;  // inklusive Script-/Template-Inhalten
  // true = eine Schutzschicht hat den Abruf abgewehrt (403/429 …). Dann ist
  // ungeklärt, ob die Seite inhaltlich in Ordnung ist — sie fehlt aber nicht.
  geblockt: boolean;
}

// Seite laden; gibt Text + Status zurück. Fehler → leerer Text.
//
// Zwei Anläufe, und der Grund dafür ist ein handfester Fehlbefund: Mit einer
// Bot-Kennung antwortet chip.de auf sein eigenes Impressum mit 403, mit einer
// Browser-Kennung mit 200. Das Modul meldete daraufhin "Datenschutzerklärung
// verlinkt, aber nicht erreichbar" — als critical. Jede Seite hinter einer WAF
// (Cloudflare, Akamai) bekam so einen erfundenen schweren Mangel.
//
// Deshalb: erst ehrlich als ComplianceCheckerBot fragen, und nur wenn die
// Abwehr zuschlägt, mit einer Browser-Kennung nachfassen. Bleibt es dabei,
// unterscheidet der Aufrufer "blockiert" von "nicht vorhanden" (siehe geblockt).
const BOT_UA = "ComplianceCheckerBot/1.0 (+https://check.viktortorno.de)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
// Statuscodes, die eine Abwehr signalisieren — nicht das Fehlen der Seite.
const ABWEHR = [401, 403, 405, 406, 418, 429, 503];

async function ladeMit(url: string, ua: string): Promise<PageText> {
  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": ua },
    });
    if (!res.ok) return { ok: false, status: res.status, text: "", raw: "", geblockt: ABWEHR.includes(res.status) };
    const html = (await leseBegrenzt(res, 400_000)).text;
    return { ok: true, status: res.status, text: toText(html), raw: rawText(html), geblockt: false };
  } catch {
    return { ok: false, status: 0, text: "", raw: "", geblockt: false };
  }
}

async function loadPage(url: string): Promise<PageText> {
  const erst = await ladeMit(url, BOT_UA);
  if (erst.ok || !erst.geblockt) return erst;
  const zweit = await ladeMit(url, BROWSER_UA);
  // Auch der zweite Versuch abgewehrt → als "blockiert" markieren, damit der
  // Aufrufer daraus keinen inhaltlichen Mangel macht.
  return zweit.ok ? zweit : { ...zweit, geblockt: true };
}

interface Resolved {
  url: string;
  page: PageText;
  inline: boolean; // true = Angaben stehen auf der Startseite (One-Pager)
}

// Erst den verlinkten Pfad, dann die üblichen Fallback-Pfade probieren.
async function resolvePage(
  html: string, finalUrl: string, origin: string, linkPattern: RegExp, fallbacks: string[],
  erwartet: "impressum" | "datenschutz" = "impressum"
): Promise<Resolved | null> {
  const linked = findLink(html, linkPattern, origin);

  if (linked) {
    // One-Pager: Der Link zeigt auf die Startseite selbst (Anker oder Modal).
    //
    // Hier reicht das gerenderte DOM allein NICHT. Beide Richtungen kommen vor:
    //   - Der Text wird per JavaScript aufgebaut  → steht nur im DOM
    //   - Der Text steht im ausgelieferten HTML, JS baut die Seite aber um
    //     → steht nur in der Server-Antwort und fehlt im DOM
    // Geprüft wird deshalb die Summe aus beidem. Sonst meldet das Tool eine
    // vorhandene Datenschutzerklärung als fehlend — der teuerste Fehler, den
    // ein Compliance-Report machen kann.
    if (isSamePage(linked, finalUrl)) {
      const served = await loadPage(finalUrl);
      return {
        url: linked,
        inline: true,
        page: {
          ok: true,
          status: 200,
          text: toText(html) + " " + served.text,
          raw: rawText(html) + " " + served.raw,
          geblockt: false,
        },
      };
    }
    // Verlinkt, aber ggf. nicht ladbar → auch das ist ein Befund.
    return { url: linked, inline: false, page: await loadPage(linked) };
  }

  // Der Fallback probiert die üblichen Pfade durch, wenn kein Link gefunden
  // wurde. Vorher genügte dafür "HTTP 200 und mehr als 200 Zeichen" — und
  // damit qualifizierte sich jede Seite, die auf unbekannte Pfade mit einer
  // gestalteten 200er-Antwort reagiert (Soft-404, SPA-Fallback, Startseite).
  // Der Bericht bewertete dann die Startseite als Impressum.
  //
  // Jetzt muss der Text auch inhaltlich nach einer Rechtsseite aussehen.
  const RECHTSSEITEN_MERKMALE = erwartet === "impressum"
    ? /impressum|anbieterkennzeichnung|verantwortlich\s+(für|i\.?\s?S\.?\s?d\.?)|vertreten durch|umsatzsteuer|handelsregister/i
    : /datenschutz|verarbeitung personenbezogener daten|betroffenenrechte|auftragsverarbeit|rechtsgrundlage|art\.?\s?6\s?(abs|absatz)/i;

  for (const path of fallbacks) {
    const page = await loadPage(origin + path);
    if (!page.ok || page.text.length <= 200) continue;
    if (!RECHTSSEITEN_MERKMALE.test(page.text)) continue; // sieht nicht danach aus
    return { url: origin + path, inline: false, page };
  }
  return null;
}

// --- Pflichtangaben Impressum (§ 5 DDG) ---
// Jede Angabe: Bezeichnung + Erkennungsmuster im Text.
// Exportiert für Fixture-Tests (test/legalpages.test.ts) — die Regexes sind
// der Teil, der beim Selbsttest tatsächlich gebrochen ist.
export const IMPRESSUM_CHECKS: { label: string; re: RegExp }[] = [
  // Straße mit Hausnummer, z.B. "Musterweg 12a"
  { label: "Anschrift (Straße & Hausnummer)", re: /\b[A-ZÄÖÜ][a-zäöüß.\-]{2,}(straße|strasse|str\.|weg|allee|platz|gasse|ring|damm|ufer)\s*\d+/i },
  // PLZ + Ort
  { label: "PLZ und Ort", re: /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß\-. ]{2,}/ },
  // Kontakt: E-Mail oder Telefon
  { label: "Kontakt (E-Mail oder Telefon)", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(tel(efon)?|fon|phone)[\s.:]*[+()\d][\d\s()/-]{6,}/i },
  // Verantwortlicher / Vertretungsberechtigter
  { label: "Verantwortliche Person", re: /(vertreten durch|geschäftsführer|inhaber|vertretungsberechtigt|verantwortlich(er)? für den inhalt|diensteanbieter)/i },
];

// --- Pflichtangaben Datenschutzerklärung (Art. 13 DSGVO) ---
//
// Nach Selbsttest korrigiert: Die eigene, korrekt formulierte Datenschutz-
// erklärung fiel bei "Verantwortlicher" (Überschrift "1. Verantwortlicher")
// und "Speicherdauer" ("Aufbewahrung: 24 Monate") durch — die Muster waren
// zu eng an bestimmte Formulierungen gebunden. Ein falscher Rechtsbefund
// ist teurer als ein zu großzügiger, deshalb bewusst breiter gefasst.
export const PRIVACY_CHECKS: { label: string; re: RegExp }[] = [
  { label: "Verantwortlicher benannt", re: /\bverantwortliche[rn]?\b/i },
  { label: "Rechtsgrundlage der Verarbeitung", re: /rechtsgrundlage|art(ikel)?\.?\s*6\b|berechtigtes interesse|einwilligung/i },
  { label: "Betroffenenrechte (Auskunft, Löschung)", re: /(recht auf )?(auskunft|berichtigung|löschung|datenübertragbarkeit)/i },
  { label: "Beschwerderecht bei der Aufsichtsbehörde", re: /(aufsichtsbehörde|beschwerde.{0,20}(behörde|datenschutz))/i },
  { label: "Speicherdauer", re: /(speicherdauer|dauer der speicherung|wie lange.{0,30}gespeichert|aufbewahrungsfrist|aufbewahrung|löschfrist|löschen.{0,30}(nach|monat|jahr)|gespeichert.{0,30}(monat|jahr|bis|frist))/i },
];

// Ein Prüfblock für eine Rechtsseite (Impressum ODER Datenschutz).
function evaluatePage(
  kind: "impressum" | "privacy",
  found: Resolved | null,
): Finding[] {
  const isImpressum = kind === "impressum";
  const name = isImpressum ? "Impressum" : "Datenschutzerklärung";
  const idBase = isImpressum ? "dsgvo.impressum" : "dsgvo.privacy";
  const legalRef = isImpressum ? "§ 5 DDG (ehem. § 5 TMG)" : "Art. 13 DSGVO";

  // Gar nicht auffindbar → content.ts meldet bereits den fehlenden Link,
  // hier kein doppeltes Finding.
  if (!found) return [];

  // Abwehr statt Antwort: Die Seite existiert womöglich einwandfrei, ein
  // Schutzdienst lässt den Prüfer nur nicht durch. Das als fehlende Pflichtseite
  // zu werten, wäre eine Behauptung ins Blaue — deshalb ein ehrlicher Hinweis
  // ohne Schuldzuweisung.
  if (!found.page.ok && found.page.geblockt) {
    return [{
      id: `${idBase}-blocked`,
      category: "dsgvo",
      title: `${name} konnte nicht geprüft werden`,
      status: "warn",
      severity: "info",
      description: `Der Abruf der ${name}-Seite wurde vom Server abgewehrt (HTTP ${found.page.status}) — vermutlich durch einen Schutzdienst wie Cloudflare. Ob die Pflichtangaben vollständig sind, ließ sich deshalb nicht feststellen; ein Mangel ist das für sich genommen nicht.`,
      recommendation: `Die Seite im Browser gegenprüfen. Falls auch echte Besucher betroffen sind, den Schutzdienst nachjustieren.`,
      evidence: [found.url],
    }];
  }

  // Verlinkt, aber die Seite lädt nicht (404, Timeout, Serverfehler).
  if (!found.page.ok) {
    return [{
      id: `${idBase}-unreachable`,
      category: "dsgvo",
      title: `${name} verlinkt, aber nicht erreichbar`,
      status: "fail",
      severity: isImpressum ? "high" : "critical",
      description: `Der Link zum ${name} führt auf eine Seite, die nicht geladen werden konnte${found.page.status ? ` (HTTP ${found.page.status})` : ""}. Rechtlich zählt das wie eine fehlende Pflichtseite.`,
      recommendation: `Ziel des ${name}-Links prüfen und korrigieren.`,
      legalRef,
      evidence: [found.url],
    }];
  }

  // Auffällig kurz = meist eine Platzhalter-Seite.
  if (found.page.text.length < 200) {
    return [{
      id: `${idBase}-empty`,
      category: "dsgvo",
      title: `${name} praktisch leer`,
      status: "fail",
      severity: isImpressum ? "high" : "critical",
      description: `Die ${name}-Seite enthält kaum Text (${found.page.text.length} Zeichen) — vermutlich ein Platzhalter.`,
      recommendation: `Vollständige Pflichtangaben ergänzen.`,
      legalRef,
      evidence: [found.url],
    }];
  }

  const checks = isImpressum ? IMPRESSUM_CHECKS : PRIVACY_CHECKS;
  const missing = checks.filter((c) => !c.re.test(found.page.text)).map((c) => c.label);
  // Wo wurde geprüft? Für den Kunden ist der Unterschied wichtig: eigene
  // Unterseite oder Angaben direkt auf der Startseite.
  const where = found.inline
    ? "Die Angaben stehen auf der Startseite (eigene Seite fehlt oder wird nur per Anker verlinkt)"
    : `Die ${name}-Seite wurde geöffnet`;

  if (missing.length === 0) {
    return [{
      id: `${idBase}-complete`,
      category: "dsgvo",
      title: `${name}: Pflichtangaben vollständig`,
      status: "pass",
      severity: "info",
      description: `${where} und enthält alle ${checks.length} geprüften Pflichtangaben.`,
      evidence: [found.url],
    }];
  }

  // Im sichtbaren Text steht nichts. Bevor daraus ein harter Befund wird:
  // Steckt der Inhalt in einem Script-/Template-Block, den die Seite per Klick
  // einblendet? Dann ist die Erklärung vorhanden, nur nicht statisch prüfbar.
  if (missing.length === checks.length) {
    const hiddenHits = checks.filter((c) => c.re.test(found.page.raw)).length;
    if (hiddenHits >= 2) {
      return [{
        id: `${idBase}-dynamic`,
        category: "dsgvo",
        title: `${name} wird per JavaScript eingeblendet`,
        status: "warn",
        severity: "low",
        description: `Der Inhalt liegt in einem Skript- oder Template-Block und erscheint erst nach einem Klick. Er ist damit vorhanden, aber automatisch nicht vollständig prüfbar — auch Suchmaschinen und Screenreader erreichen ihn schlechter.`,
        recommendation: `${name} zusätzlich als eigene, direkt aufrufbare Seite bereitstellen.`,
        legalRef,
        evidence: [found.url],
      }];
    }

    // Kein Inhalt, auch nicht versteckt: Der Link erweckt nur den Anschein
    // einer Pflichtseite. Das ist ein härterer Befund als "Angaben fehlen".
    if (found.inline) {
      return [{
        id: `${idBase}-missing`,
        category: "dsgvo",
        title: `${name} nicht auffindbar`,
        status: "fail",
        severity: isImpressum ? "high" : "critical",
        description: `Es gibt einen ${name}-Link, er führt aber nur auf die Startseite zurück, und dort steht keine der ${checks.length} geprüften Pflichtangaben.`,
        recommendation: `Eigene ${name}-Seite anlegen und von jeder Seite darauf verlinken.`,
        legalRef,
        evidence: [found.url],
      }];
    }
  }

  // Vorsichtsbremse gegen ein Fehlurteil bei clientseitig gerenderten Seiten.
  //
  // chip.de liefert unter seiner Impressum-URL 2686 Zeichen Gerüst aus und holt
  // den eigentlichen Text per JavaScript nach. Dieses Modul ruft die Seite mit
  // fetch ab, nicht im Browser — es SIEHT die Anschrift also nicht und meldete
  // "4 Pflichtangaben fehlen" als fail/high. Eine echte, nur lückenhafte
  // Rechtsseite ist dagegen fast immer deutlich länger als 3500 Zeichen.
  //
  // In dieser Konstellation wird daraus ein Hinweis statt eines Vorwurfs: Was
  // wir wissen, ist "im ausgelieferten HTML nicht gefunden" — nicht "fehlt".
  const wirktClientseitig = missing.length >= checks.length / 2 && found.page.text.length < 3500;
  if (wirktClientseitig) {
    return [{
      id: `${idBase}-client-rendered`,
      category: "dsgvo",
      title: `${name} nicht abschließend prüfbar (Inhalt lädt per JavaScript)`,
      status: "warn",
      severity: "medium",
      description: `Die ${name}-Seite liefert nur ${found.page.text.length} Zeichen aus und baut ihren Inhalt offenbar erst im Browser auf. Im ausgelieferten HTML fehlen ${missing.length} der ${checks.length} Pflichtangaben — ob sie im gerenderten Zustand vorhanden sind, lässt sich hier nicht feststellen. Unabhängig davon gilt: Was erst JavaScript einblendet, erreichen Suchmaschinen, Screenreader und Aufsichtsbehörden-Werkzeuge schlechter.`,
      recommendation: `${name} serverseitig ausliefern, damit die Pflichtangaben ohne JavaScript im Quelltext stehen. Im Browser gegenprüfen: ${missing.join(", ")}.`,
      legalRef,
      evidence: [found.url, `nur ${found.page.text.length} Zeichen im ausgelieferten HTML`],
    }];
  }

  // Fehlt mehr als die Hälfte, ist die Seite als Ganzes unbrauchbar.
  const severe = missing.length > checks.length / 2;
  return [{
    id: `${idBase}-incomplete`,
    category: "dsgvo",
    title: `${name}: ${missing.length} Pflichtangabe(n) fehlen`,
    status: severe ? "fail" : "warn",
    severity: severe ? "high" : "medium",
    description: `${where}, aber folgende Pflichtangaben waren nicht auffindbar: ${missing.join(", ")}. Automatische Textprüfung — bei ungewöhnlicher Formulierung kann eine Angabe übersehen werden.`,
    recommendation: `Fehlende Angaben ergänzen und ${isImpressum ? "die ladungsfähige Anschrift" : "die Betroffenenrechte"} klar benennen.`,
    legalRef,
    evidence: [found.url, ...missing.map((m) => `fehlt: ${m}`)],
  }];
}

export async function runLegalPages(html: string, finalUrl: string): Promise<Finding[]> {
  if (!html) return [];
  const origin = (() => { try { return new URL(finalUrl).origin; } catch { return ""; } })();
  if (!origin) return [];

  const [impressum, privacy] = await Promise.all([
    resolvePage(html, finalUrl, origin, /impressum|imprint/i, IMPRESSUM_FALLBACKS, "impressum"),
    resolvePage(html, finalUrl, origin, /datenschutz|privacy/i, PRIVACY_FALLBACKS, "datenschutz"),
  ]);

  return [
    ...evaluatePage("impressum", impressum),
    ...evaluatePage("privacy", privacy),
  ];
}
