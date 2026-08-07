// Seitentyp-Erkennung: Was für eine Seite ist das überhaupt?
//
// Anlass ist derselbe wie bei der rechtlichen Anwendbarkeit — nur eine Ebene
// tiefer. Das Conversion-Modul verlangt von JEDER Seite einen klaren
// Handlungs-Button und straft sein Fehlen mit `high`. Auf einer Landingpage ist
// das richtig. Auf einem Impressum, einer Datenschutzerklärung oder einem
// Fachartikel ist ein Verkaufsbutton nicht der Zweck der Seite — der Vorwurf
// dort ist ein Fehlalarm gegen einen völlig korrekten Aufbau.
//
// Die Entwurfsregel ist dieselbe wie überall in dieser Engine:
//
//   IM ZWEIFEL "unbekannt". Nur ein EINDEUTIG erkannter Typ ändert eine Regel.
//
// Ein Detektor, der bei jeder unklaren Seite rät, verschiebt Fehlalarme nur,
// statt sie zu senken. Deshalb erkennt dieses Modul lieber zu selten als zu oft.

import { Finding, Seitentyp } from "./types";

// Reihenfolge = Priorität. Die erste zutreffende Regel gewinnt. Eine
// Rechtsseite kann formal auch wie ein Artikel aussehen (Fließtext, Überschrift)
// — deshalb steht sie zuerst.
export function erkenneSeitentyp(html: string, finalUrl: string): Seitentyp {
  if (!html) return "unbekannt";

  const pfad = (() => {
    try { return new URL(finalUrl).pathname.toLowerCase(); } catch { return ""; }
  })();
  const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ").toLowerCase();
  const title = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").toLowerCase();
  const schemaTypen = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/gi)].map((m) => m[1].toLowerCase());
  const hatSchema = (...t: string[]) => t.some((x) => schemaTypen.includes(x.toLowerCase()));

  // ---- Rechtsseite ---------------------------------------------------------
  // Am eindeutigsten über den Pfad, danach über Überschrift/Titel. Bewusst eng:
  // "datenschutz" im Fließtext einer beliebigen Seite reicht NICHT — nur wenn es
  // das Thema der Seite selbst ist (Pfad oder Überschrift).
  const RECHT_PFAD = /\/(impressum|imprint|datenschutz(erklaerung|erklärung)?|privacy(-policy)?|agb|widerruf|widerrufsbelehrung|nutzungsbedingungen|terms|legal(-notice)?|cookie-?(richtlinie|policy))\/?$/i;
  const RECHT_TITEL = /^(\s*)(impressum|datenschutz|datenschutzerklärung|privacy policy|allgemeine geschäftsbedingungen|agb|widerruf|nutzungsbedingungen|terms of service|cookie-richtlinie)\b/i;
  if (RECHT_PFAD.test(pfad) || RECHT_TITEL.test(h1) || RECHT_TITEL.test(title)) {
    return "rechtsseite";
  }

  // ---- Homepage ------------------------------------------------------------
  // Der Pfad entscheidet allein — eine Startseite ist über nichts anderes so
  // zuverlässig erkennbar wie über die Wurzel.
  if (pfad === "" || pfad === "/") return "homepage";

  // ---- Produkt -------------------------------------------------------------
  if (hatSchema("product", "productgroup") || /\/(produkt|product|artikel-detail)\//i.test(pfad)) {
    return "produkt";
  }

  // ---- Artikel -------------------------------------------------------------
  // Zwei unabhängige Belege nötig, wenn kein Schema vorliegt: das
  // <article>-Element UND ein Veröffentlichungs-/Änderungsdatum. Einzeln ist
  // beides zu schwach — <article> nutzen auch Shops für Produktkacheln.
  const hatArtikelSchema = hatSchema("article", "blogposting", "newsarticle", "techarticle");
  const hatArticleTag = /<article[\s>]/i.test(html);
  const hatDatum = /<time\b[^>]*datetime=/i.test(html)
    || /"date(published|modified)"\s*:/i.test(html)
    || /<meta[^>]*property=["']article:published_time["']/i.test(html);
  const artikelPfad = /\/(blog|news|artikel|article|magazin|ratgeber|post|beitrag)\//i.test(pfad);
  if (hatArtikelSchema || (hatArticleTag && hatDatum) || (artikelPfad && hatDatum)) {
    return "artikel";
  }

  // ---- Kontakt -------------------------------------------------------------
  if (/\/(kontakt|contact|anfahrt)\/?$/i.test(pfad) || /^(\s*)(kontakt|kontaktiere|contact)\b/i.test(h1)) {
    return "kontakt";
  }

  // ---- Kategorie / Übersicht ----------------------------------------------
  if (hatSchema("collectionpage", "itemlist") || /\/(kategorie|category|shop|produkte|products|leistungen|services)\/?$/i.test(pfad)) {
    return "kategorie";
  }

  return "unbekannt";
}

