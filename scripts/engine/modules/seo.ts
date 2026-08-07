// SEO-Modul: klassische Suchmaschinen-Optimierung — arbeitet auf dem bereits
// geladenen HTML (kein 2. Browserstart). Prüft die On-Page-Signale, die
// Google & Co. zum Verstehen und Ranken einer Seite brauchen:
//   Title, Meta-Description, Überschriften-Hierarchie, Canonical,
//   Open Graph / Social Cards, strukturierte Daten, Indexierbarkeit, Bild-SEO.
//
// Bewusst nur heuristisch & deterministisch (kein externes Ranking-API),
// passend zur Engine-Philosophie. Backlink-/Keyword-Tools wären ein
// separater, kostenpflichtiger Datenlieferant.

import { Finding } from "../types";
import { assertPublicUrl } from "../ssrf";
import type { MobilMetriken } from "./browser";

// Hilfsfunktion: ersten Match einer Gruppe zurückgeben (oder null).
function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? "").trim() : null;
}

// Statuscode einer URL holen, OHNE Weiterleitungen zu folgen.
//
// safeFetch folgt Redirects (mit IP-Prüfung je Hop) und verbirgt damit genau
// das, was hier interessiert: Leitet die www-Variante um, oder liefert sie eine
// zweite, gleichwertige Seite aus? Deshalb hier bewusst redirect:"manual" —
// die IP-Prüfung davor bleibt, gefolgt wird nicht.
async function statusVon(url: string, timeoutMs = 5000): Promise<{ status: number; location: string | null; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "User-Agent": "ComplianceCheckerBot/1.0 (+https://check.viktortorno.de)" },
    });
    const text = res.status < 400 ? (await res.text()).slice(0, 100_000) : "";
    return { status: res.status, location: res.headers.get("location"), text };
  } catch {
    return { status: 0, location: null, text: "" };
  } finally {
    clearTimeout(t);
  }
}

