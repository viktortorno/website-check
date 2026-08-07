// Rechtliche Anwendbarkeit: Für WEN gilt das, was hier gemessen wird?
//
// Der Anlass ist ein handfester Vorwurf aus dem externen Review: Das Werkzeug
// hat Barrierefreiheit als BFSG-Pflicht bewertet — bei jeder Seite, auch bei
// einer dreiseitigen B2B-Visitenkarte eines Zweipersonenbetriebs, für die das
// BFSG schlicht nicht gilt. Ein Mangel, der keiner ist, ist kein kleiner
// Fehler; er ist der Unterschied zwischen Prüfbericht und Verkaufsdruck.
//
// Von außen ist das nicht messbar. Ob jemand an Verbraucher verkauft, wie viele
// Beschäftigte er hat und aus welchem Land er betreibt, weiß nur er selbst.
// Also wird gefragt — freiwillig, in vier Klicks, mit "weiß nicht" als Standard.
//
// Die zentrale Entwurfsregel dabei:
//
//   NUR "gilt-nicht" NIMMT AUS DER BEWERTUNG. "unklar" wird ganz normal
//   bewertet und bekommt einen Vorbehalt dazugeschrieben.
//
// Sonst hätte der Normalfall — niemand füllt etwas aus — plötzlich einen
// leeren Report zur Folge, und die Abfrage wäre eine Hürde statt einer
// Präzisierung.

import { Category, Finding, GeltungsUrteil, ScanKontext } from "./types";

// Der Standard: nichts angegeben. Bewertet wird dann wie bisher, nur mit
// ausgewiesenem Vorbehalt — die Abfrage ist eine Präzisierung, keine Hürde.
export const KONTEXT_UNBEKANNT: ScanKontext = {
  land: "unbekannt",
  zielgruppe: "unbekannt",
  groesse: "unbekannt",
  angebot: "unbekannt",
};

// Wurde überhaupt etwas angegeben? Steuert, ob der Report den Vorbehalt
// ausführlich erklärt oder nur kurz erwähnt.
export function kontextAngegeben(k: ScanKontext): boolean {
  return k.land !== "unbekannt" || k.zielgruppe !== "unbekannt" || k.groesse !== "unbekannt" || k.angebot !== "unbekannt";
}

// Fremden Input (JSON aus dem Browser) auf gültige Werte zurechtstutzen.
// Unbekannte Zeichenketten werden zu "unbekannt", nicht zu einem Fehler — die
// Abfrage ist optional und soll niemals einen Scan verhindern.
export function parseKontext(roh: unknown): ScanKontext {
  const o = (roh && typeof roh === "object" ? roh : {}) as Record<string, unknown>;
  const nimm = <T extends string>(wert: unknown, erlaubt: readonly T[]): T | "unbekannt" =>
    typeof wert === "string" && (erlaubt as readonly string[]).includes(wert) ? (wert as T) : "unbekannt";
  return {
    land: nimm(o.land, ["de", "eu", "ausserhalb"] as const),
    zielgruppe: nimm(o.zielgruppe, ["b2b", "b2c"] as const),
    groesse: nimm(o.groesse, ["kleinst", "ab10"] as const),
    angebot: nimm(o.angebot, ["nur-info", "online-abschluss"] as const),
  };
}

// Stabiler Schlüssel für den Scan-Cache. Ohne ihn bekäme der zweite Nutzer
// derselben URL das Urteil, das zum Kontext des ersten gehört.
export function kontextSchluessel(k: ScanKontext): string {
  return `${k.land}|${k.zielgruppe}|${k.groesse}|${k.angebot}`;
}