// Findings an den erkannten Seitentyp anpassen — analog wendeGeltungAn in
// kontext.ts. Gibt eine NEUE Liste zurück, verändert nichts an Ort und Stelle.
//
// Es wird ausschließlich ENTSCHÄRFT, nie verschärft. Eine schärfere Regel auf
// einem bestimmten Seitentyp wäre eine neue Behauptung — und neue Behauptungen
// gehören belegt in ein Modul, nicht als Nebeneffekt in die Typ-Erkennung.
export function wendeSeitentypAn(findings: Finding[], typ: Seitentyp): Finding[] {
  if (typ === "unbekannt") return findings;

  return findings.map((f) => {
    const angepasst = passeFindingAn(f, typ);
    return angepasst ?? f;
  });
}

// Die eigentliche Tabelle: welcher Befund auf welchem Typ wie herabgestuft wird.
// null = keine Änderung. Bewusst als Funktion mit Kommentaren statt als
// Daten-Tabelle, weil jede Zeile eine fachliche Begründung braucht.
function passeFindingAn(f: Finding, typ: Seitentyp): Finding | null {
  // Conversion-Erwartungen gelten für Seiten, die etwas verkaufen oder zu einer
  // Handlung führen sollen — nicht für Pflicht- und Lesetexte.
  const conversionEntfaellt = typ === "rechtsseite";

  if (conversionEntfaellt && f.category === "psychology" && f.status !== "pass") {
    return {
      ...f,
      status: "pass",
      severity: "info",
      description:
        f.description +
        " (Diese Seite ist als Pflicht-/Rechtstext erkannt — Conversion-Elemente wie ein Verkaufsbutton sind hier nicht ihr Zweck und werden nicht bewertet.)",
    };
  }

  // Ein Fachartikel führt Leser zum Text, nicht zur Kasse. Ein fehlender harter
  // CTA ist dort kein `high`-Mangel — er bleibt ein Hinweis, weil ein dezenter
  // Handlungspfad am Textende trotzdem hilft.
  if (typ === "artikel" && f.id === "psy.no-cta") {
    return {
      ...f,
      status: "warn",
      severity: "low",
      description:
        f.description +
        " Hinweis: Diese Seite ist als Artikel erkannt. Ein Artikel muss nicht verkaufen — ein dezenter Handlungspfad am Ende genügt.",
    };
  }

  // Ein Breadcrumb-Schema zeigt Google den Pfad zur Seite. Die Startseite IST
  // der Pfad — sie hat keinen Vorgänger. Dort ist das Fehlen belanglos.
  if (typ === "homepage" && f.id === "seo.no-breadcrumb") {
    return {
      ...f,
      status: "pass",
      severity: "info",
      description: "Auf der Startseite ist ein Breadcrumb-Pfad ohne Bedeutung — sie steht an der Wurzel und hat keinen übergeordneten Pfad.",
    };
  }

  return null;
}