export async function runSeo(html: string, finalUrl: string, mobil?: MobilMetriken | null): Promise<Finding[]> {
  const findings: Finding[] = [];
  if (!html) return findings;

  // ---------- 1. <title> ----------
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!title) {
    findings.push({ id: "seo.no-title", category: "seo", title: "Kein <title>-Tag", status: "fail", severity: "high", description: "Die Seite hat keinen Seitentitel. Der Title ist das wichtigste On-Page-SEO-Element und der Klick-Anker in den Suchergebnissen.", recommendation: "Einen prägnanten <title> (ca. 50–60 Zeichen) mit dem Haupt-Keyword und der Marke vergeben." });
  } else {
    const len = title.length;
    if (len < 30) {
      findings.push({ id: "seo.title-short", category: "seo", title: `Title zu kurz (${len} Zeichen)`, status: "warn", severity: "low", description: `Der Titel „${title}” ist kurz und verschenkt Platz für relevante Keywords.`, recommendation: "Title auf ca. 50–60 Zeichen ausbauen (Thema + Nutzen + Marke)." });
    } else if (len > 65) {
      findings.push({ id: "seo.title-long", category: "seo", title: `Title zu lang (${len} Zeichen)`, status: "warn", severity: "low", description: "Google schneidet Titel über ~60 Zeichen in den Suchergebnissen ab.", recommendation: "Title auf ca. 50–60 Zeichen kürzen, Wichtigstes nach vorne." });
    } else {
      findings.push({ id: "seo.title-ok", category: "seo", title: "Seitentitel vorhanden", status: "pass", severity: "info", description: `Title-Länge passt (${len} Zeichen): „${title}”.` });
    }
  }

  // ---------- 2. Meta-Description ----------
  const desc = firstMatch(html, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    ?? firstMatch(html, /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (!desc) {
    findings.push({ id: "seo.no-description", category: "seo", title: "Keine Meta-Description", status: "fail", severity: "medium", description: "Es fehlt eine Meta-Description. Google nutzt sie als Snippet-Text — fehlt sie, wird ein oft unpassender Auszug generiert, was die Klickrate senkt.", recommendation: 'Eine werbliche Beschreibung (ca. 120–160 Zeichen) als <meta name="description"> ergänzen.' });
  } else {
    const len = desc.length;
    if (len < 70) {
      findings.push({ id: "seo.description-short", category: "seo", title: `Meta-Description sehr kurz (${len} Zeichen)`, status: "warn", severity: "low", description: "Die Beschreibung ist kurz und nutzt den Snippet-Platz nicht aus.", recommendation: "Auf ca. 120–160 Zeichen ausbauen, mit klarem Nutzenversprechen und Call-to-Action." });
    } else if (len > 170) {
      findings.push({ id: "seo.description-long", category: "seo", title: `Meta-Description zu lang (${len} Zeichen)`, status: "warn", severity: "low", description: "Beschreibungen über ~160 Zeichen werden in der Suche abgeschnitten.", recommendation: "Auf ca. 120–160 Zeichen kürzen." });
    } else {
      findings.push({ id: "seo.description-ok", category: "seo", title: "Meta-Description vorhanden", status: "pass", severity: "info", description: `Länge passt (${len} Zeichen).` });
    }
  }

  // ---------- 3. Überschriften-Hierarchie (H1) ----------
  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length === 0) {
    findings.push({ id: "seo.no-h1", category: "seo", title: "Keine H1-Überschrift", status: "fail", severity: "medium", description: "Ohne <h1> fehlt Suchmaschinen das stärkste inhaltliche Themen-Signal der Seite.", recommendation: "Genau eine aussagekräftige <h1> mit dem Hauptthema setzen." });
  } else if (h1s.length > 1) {
    findings.push({ id: "seo.multi-h1", category: "seo", title: `${h1s.length} H1-Überschriften`, status: "warn", severity: "low", description: "Mehrere H1 verwässern das Themen-Signal. Üblich ist genau eine H1 pro Seite.", recommendation: "Auf eine H1 reduzieren, weitere Überschriften als H2/H3 strukturieren." });
  } else {
    findings.push({ id: "seo.h1-ok", category: "seo", title: "Genau eine H1", status: "pass", severity: "info", description: "Eine klare Hauptüberschrift ist vorhanden." });
  }

  // ---------- 4. Canonical-URL ----------
  if (/<link[^>]*rel=["']canonical["']/i.test(html)) {
    findings.push({ id: "seo.canonical-ok", category: "seo", title: "Canonical-Tag gesetzt", status: "pass", severity: "info", description: "Ein <link rel=\"canonical\"> beugt Duplicate-Content-Problemen vor." });
  } else {
    findings.push({ id: "seo.no-canonical", category: "seo", title: "Kein Canonical-Tag", status: "warn", severity: "low", description: "Ohne Canonical kann dieselbe Seite unter mehreren URLs (mit/ohne www, Parameter) als Duplikat gewertet werden.", recommendation: '<link rel="canonical" href="…"> mit der bevorzugten URL setzen.' });
  }

  // ---------- 5. Indexierbarkeit (robots-Meta) ----------
  const robotsMeta = firstMatch(html, /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  if (robotsMeta && /noindex/i.test(robotsMeta)) {
    findings.push({ id: "seo.noindex", category: "seo", title: "Seite auf noindex gesetzt", status: "fail", severity: "high", description: "Das robots-Meta enthält „noindex” — diese Seite wird aus dem Google-Index ausgeschlossen und erscheint nicht in der Suche.", recommendation: "Falls die Seite ranken soll: „noindex” entfernen. (Bei Test-/Danke-Seiten ist es korrekt.)" });
  } else {
    findings.push({ id: "seo.indexable", category: "seo", title: "Seite ist indexierbar", status: "pass", severity: "info", description: "Kein „noindex” gefunden — die Seite darf in den Suchindex aufgenommen werden." });
  }

  // ---------- 6. Open Graph (Social Sharing) ----------
  const hasOgTitle = /<meta[^>]*property=["']og:title["']/i.test(html);
  const hasOgImage = /<meta[^>]*property=["']og:image["']/i.test(html);
  if (hasOgTitle && hasOgImage) {
    findings.push({ id: "seo.og-ok", category: "seo", title: "Open-Graph-Tags vorhanden", status: "pass", severity: "info", description: "Geteilte Links zeigen in Social Media / Messengern eine ansprechende Vorschau (Titel + Bild)." });
  } else {
    findings.push({ id: "seo.no-og", category: "seo", title: "Open-Graph-Vorschau unvollständig", status: "warn", severity: "low", description: `Beim Teilen in Social Media fehlt eine vollständige Vorschau (${!hasOgTitle ? "og:title" : ""}${!hasOgTitle && !hasOgImage ? " & " : ""}${!hasOgImage ? "og:image" : ""} fehlt). Das senkt die Klickrate geteilter Links.`, recommendation: "og:title, og:description und og:image (1200×630 px) im <head> ergänzen." });
  }

  // ---------- 7. Strukturierte Daten (JSON-LD / Schema.org) ----------
  const hasJsonLd = /<script[^>]*type=["']application\/ld\+json["']/i.test(html);
  if (hasJsonLd) {
    const types = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/gi)].map((m) => m[1]);
    const unique = [...new Set(types)];
    findings.push({ id: "seo.schema-ok", category: "seo", title: "Strukturierte Daten (Schema.org) vorhanden", status: "pass", severity: "info", description: `JSON-LD gefunden${unique.length ? ` — Typen: ${unique.slice(0, 8).join(", ")}` : ""}. Das ermöglicht Rich Snippets (Sterne, FAQ, Breadcrumbs) in der Suche.`, evidence: unique });
  } else {
    findings.push({ id: "seo.no-schema", category: "seo", title: "Keine strukturierten Daten", status: "warn", severity: "medium", description: "Es wurde kein JSON-LD (Schema.org) gefunden. Strukturierte Daten helfen Google, Inhalte zu verstehen, und schalten Rich Snippets frei.", recommendation: "Passende Schema.org-Typen als JSON-LD ergänzen (z. B. Organization, LocalBusiness, Article, Product, FAQPage)." });
  }

  // ---------- 8. Bild-SEO (Alt-Texte, auch Ranking-relevant) ----------
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter((t) => !/\salt=/i.test(t));
  if (imgs.length >= 3 && imgsNoAlt.length > imgs.length / 2) {
    findings.push({ id: "seo.img-alt", category: "seo", title: `${imgsNoAlt.length} von ${imgs.length} Bildern ohne Alt-Text`, status: "warn", severity: "low", description: "Alt-Texte beschreiben Bildinhalte — relevant für die Google-Bildersuche und das Seitenverständnis.", recommendation: "Informative Bilder mit beschreibenden alt-Attributen versehen (inkl. relevanter Keywords, ohne Keyword-Stuffing)." });
  }

  // ---------- 9. Aussagekräftige, kurze URL ----------
  try {
    const path = new URL(finalUrl).pathname;
    if (/[A-Z]/.test(path) || /[?&]/.test(finalUrl) && finalUrl.length > 100) {
      findings.push({ id: "seo.url-quality", category: "seo", title: "URL-Struktur verbesserungswürdig", status: "warn", severity: "low", description: "Die URL enthält Großbuchstaben oder viele Parameter. Saubere, sprechende Kleinbuchstaben-URLs sind nutzer- und SEO-freundlicher.", recommendation: "Sprechende, kurze URLs mit Bindestrichen und Keywords verwenden." });
    }
  } catch { /* ignore */ }

  // ---------- 10. Sprachauszeichnung ----------
  // <html lang> steuert, für welchen Sprachraum Google die Seite einordnet, und
  // sagt Screenreadern, wie sie vorlesen sollen. Fehlt häufig bei Baukästen.
  const langAttr = firstMatch(html, /<html[^>]*\slang=["']([^"']+)["']/i);
  if (!langAttr) {
    findings.push({ id: "seo.no-lang", category: "seo", title: "Keine Sprachauszeichnung im <html>-Tag", status: "warn", severity: "medium", description: "Dem <html>-Element fehlt das lang-Attribut. Suchmaschinen ordnen die Seite dann schlechter einem Sprachraum zu, und Screenreader wählen unter Umständen die falsche Aussprache.", recommendation: 'lang="de" (bzw. den passenden Sprachcode) im <html>-Tag setzen.' });
  } else {
    findings.push({ id: "seo.lang-ok", category: "seo", title: `Sprache ausgezeichnet (lang="${langAttr}")`, status: "pass", severity: "info", description: "Das lang-Attribut ist gesetzt — gut für Sprachzuordnung und Screenreader." });
  }

  // ---------- 11. Überschriften-Hierarchie ----------
  // Eine Ebene zu überspringen (H1 → H3) bricht die Gliederung: Suchmaschinen
  // und Screenreader lesen daraus die Struktur des Dokuments.
  const ebenen = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((m) => Number(m[1]));
  const spruenge: string[] = [];
  for (let i = 1; i < ebenen.length; i++) {
    if (ebenen[i] - ebenen[i - 1] > 1) spruenge.push(`H${ebenen[i - 1]} → H${ebenen[i]}`);
  }
  if (spruenge.length > 0) {
    findings.push({ id: "seo.heading-gaps", category: "seo", title: `${spruenge.length} Sprung/Sprünge in der Überschriften-Hierarchie`, status: "warn", severity: "low", description: "Es werden Überschriften-Ebenen übersprungen. Die Gliederung ist damit für Suchmaschinen und Screenreader nicht mehr eindeutig.", recommendation: "Überschriften lückenlos schachteln (H1 → H2 → H3), Größe über CSS statt über die Ebene steuern.", evidence: [...new Set(spruenge)].slice(0, 6) });
  } else if (ebenen.length >= 3) {
    findings.push({ id: "seo.heading-structure-ok", category: "seo", title: "Überschriften sauber geschachtelt", status: "pass", severity: "info", description: `${ebenen.length} Überschriften ohne übersprungene Ebene.` });
  }

  // ---------- 12. Bilder: Maße und Format ----------
  // Fehlende width/height verursachen Layout-Sprünge (CLS, Ranking-Faktor).
  // JPEG/PNG statt WebP/AVIF kostet unnötig Ladezeit.
  if (imgs.length >= 3) {
    const ohneMasse = imgs.filter((t) => !/\swidth=/i.test(t) || !/\sheight=/i.test(t));
    if (ohneMasse.length > imgs.length / 2) {
      findings.push({ id: "seo.img-dimensions", category: "seo", title: `${ohneMasse.length} von ${imgs.length} Bildern ohne width/height`, status: "warn", severity: "low", description: "Ohne feste Maße kennt der Browser den Platzbedarf eines Bildes erst nach dem Laden — der Inhalt springt (Cumulative Layout Shift). CLS ist ein bestätigter Google-Ranking-Faktor.", recommendation: "width und height am <img> angeben (oder aspect-ratio per CSS), auch bei responsiven Bildern." });
    }
    const altFormate = imgs.filter((t) => /\.(jpe?g|png)\b/i.test(t));
    const modern = /\.(webp|avif)\b/i.test(html) || /<source[^>]+type=["']image\/(webp|avif)/i.test(html);
    if (altFormate.length >= 3 && !modern) {
      findings.push({ id: "seo.img-format", category: "seo", title: `${altFormate.length} Bilder in JPEG/PNG statt WebP/AVIF`, status: "warn", severity: "low", description: "Moderne Bildformate sind bei gleicher Qualität deutlich kleiner. Das verkürzt die Ladezeit — und Ladezeit fließt über die Core Web Vitals ins Ranking ein.", recommendation: "Bilder als WebP oder AVIF ausliefern, mit <picture> und JPEG/PNG als Rückfallebene." });
    }
  }

  // ---------- 13. Ankertexte ----------
  // "Hier klicken" sagt weder Google noch einem Screenreader, wohin der Link
  // führt. Der Ankertext ist ein direktes Relevanzsignal für die Zielseite.
  const anker = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const nichtssagend = anker.filter((t) => /^(hier|hier klicken|klick hier|mehr|mehr erfahren|weiterlesen|read more|link|klicken sie hier|more|details)$/i.test(t));
  if (nichtssagend.length >= 3) {
    findings.push({ id: "seo.anchor-text", category: "seo", title: `${nichtssagend.length} nichtssagende Linktexte`, status: "warn", severity: "low", description: "Linktexte wie „hier“, „mehr“ oder „weiterlesen“ beschreiben das Ziel nicht. Der Ankertext ist eines der stärksten Signale dafür, worum es auf der verlinkten Seite geht.", recommendation: "Linktexte benennen lassen, wohin sie führen („Preise für das KI-Audit ansehen“ statt „mehr erfahren“).", evidence: [...new Set(nichtssagend)].slice(0, 5) });
  }

  // ---------- 14. Textmenge ----------
  // Ohne Text kein Ranking: Google braucht Inhalt, um Relevanz zu bewerten.
  const seitenText = html
    .replace(/<(script|style|template|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const worte = seitenText ? seitenText.split(/\s+/).filter(Boolean).length : 0;
  if (worte < 300) {
    findings.push({ id: "seo.thin-content", category: "seo", title: `Wenig Text auf der Seite (${worte} Wörter)`, status: "warn", severity: "medium", description: "Die Seite enthält wenig Fließtext. Suchmaschinen brauchen Inhalt, um Relevanz für eine Suchanfrage zu erkennen — sehr kurze Seiten ranken selten.", recommendation: "Die Kernthemen ausführlich behandeln: Leistung, Ablauf, Ergebnisse, häufige Fragen. Richtwert für eine Startseite: 600–1200 Wörter.", evidence: [`${worte} Wörter im sichtbaren Text`] });
  } else {
    findings.push({ id: "seo.content-length-ok", category: "seo", title: `Ausreichend Text (${worte} Wörter)`, status: "pass", severity: "info", description: "Die Seite hat genug Inhalt, damit Suchmaschinen ihr Thema einordnen können." });
  }

  // ---------- 15. Breadcrumb-Schema ----------
  // Breadcrumbs ersetzen in den Suchergebnissen die nackte URL durch einen
  // lesbaren Pfad — mehr Kontext, höhere Klickrate.
  if (/"@type"\s*:\s*"BreadcrumbList"/i.test(html)) {
    findings.push({ id: "seo.breadcrumb-ok", category: "seo", title: "Breadcrumb-Schema vorhanden", status: "pass", severity: "info", description: "Google zeigt in den Suchergebnissen einen lesbaren Pfad statt der reinen URL." });
  } else {
    findings.push({ id: "seo.no-breadcrumb", category: "seo", title: "Kein Breadcrumb-Schema", status: "warn", severity: "low", description: "Ohne BreadcrumbList-Schema zeigt Google in den Suchergebnissen die nackte URL. Ein lesbarer Pfad gibt Nutzern Orientierung und erhöht die Klickrate.", recommendation: "BreadcrumbList als JSON-LD ergänzen (auf Unterseiten wichtiger als auf der Startseite)." });
  }

  // ---------- 16. Viewport (Grundlage für mobile Darstellung) ----------
  const viewport = firstMatch(html, /<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']+)["']/i);
  if (!viewport) {
    findings.push({ id: "seo.no-viewport", category: "seo", title: "Kein Viewport-Meta-Tag", status: "fail", severity: "high", description: "Ohne Viewport-Angabe rendern Telefone die Seite in Desktop-Breite und zoomen heraus — Text wird unlesbar klein. Google indexiert primär die mobile Fassung (Mobile-First-Indexing).", recommendation: '<meta name="viewport" content="width=device-width, initial-scale=1"> im <head> ergänzen.' });
  } else if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport)) {
    findings.push({ id: "seo.viewport-nozoom", category: "seo", title: "Zoom auf Mobilgeräten unterbunden", status: "warn", severity: "medium", description: "Der Viewport verbietet das Zoomen (user-scalable=no bzw. maximum-scale=1). Das sperrt Menschen mit Sehbeeinträchtigung aus und verstößt gegen WCAG 1.4.4.", recommendation: "user-scalable und maximum-scale aus dem Viewport-Tag entfernen.", evidence: [viewport] });
  } else {
    findings.push({ id: "seo.viewport-ok", category: "seo", title: "Viewport korrekt gesetzt", status: "pass", severity: "info", description: `Die Seite ist für mobile Darstellung vorbereitet (${viewport}).` });
  }

  // ---------- 17. Mobile Darstellung (gemessen, nicht geraten) ----------
  if (mobil && mobil.viewportBreite > 0) {
    // Mehr als 8 px Überhang sind kein Rundungsfehler mehr, sondern ein Element,
    // das aus dem Bild läuft — der Nutzer muss seitlich wischen.
    if (mobil.scrolltSeitlich) {
      findings.push({ id: "seo.mobile-overflow", category: "seo", title: `Seite läuft auf dem Telefon seitlich über (${mobil.inhaltsBreite} px statt ${mobil.viewportBreite} px)`, status: "fail", severity: "medium", description: "Bei 390 px Bildschirmbreite lässt sich die Seite tatsächlich seitlich verschieben (nachgemessen, nicht aus dem Layout geschlossen) — Nutzer müssen horizontal scrollen. Google bewertet primär die mobile Fassung, und seitliches Wischen gilt dort als Usability-Mangel.", recommendation: "Das überlaufende Element eingrenzen (feste Breiten, lange Wörter, Tabellen, Bilder ohne max-width: 100%).", evidence: [`${mobil.scrollWeite} px seitlich verschiebbar`, ...mobil.ueberlaeufer] });
    } else {
      findings.push({ id: "seo.mobile-fits", category: "seo", title: "Seite passt auf den Telefon-Bildschirm", status: "pass", severity: "info", description: "Bei 390 px Breite lässt sich die Seite nicht seitlich verschieben — der Inhalt passt auf den Schirm." });
    }

    // 40 px ist die Untergrenze, ab der ein Ziel mit dem Daumen sicher zu
    // treffen ist (WCAG 2.2 fordert 24 px, Google empfiehlt 48 px).
    if (mobil.zieleGesamt >= 5 && mobil.kleineZiele > mobil.zieleGesamt / 3) {
      findings.push({ id: "seo.tap-targets", category: "seo", title: `${mobil.kleineZiele} von ${mobil.zieleGesamt} Bedienelementen sind kleiner als 40 px`, status: "warn", severity: "low", description: "Viele Links und Knöpfe sind für den Daumen zu klein. Das führt zu Fehlklicks und zählt in Googles mobiler Bewertung als Usability-Problem.", recommendation: "Interaktive Flächen auf mindestens 40 × 40 px bringen (Innenabstand statt größerer Schrift).", evidence: [`${mobil.kleineZiele} von ${mobil.zieleGesamt} unter 40 px`] });
    }
  }

  // ---------- 18-20. Prüfungen, die zusätzliche Abrufe brauchen ----------
  const ogImage = firstMatch(html, /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  let ogImageUrl: string | null = null;
  let altHost: string | null = null;
  let soft404Url: string | null = null;
  try {
    const u = new URL(finalUrl);
    // Nicht existierender Pfad mit fester Kennung: eine Seite MUSS darauf 404
    // antworten. Antwortet sie mit 200, hält Google jede Tippfehler-URL für
    // eine echte Seite und indexiert Dubletten ("Soft 404").
    soft404Url = `${u.origin}/pruefung-nicht-vorhanden-${"seitentest"}-404`;
    // Gegenstück zur aufgerufenen Host-Variante bilden (www ↔ ohne www).
    const host = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    altHost = `${u.protocol}//${host}${u.pathname}`;
    if (ogImage) ogImageUrl = new URL(ogImage, finalUrl).toString();
  } catch { /* unbrauchbare URL → die drei Prüfungen entfallen */ }

  const [soft404, alt, ogBild] = await Promise.all([
    soft404Url ? statusVon(soft404Url) : Promise.resolve(null),
    altHost ? statusVon(altHost) : Promise.resolve(null),
    ogImageUrl ? statusVon(ogImageUrl, 4000) : Promise.resolve(null),
  ]);

  if (soft404 && soft404.status > 0) {
    if (soft404.status === 200) {
      findings.push({ id: "seo.soft-404", category: "seo", title: "Nicht existierende Seiten antworten mit HTTP 200", status: "fail", severity: "medium", description: "Eine frei erfundene URL liefert den Statuscode 200 statt 404. Suchmaschinen halten damit jede falsch geschriebene Adresse für eine gültige Seite und nehmen beliebig viele Dubletten in den Index auf („Soft 404“).", recommendation: "Für unbekannte Pfade den Statuscode 404 (oder 410) senden — die Fehlerseite darf trotzdem gestaltet sein.", evidence: [`${soft404Url} → HTTP 200`] });
    } else if (soft404.status === 404 || soft404.status === 410) {
      findings.push({ id: "seo.404-ok", category: "seo", title: "Fehlerseiten antworten korrekt", status: "pass", severity: "info", description: `Eine nicht existierende URL liefert HTTP ${soft404.status} — Suchmaschinen erkennen sie zuverlässig als nicht vorhanden.` });
    }
  }

  if (alt && alt.status === 200 && altHost) {
    // 200 ohne Weiterleitung: Die Seite ist unter beiden Hosts erreichbar.
    // Entscheidend ist dann, ob ein Canonical die Dublette auflöst.
    const canonicalAlt = firstMatch(alt.text, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    const zeigtAufHaupt = canonicalAlt ? canonicalAlt.includes(new URL(finalUrl).hostname) : false;
    if (!zeigtAufHaupt) {
      findings.push({ id: "seo.host-duplicate", category: "seo", title: "Seite unter www und ohne www gleichzeitig erreichbar", status: "warn", severity: "medium", description: "Beide Host-Varianten liefern die Seite mit Statuscode 200 aus, ohne per Weiterleitung oder Canonical auf eine bevorzugte Fassung zu zeigen. Suchmaschinen sehen zwei getrennte Websites mit identischem Inhalt — die Signale verteilen sich auf beide.", recommendation: "Eine Variante festlegen und die andere per 301 dorthin weiterleiten.", evidence: [`${altHost} → HTTP 200`] });
    }
  }

  if (ogBild && ogImageUrl) {
    if (ogBild.status >= 400 || ogBild.status === 0) {
      findings.push({ id: "seo.og-image-broken", category: "seo", title: "og:image ist nicht abrufbar", status: "warn", severity: "medium", description: "Das im Open-Graph-Tag angegebene Vorschaubild antwortet nicht mit einem gültigen Status. Geteilte Links erscheinen dann ohne Bild — mit deutlich niedrigerer Klickrate.", recommendation: "Die og:image-URL prüfen (absolute URL, öffentlich erreichbar, 1200×630 px).", evidence: [`${ogImageUrl} → HTTP ${ogBild.status || "keine Antwort"}`] });
    } else if (!/og:image:width/i.test(html)) {
      findings.push({ id: "seo.og-image-nodim", category: "seo", title: "og:image ohne Größenangabe", status: "warn", severity: "low", description: "Das Vorschaubild ist erreichbar, aber ohne og:image:width/height. Manche Plattformen zeigen die Vorschau dann verzögert oder klein an.", recommendation: "og:image:width (1200) und og:image:height (630) ergänzen." });
    } else {
      findings.push({ id: "seo.og-image-ok", category: "seo", title: "Vorschaubild abrufbar", status: "pass", severity: "info", description: "Das og:image ist erreichbar und mit Maßen ausgezeichnet — geteilte Links zeigen eine vollständige Vorschau." });
    }
  }

  return findings;
}
