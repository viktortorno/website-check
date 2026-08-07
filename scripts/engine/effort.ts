// Aufwandsschätzung je Befund — und was das Beheben tatsächlich an Punkten bringt.
//
// Warum das hier steht und nicht in den Modulen: Der Aufwand hängt nicht am
// Prüf-Ergebnis, sondern an der Art der Maßnahme. Ein Meta-Tag ergänzen ist
// immer eine Sache von Minuten, egal welche Seite geprüft wurde; eine
// Datenschutzerklärung neu schreiben ist immer ein eigenes Vorhaben. Deshalb
// eine zentrale Zuordnung statt eines weiteren Feldes in 70 Findings — so
// bleibt sie an einer Stelle nachvollziehbar und pflegbar.
//
// Die Zahlen sind ehrliche Erfahrungswerte, keine Kalkulation. Sie sollen die
// Reihenfolge der Arbeit stützen ("was bringt am schnellsten am meisten?"),
// nicht ein Angebot ersetzen — genau so werden sie im Report auch benannt.

import { Category, CategoryGroup, CATEGORY_GROUP, Finding, ScanReport } from "./types";
import { buildScores } from "./scoring";

export type Aufwand = "minuten" | "stunde" | "halber-tag" | "projekt";

export const AUFWAND_LABEL: Record<Aufwand, string> = {
  minuten: "wenige Minuten",
  stunde: "ca. 1 Stunde",
  "halber-tag": "ein halber Tag",
  projekt: "eigenes Vorhaben",
};

// Grobe Sortierung für "das Schnellste zuerst".
const AUFWAND_RANG: Record<Aufwand, number> = {
  minuten: 0, stunde: 1, "halber-tag": 2, projekt: 3,
};

// Rechengröße für "Wirkung pro Stunde". Nach reinem Aufwand zu sortieren war
// die naheliegende, aber falsche Wahl: Dann steht ein fehlender CAA-Record vor
// "Cookies ohne Einwilligung", weil er schneller erledigt ist — und der Kunde
// arbeitet eine Liste von Belanglosigkeiten ab, während der teure Mangel
// unten steht. Geteilt wird deshalb durch die Stunden.
const AUFWAND_STUNDEN: Record<Aufwand, number> = {
  minuten: 0.25, stunde: 1, "halber-tag": 4, projekt: 16,
};

