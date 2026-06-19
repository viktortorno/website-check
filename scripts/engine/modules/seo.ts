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

// Hilfsfunktion: ersten Match einer Gruppe zurückgeben (oder null).
function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? "").trim() : null;
}

export function runSeo(html: string, finalUrl: string): Finding[] {
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

  return findings;
}
