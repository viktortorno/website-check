// Scoring-Engine: wandelt rohe Findings in Scores (0–100) und Noten (A–F) um.
//
// Drei Regeln, die dieses Modul über allem anderen einhält:
//
//   1. NICHT GEPRÜFT IST KEINE NOTE. Eine Kategorie ohne ausgeführte Prüfung
//      bekommt null, nicht 100. Der Score startet zwar bei 100 und zieht ab —
//      aber nur, wenn überhaupt gemessen wurde.
//   2. RECHT UND MARKETING WERDEN NICHT VERRECHNET. Es gibt keine gemeinsame
//      Gesamtnote; gute SEO darf fehlende Pflichtangaben nicht ausgleichen.
//   3. EIN KRITISCHER BEFUND DECKELT DIE NOTE. Wer keine Datenschutzerklärung
//      hat, bekommt keine gute Rechtsnote, egal wie viel anderes stimmt.
//
// Die Strafpunkte unten sind fachlich begründet, nicht auf Wirkung eingestellt.
// Eine frühere Fassung dieses Kommentars beschrieb sie als Stellschraube für
// die Dringlichkeit im Vertrieb. Das war ehrlich gemeint und trotzdem falsch:
// Sobald ein Kunde liest, dass eine Compliance-Bewertung nach Vertriebswirkung
// justiert wurde, ist jede Zahl darin wertlos.

import { Category, CategoryGroup, CategoryResult, CATEGORY_GROUP, Finding, GruppenErgebnis, ScanKontext, ScanStatus, Severity } from "./types";
import { geltungFuer, KONTEXT_UNBEKANNT } from "./kontext";

// Strafpunkte pro nicht bestandenem Finding, gestaffelt nach Schwere.
// "warn" zählt halb so hart wie "fail" (siehe computeCategoryScore).
//
// Maßstab ist die Folge für den Betreiber: critical = unmittelbares Risiko
// (fehlende Pflichtseite, verbotene Verarbeitung), high = klarer Verstoß oder
// offene Angriffsfläche, medium = belegbarer Mangel, low = Verbesserung.
export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 40,
  high: 20,
  medium: 10,
  low: 4,
  info: 0,
};

// Gewichtung INNERHALB einer Gruppe. Die Summe je Gruppe muss nicht 1 ergeben —
// normalisiert wird über die tatsächlich geprüften Kategorien.
export const CATEGORY_WEIGHTS: Record<Category, number> = {
  // Rechtssicherheit & Risiko
  dsgvo: 0.40,
  security: 0.30,
  accessibility: 0.20,
  "ai-act": 0.10,
  // Sichtbarkeit & Conversion
  seo: 0.32,
  geo: 0.25,
  performance: 0.23,
  psychology: 0.20,
};

// Sollwert je Kategorie: die Zahl der Prüfungen, die diese Engine-Version dort
// anstellt. Gemessen wird, wie viel davon zustande kam.
//
// Ein einzelner Sollwert für alle Kategorien hatte einen Nebeneffekt: Wächst
// ein Modul um bestandene Prüfungen, stieg sein Gewicht — die Note verbesserte
// sich, ohne dass sich an einer Website etwas geändert hätte. Beim Erweitern
// eines Moduls diese Zahl mitziehen.
const CATEGORY_CHECK_TARGET: Record<Category, number> = {
  dsgvo: 10,
  security: 17,
  "ai-act": 4,
  accessibility: 3,
  seo: 24,
  geo: 15,
  performance: 4,
  psychology: 7,
};

// Note aus Score ableiten (Schulnoten-Logik, leicht verständlich für Kunden).
export function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  if (score >= 30) return "E";
  return "F";
}

// Obergrenze, wenn ein kritischer Befund vorliegt: bestenfalls "D".
//
// Ohne diese Grenze konnte eine Seite ohne Datenschutzerklärung über viele
// bestandene Nebenprüfungen rechnerisch bei "B" landen. Ein Mangel, der ein
// Bußgeldverfahren auslösen kann, ist kein Punktabzug unter vielen.
const GATE_MAX_SCORE = 44;

// Wie viele PRÜFUNGEN stecken in diesen Findings?
//
// Nicht identisch mit der Zahl der Findings: axe-core meldet pro WCAG-Verstoß
// einen eigenen Eintrag, das ist aber EINE ausgeführte Prüfung. Ohne diese
// Zusammenfassung bekäme eine Seite mit vielen Barrieren mehr "Prüfdichte" —
// und damit mehr Gewicht — als eine saubere. Genau verkehrt herum.
export function zaehlePruefungen(findings: Finding[]): number {
  let axeGesehen = false;
  let n = 0;
  for (const f of findings) {
    if (f.id.startsWith("a11y.axe-")) {
      if (axeGesehen) continue;
      axeGesehen = true;
    }
    n++;
  }
  return n;
}