// Zuordnung über die Finding-ID. Reihenfolge egal, es wird exakt verglichen;
// alles Unbekannte fällt auf die Voreinstellung nach Kategorie zurück.
const AUFWAND_JE_ID: Record<string, Aufwand> = {
  // --- Minuten: eine Zeile im Template, ein Eintrag im DNS ---
  "seo.no-title": "minuten",
  "seo.title-short": "minuten",
  "seo.title-long": "minuten",
  "seo.no-description": "minuten",
  "seo.description-short": "minuten",
  "seo.description-long": "minuten",
  "seo.no-canonical": "minuten",
  "seo.noindex": "minuten",
  "seo.no-lang": "minuten",
  "seo.no-viewport": "minuten",
  "seo.viewport-nozoom": "minuten",
  "seo.no-h1": "minuten",
  "seo.multi-h1": "minuten",
  "seo.og-image-nodim": "minuten",
  "seo.no-breadcrumb": "minuten",
  "geo.no-llms-txt": "minuten",
  "geo.no-sitemap": "minuten",
  "geo.no-robots": "minuten",
  "geo.robots-global-block": "minuten",
  "geo.ai-bots-blocked": "minuten",
  "geo.no-date-schema": "minuten",
  "geo.no-sameas": "minuten",
  "security.no-spf": "minuten",
  "security.no-dmarc": "minuten",
  "security.dmarc-monitor": "minuten",
  "security.no-caa": "minuten",
  // Die Header-Findings baut security.ts dynamisch: `security.missing-<key>`
  // für den FEHLENDEN Header, `security.header-<key>` für den gesetzten.
  // Zuerst standen hier die header-IDs — die gibt es zwar, sie stehen aber für
  // "vorhanden" und tauchen im Fahrplan nie auf. Die Angabe fiel damit
  // stillschweigend auf den Kategorie-Default zurück. Ein Test in
  // test/effort.test.ts gleicht die Schlüssel jetzt gegen die Module ab.
  "security.missing-strict-transport-security": "minuten",
  "security.missing-x-content-type-options": "minuten",
  "security.missing-x-frame-options": "minuten",
  "security.missing-referrer-policy": "minuten",
  "security.missing-permissions-policy": "minuten",
  "security.no-https-redirect": "minuten",
  "security.server-leak": "minuten",
  "security.tls-expiring": "minuten",

  // --- Eine Stunde: Konfiguration am Server oder im CMS ---
  "dsgvo.google-fonts": "stunde",
  "dsgvo.cookie-lifetime": "stunde",
  "dsgvo.form-no-privacy-note": "stunde",
  "security.no-mta-sts": "stunde",
  "security.dkim-unknown": "stunde",
  "security.spf-lookup-limit": "stunde",
  "security.cookie-flags": "stunde",
  "security.mixed-content": "stunde",
  "seo.soft-404": "stunde",
  "seo.host-duplicate": "stunde",
  "seo.og-image-broken": "stunde",
  "seo.no-og": "stunde",
  "seo.img-alt": "stunde",
  "seo.anchor-text": "stunde",
  "seo.heading-gaps": "stunde",
  "perf.oversized-images": "stunde",
  "seo.img-dimensions": "stunde",
  "seo.img-format": "stunde",
  "geo.no-entity-schema": "stunde",
  "seo.no-schema": "stunde",

  // --- Halber Tag: Inhalte schreiben oder Technik umbauen ---
  "dsgvo.third-party-embeds": "halber-tag",
  "dsgvo.cookies-without-consent": "halber-tag",
  "dsgvo.pre-consent-tracking": "halber-tag",
  "dsgvo.no-banner": "halber-tag",
  "dsgvo.banner-ineffective": "halber-tag",
  "seo.mobile-overflow": "halber-tag",
  "seo.tap-targets": "halber-tag",
  "seo.thin-content": "halber-tag",
  "geo.no-qa-structure": "halber-tag",
  "geo.few-citable-chunks": "halber-tag",
  "geo.low-fact-density": "halber-tag",
  "geo.no-definitions": "halber-tag",
  "geo.no-sources": "halber-tag",
  "geo.stale-content": "halber-tag",
  "security.missing-content-security-policy": "halber-tag",
  "security.csp-weak": "halber-tag",
  "ai-act.ai-images-unlabeled": "halber-tag",
  "ai-act.ai-services": "halber-tag",
  "ai-act.chatbot-undisclosed": "minuten",
  "ai-act.generator-meta": "minuten",
  "geo.no-eeat": "stunde",
  "dsgvo.no-impressum": "halber-tag",
  "dsgvo.no-privacy": "projekt",
  "perf.requests-many": "halber-tag",
  "perf.dom-large": "halber-tag",
  "perf.weight-bad": "halber-tag",
  "perf.weight-medium": "stunde",
  "perf.lcp-bad": "halber-tag",
  "perf.lcp-medium": "stunde",
  "perf.ttfb-bad": "halber-tag",
  "perf.ttfb-medium": "stunde",
  "perf.cls-bad": "stunde",
  "perf.cls-medium": "stunde",

  // --- Eigenes Vorhaben: fremde Hilfe oder Grundsatzentscheidung nötig ---
  "security.no-https": "projekt",
  "security.tls-expired": "projekt",
  "security.tls-old": "projekt",
  "security.tls-version": "projekt",
  "geo.js-dependency": "projekt",
  "geo.js-dependency-partial": "projekt",
  "geo.bot-blocked-server": "projekt",
  "ai-act.biometrics": "projekt",
};

// Voreinstellung, wenn die ID unbekannt ist: nach Kategorie, weil sich die
// Arbeitsarten dort ähneln. Neue Prüfungen bekommen so einen plausiblen Wert,
// auch wenn jemand vergisst, sie oben einzutragen.
const AUFWAND_JE_KATEGORIE: Record<Category, Aufwand> = {
  dsgvo: "halber-tag",
  security: "stunde",
  "ai-act": "halber-tag",
  accessibility: "halber-tag",
  seo: "stunde",
  geo: "halber-tag",
  performance: "stunde",
  psychology: "halber-tag",
};

export function aufwandVon(f: Finding): Aufwand {
  return AUFWAND_JE_ID[f.id] ?? AUFWAND_JE_KATEGORIE[f.category];
}

export interface Massnahme {
  finding: Finding;
  aufwand: Aufwand;
  punkte: number;          // Gewinn im GESAMTSCORE (kann bei Kleinigkeiten 0 sein)
  punkteKategorie: number; // Gewinn im Score DIESER Kategorie — immer > 0
}