// Gilt diese Prüfkategorie für den angegebenen Betreiber?
//
// Die Growth-Kategorien (SEO, GEO, Performance, Conversion) sind keine
// Rechtsfragen — sie gelten immer, im Sinne von "die Aussage ist für jeden
// Betreiber relevant".
export function geltungFuer(category: Category, k: ScanKontext): GeltungsUrteil {
  switch (category) {
    case "accessibility": {
      // BFSG: Umsetzung des European Accessibility Act. Erfasst sind
      // Dienstleistungen im elektronischen Geschäftsverkehr GEGENÜBER
      // VERBRAUCHERN (§ 1 Abs. 3 BFSG). Reine B2B-Angebote fallen nicht
      // darunter; Kleinstunternehmen sind bei Dienstleistungen ausgenommen
      // (§ 3 Abs. 3 BFSG).
      if (k.zielgruppe === "b2b") {
        return {
          geltung: "gilt-nicht",
          grund:
            "Das BFSG erfasst Dienstleistungen an Verbraucher. Nach deiner Angabe richtet sich das Angebot ausschließlich an Geschäftskunden — die Befunde bleiben als Qualitäts- und Reichweitenhinweis stehen, werden aber nicht als Rechtspflicht bewertet.",
        };
      }
      if (k.groesse === "kleinst" && k.angebot !== "online-abschluss") {
        return {
          geltung: "gilt-nicht",
          grund:
            "Kleinstunternehmen (unter 10 Beschäftigte, höchstens 2 Mio. € Jahresumsatz) sind bei Dienstleistungen vom BFSG ausgenommen (§ 3 Abs. 3 BFSG). Die Befunde bleiben als Qualitätshinweis stehen.",
        };
      }
      if (k.zielgruppe === "b2c" && k.angebot === "online-abschluss" && k.groesse === "ab10") {
        return {
          geltung: "gilt",
          grund: "Verbraucher als Zielgruppe, Abschluss online, kein Kleinstunternehmen: Das BFSG ist einschlägig (seit 28.06.2025).",
        };
      }
      return {
        geltung: "unklar",
        grund:
          "Ob das BFSG gilt, hängt von Zielgruppe, Unternehmensgröße und Art des Angebots ab. Ohne diese Angaben lässt es sich von außen nicht feststellen.",
      };
    }

    case "dsgvo": {
      if (k.land === "de" || k.land === "eu") {
        return { geltung: "gilt", grund: "Niederlassung in der EU: Die DSGVO ist unmittelbar anwendbar (Art. 3 Abs. 1)." };
      }
      if (k.land === "ausserhalb") {
        return {
          geltung: "unklar",
          grund:
            "Bei Betrieb außerhalb der EU greift die DSGVO über das Marktortprinzip (Art. 3 Abs. 2) — sobald sich das Angebot an Personen in der EU richtet. Das lässt sich technisch nicht feststellen.",
        };
      }
      return { geltung: "unklar", grund: "Ohne Angabe zum Betreiberland bleibt die Anwendbarkeit offen. Bewertet wird nach EU-Maßstab." };
    }

    case "ai-act": {
      if (k.land === "de" || k.land === "eu") {
        return { geltung: "gilt", grund: "Die Transparenzpflichten des EU AI Act (Art. 50) gelten seit dem 02.08.2026 für Betreiber in der Union." };
      }
      return {
        geltung: "unklar",
        grund:
          "Der AI Act erfasst auch Anbieter außerhalb der Union, sofern das Ergebnis in der Union genutzt wird (Art. 2 Abs. 1 lit. c). Ohne Angabe zum Betreiberland bleibt das offen.",
      };
    }

    case "security":
      return { geltung: "gilt", grund: "Technische Absicherung ist unabhängig vom Rechtsraum relevant; Art. 32 DSGVO verlangt sie zusätzlich für personenbezogene Daten." };

    default:
      return { geltung: "gilt", grund: "" };
  }
}

// Einzelne Befunde, deren Rechtsgrundlage an ein bestimmtes Land gebunden ist.
//
// Das Impressum ist der klarste Fall: § 5 DDG ist deutsches Recht. Ein Betreiber
// in Spanien schuldet kein Impressum nach § 5 DDG — er schuldet die Angaben aus
// Art. 5 der E-Commerce-Richtlinie, umgesetzt im spanischen Recht. Inhaltlich
// ähnlich, aber "Verstoß gegen § 5 DDG" wäre schlicht falsch zitiert.
const LANDGEBUNDEN = /^legal\.(no-imprint|imprint-|no-privacy-policy)/;

export function wendeGeltungAn(findings: Finding[], k: ScanKontext): Finding[] {
  if (k.land !== "ausserhalb") return findings;

  return findings.map((f) => {
    if (!LANDGEBUNDEN.test(f.id) || f.status === "pass") return f;
    // Herabstufen statt entfernen: Die Angabepflicht besteht in fast jedem
    // Rechtsraum, nur nicht in dieser Form und Schärfe.
    return {
      ...f,
      severity: f.severity === "critical" ? "medium" : f.severity,
      description:
        f.description +
        " Hinweis: Nach deiner Angabe wird die Seite außerhalb Deutschlands betrieben. Die zitierte Pflicht aus dem DDG gilt dann nicht unmittelbar; vergleichbare Angabepflichten bestehen in der EU über Art. 5 der E-Commerce-Richtlinie.",
      legalRef: f.legalRef ? `${f.legalRef} (in DE); Art. 5 RL 2000/31/EG` : "Art. 5 RL 2000/31/EG",
    };
  });
}