// Einzelne Kategorie bewerten. null = nicht geprüft.
//
// `gelaufen` entscheidet allein. Die zusätzliche Regel "keine Findings = nicht
// geprüft" sitzt bewusst in buildScores und NICHT hier: Der Fahrplan rechnet
// aus, was das Beheben eines Befundes bringt, und entfernt ihn dazu aus der
// Liste. Läge die Regel hier, würde eine Kategorie mit genau einem Befund
// nach dem simulierten Beheben als "nicht geprüft" gelten statt als "sauber".
export function computeCategoryScore(findings: Finding[], gelaufen = true): number | null {
  if (!gelaufen) return null;

  let score = 100;
  let kritisch = false;
  for (const f of findings) {
    if (f.status === "pass") continue;
    if (f.status === "fail" && f.severity === "critical") kritisch = true;
    const penalty = SEVERITY_PENALTY[f.severity];
    score -= f.status === "warn" ? penalty / 2 : penalty;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return kritisch ? Math.min(score, GATE_MAX_SCORE) : score;
}

// Wie belastbar ist die Aussage dieser Kategorie? 0–1, gemessen an ihrem
// Sollwert — nicht an einer für alle Kategorien gleichen Zahl.
export function confidence(pruefungen: number, category: Category): number {
  const soll = CATEGORY_CHECK_TARGET[category] ?? 5;
  return Math.min(1, pruefungen / soll);
}

// Rangfolge für die Priorisierung: erst nach Status (fail vor warn),
// dann nach Schwere. Damit steht oben, was am meisten kostet.
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

// Die dringendsten Maßnahmen über ALLE Kategorien hinweg.
export function topActions(categories: CategoryResult[], limit = 3): Finding[] {
  return categories
    .flatMap((c) => c.findings)
    .filter((f) => f.status !== "pass" && f.severity !== "info")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "fail" ? -1 : 1;
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    })
    .slice(0, limit);
}

// Alle Findings → Kategorie-Ergebnisse + zwei Gruppenwerte.
//
// `gelaufen` nennt die Kategorien, deren Module tatsächlich ausgeführt wurden.
// Ohne Angabe gelten alle als gelaufen (für Tests und Aufrufer, die den Status
// nicht kennen); der Runner übergibt ihn immer.
export function buildScores(
  allFindings: Finding[],
  gelaufen?: Set<Category>,
  // true = es wird ein "was wäre wenn"-Zustand gerechnet (Fahrplan). Dann
  // bedeutet "keine Findings mehr" nicht "nicht geprüft", sondern "behoben".
  simulation = false,
  // Freiwillige Angaben zum Betreiber. Ohne sie bleibt alles wie bisher —
  // "unbekannt" nimmt nichts aus der Bewertung heraus.
  kontext: ScanKontext = KONTEXT_UNBEKANNT
): {
  categories: CategoryResult[];
  gruppen: GruppenErgebnis[];
  status: ScanStatus;
} {
  const cats: Category[] = ["dsgvo", "security", "ai-act", "accessibility", "seo", "geo", "performance", "psychology"];

  const categories: CategoryResult[] = cats.map((category) => {
    const findings = allFindings.filter((f) => f.category === category);
    const urteil = geltungFuer(category, kontext);
    const imLauf = gelaufen ? gelaufen.has(category) : true;
    // Ohne ausgeführte Prüfung gibt es keine Aussage — außer in der Simulation,
    // wo eine leere Kategorie "alles behoben" heißt.
    //
    // "gilt-nicht" wirkt hier genauso wie "nicht gelaufen": keine Note. Der
    // Unterschied steckt allein im Feld geltung, damit die Darstellung "nicht
    // anwendbar" schreiben kann statt "nicht geprüft". Die Befunde selbst
    // bleiben erhalten — eine unbedienbare Seite ist auch ohne BFSG-Pflicht
    // ein Problem, nur eben ein wirtschaftliches statt eines rechtlichen.
    const lief = imLauf && urteil.geltung !== "gilt-nicht" && (simulation || findings.length > 0);
    const pruefungen = lief ? zaehlePruefungen(findings) : 0;
    const score = computeCategoryScore(findings, lief);
    return {
      category,
      score,
      grade: score === null ? null : scoreToGrade(score),
      findings,
      checks: pruefungen,
      confidence: Math.round(confidence(pruefungen, category) * 100) / 100,
      geltung: urteil.geltung,
      geltungGrund: urteil.grund,
    };
  });

  const gruppen: GruppenErgebnis[] = (["compliance", "growth"] as CategoryGroup[]).map((gruppe) => {
    const teil = categories.filter((c) => CATEGORY_GROUP[c.category] === gruppe && c.score !== null);
    if (teil.length === 0) {
      return { gruppe, score: null, grade: null, gedeckelt: false };
    }
    // Gewicht je Kategorie mit ihrer Prüfdichte dämpfen und innerhalb der
    // Gruppe normalisieren — sonst zöge eine dünn belegte Kategorie den Wert.
    const gewichtet = teil.map((c) => ({
      score: c.score as number,
      weight: CATEGORY_WEIGHTS[c.category] * confidence(c.checks, c.category),
    }));
    const summe = gewichtet.reduce((s, w) => s + w.weight, 0);
    const roh = summe > 0
      ? Math.round(gewichtet.reduce((s, w) => s + w.score * w.weight, 0) / summe)
      : null;
    if (roh === null) return { gruppe, score: null, grade: null, gedeckelt: false };

    // Der Deckel wirkt auch auf die Gruppe: Ein kritischer Befund in einer
    // Kategorie darf nicht durch drei saubere andere weggemittelt werden.
    const kritisch = teil.some((c) =>
      c.findings.some((f) => f.status === "fail" && f.severity === "critical")
    );
    const score = kritisch ? Math.min(roh, GATE_MAX_SCORE) : roh;
    return { gruppe, score, grade: scoreToGrade(score), gedeckelt: kritisch };
  });

  // Scanstatus: Wie viel wurde überhaupt gemessen?
  //
  // Maßstab sind nur die Kategorien, die für diesen Betreiber überhaupt gelten.
  // Sonst würde eine korrekt als "nicht anwendbar" erkannte Kategorie den Scan
  // als unvollständig markieren — die Warnung "hier fehlen Messungen" stünde
  // ausgerechnet dann da, wenn das Werkzeug besonders genau war.
  const bewertbar = categories.filter((c) => c.geltung !== "gilt-nicht").length;
  const geprueft = categories.filter((c) => c.score !== null).length;
  const status: ScanStatus =
    geprueft === 0 ? "failed" : geprueft < bewertbar ? "partial" : "complete";

  return { categories, gruppen, status };
}