export interface Fahrplan {
  schritte: Massnahme[];
  // Wirkung auf die Gruppe, in der die Schritte liegen — es gibt keine
  // gemeinsame Note mehr, in der man den Gewinn ausdrücken könnte.
  punkteGesamt: number;
  vorher: number | null;
  neuerScore: number | null;
  gruppe: CategoryGroup;
}

/**
 * Was bringt das Beheben — in Punkten, nicht in Gefühlen.
 *
 * Statt den Gewinn zu schätzen, wird er ausgerechnet: Der Befund wird aus der
 * Liste entfernt, das komplette Scoring läuft erneut, die Differenz ist der
 * Gewinn. Damit stimmt die Zahl auch dann, wenn Kategoriegewichte oder die
 * Prüfdichte-Normalisierung später geändert werden — sie ist aus derselben
 * Rechnung abgeleitet wie die angezeigte Note, nicht aus einer zweiten.
 *
 * Grenze der Aussage: Die Einzelgewinne addieren sich nicht exakt zum
 * Gesamtgewinn (eine Kategorie kann nicht über 100 steigen). Deshalb wird für
 * den Fahrplan zusätzlich der gemeinsame Effekt gerechnet.
 */
export function baueFahrplan(report: ScanReport, maxSchritte = 5): Fahrplan {
  const alle = report.categories.flatMap((c) => c.findings);
  const offen = alle.filter((f) => f.status !== "pass" && f.severity !== "info");
  const basisKategorie = new Map(report.categories.map((c) => [c.category, c.score]));
  const basisGruppe = new Map(report.gruppen.map((g) => [g.gruppe, g.score]));

  // Alle Kategorien, die im Bericht bewertet wurden — nur die dürfen in die
  // Neuberechnung, sonst würde ein nicht geprüfter Bereich plötzlich als
  // "geprüft" wieder auftauchen.
  const gelaufen = new Set<Category>(
    report.categories.filter((c) => c.score !== null).map((c) => c.category)
  );

  const bewertet: Massnahme[] = offen.map((f) => {
    const ohne = alle.filter((x) => x !== f);
    const neu = buildScores(ohne, gelaufen, true);
    const gruppe = CATEGORY_GROUP[f.category];
    const kategorieNeu = neu.categories.find((c) => c.category === f.category)?.score ?? null;
    const gruppeNeu = neu.gruppen.find((g) => g.gruppe === gruppe)?.score ?? null;
    const basisK = basisKategorie.get(f.category);
    const basisG = basisGruppe.get(gruppe);
    return {
      finding: f,
      aufwand: aufwandVon(f),
      punkte: gruppeNeu !== null && basisG !== null && basisG !== undefined ? gruppeNeu - basisG : 0,
      punkteKategorie: kategorieNeu !== null && basisK !== null && basisK !== undefined ? kategorieNeu - basisK : 0,
    };
  });

  // Sortiert nach Wirkung PRO STUNDE, nicht nach Aufwand: sonst steht das
  // Belanglose oben, nur weil es schnell geht.
  const wirkungProStunde = (m: Massnahme) =>
    (m.punkte * 3 + m.punkteKategorie) / AUFWAND_STUNDEN[m.aufwand];

  const sortiert = bewertet
    .filter((m) => m.punkteKategorie > 0)
    .sort((a, b) => {
      const diff = wirkungProStunde(b) - wirkungProStunde(a);
      if (Math.abs(diff) > 0.01) return diff;
      return AUFWAND_RANG[a.aufwand] - AUFWAND_RANG[b.aufwand];
    });

  const schritte = sortiert.slice(0, maxSchritte);

  // Die Zusammenfassung bezieht sich auf die Gruppe, in der die MEISTEN
  // Schritte liegen — dort wird der Gewinn sichtbar.
  const gruppe: CategoryGroup =
    schritte.filter((s) => CATEGORY_GROUP[s.finding.category] === "compliance").length >=
    schritte.filter((s) => CATEGORY_GROUP[s.finding.category] === "growth").length
      ? "compliance"
      : "growth";

  const behoben = new Set(schritte.map((s) => s.finding));
  const nachher = buildScores(alle.filter((f) => !behoben.has(f)), gelaufen, true)
    .gruppen.find((g) => g.gruppe === gruppe)?.score ?? null;
  const vorher = basisGruppe.get(gruppe) ?? null;

  return {
    schritte,
    punkteGesamt: nachher !== null && vorher !== null ? nachher - vorher : 0,
    vorher,
    neuerScore: nachher,
    gruppe,
  };
}
