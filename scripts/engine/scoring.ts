// Scoring-Engine: wandelt rohe Findings in Scores (0–100) und Noten (A–F) um.
//
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  HIER STECKT DEINE PRODUKT-ENTSCHEIDUNG.                              ║
// ║  Die zwei markierten Blöcke (★) bestimmen, wie streng dein Tool      ║
// ║  bewertet. Das ist keine technische, sondern eine Geschäfts-Frage:   ║
// ║  Wie hart bestrafst du einen Verstoß? Wie stark zählt jede Kategorie?║
// ║  Diese Zahlen prägen, wie sich ein Report für deine Leads anfühlt.   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Category, CategoryResult, Finding, Severity } from "./types";

// ★ ENTSCHEIDUNG 1 — Strafpunkte pro Verstoß ────────────────────────────
// Jede Kategorie startet bei 100 Punkten. Pro nicht bestandenem Finding
// werden je nach Schweregrad Punkte abgezogen. "warn" zählt halb so hart
// wie "fail" (siehe computeCategoryScore).
//
// Trade-off: Hohe Werte = harte, alarmierende Reports (gut um Dringlichkeit
// für deine Consulting-Leads zu erzeugen, aber Gefahr dass fast jeder ein
// "F" bekommt → unglaubwürdig). Niedrige Werte = mildere, differenziertere
// Reports. Stell dir vor, wie der Report bei einem echten Kunden wirken soll.
export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 40,
  high: 20,
  medium: 10,
  low: 4,
  info: 0,
};
// ────────────────────────────────────────────────────────────────────────

// ★ ENTSCHEIDUNG 2 — Gewichtung der Kategorien im Gesamtscore ────────────
// Summe muss 1.0 ergeben. Das Tool deckt jetzt zwei Welten ab:
//   COMPLIANCE (Risiko vermeiden): DSGVO, Security, AI Act, Barrierefreiheit
//   GROWTH     (Umsatz steigern):  SEO, GEO, Psychologie/Conversion
// Default unten: Compliance ~55 %, Growth ~45 % — ein "Rundum-Website-Score"
// als breiter Lead-Türöffner. Wenn du das Tool reiner als Compliance-Audit
// positionieren willst, gewichte die Growth-Bereiche herunter (oder zeige
// in der UI getrennte Scores pro Gruppe; CATEGORY_GROUP steht in types.ts).
export const CATEGORY_WEIGHTS: Record<Category, number> = {
  // Compliance (Summe 0.52)
  dsgvo: 0.20,
  security: 0.15,
  accessibility: 0.11,
  "ai-act": 0.06,
  // Growth (Summe 0.48)
  seo: 0.15,
  geo: 0.12,
  performance: 0.11,
  psychology: 0.10,
};
// ────────────────────────────────────────────────────────────────────────

// Ab wie vielen Prüfpunkten gilt eine Kategorie als vollwertig belegt?
//
// Hintergrund: Ein Score nach Strafpunkt-Logik misst GEFUNDENE MÄNGEL, nicht
// GEPRÜFTE SUBSTANZ. Eine Kategorie mit zwei Prüfungen ist damit strukturell
// gnädiger als eine mit fünfzehn — sie kann kaum fallen und landet fast immer
// bei 100. Ohne Korrektur zieht so eine dünn belegte Kategorie den Gesamtscore
// nach oben, obwohl über sie wenig bekannt ist.
//
// ⚠️ Die frühere Fassung nahm dafür EINE feste Zahl für alle Kategorien
// (5 Prüfungen = volles Gewicht). Das hatte einen Nebeneffekt, der beim Ausbau
// am 07.08.2026 sichtbar wurde: GEO wuchs von 7 auf 15 Prüfungen, überwiegend
// bestandene. Dadurch stieg das Gewicht dieser gut bewerteten Kategorie im
// Gesamtscore — die Note verbesserte sich, ohne dass sich an einer einzigen
// Website etwas geändert hätte. Wer zwei Reports vergleicht, sieht dann einen
// Fortschritt, den es nicht gibt.
//
// Deshalb jetzt ein SOLLWERT JE KATEGORIE: die Zahl der Prüfungen, die diese
// Engine-Version in dem Bereich überhaupt anstellt. Gemessen wird, wie viel
// davon bei dieser Seite tatsächlich zustande kam (ein abgebrochener Browser-
// Scan oder eine nicht erreichbare robots.txt lässt Prüfungen ausfallen).
// Neue Prüfungen erhöhen damit das Gewicht NICHT — sie erhöhen den Sollwert
// mit. Beim Erweitern eines Moduls diese Zahl mitziehen.
const CATEGORY_CHECK_TARGET: Record<Category, number> = {
  dsgvo: 9,
  security: 14,
  "ai-act": 4,
  accessibility: 3,
  seo: 16,
  geo: 15,
  performance: 3,
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

// Einzelne Kategorie bewerten.
export function computeCategoryScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.status === "pass") continue;
    const penalty = SEVERITY_PENALTY[f.severity];
    // "warn" = halbe Härte gegenüber "fail".
    score -= f.status === "warn" ? penalty / 2 : penalty;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Wie belastbar ist die Aussage dieser Kategorie? 0–1, gemessen am Sollwert
// dieser Kategorie — nicht an einer für alle gleichen Zahl (siehe oben).
export function confidence(findingCount: number, category: Category): number {
  const soll = CATEGORY_CHECK_TARGET[category] ?? 5;
  return Math.min(1, findingCount / soll);
}

// Rangfolge für die Priorisierung: erst nach Status (fail vor warn),
// dann nach Schwere. Damit steht oben, was am meisten kostet.
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

// Die dringendsten Maßnahmen über ALLE Kategorien hinweg.
//
// Der Report listet je nach Seite 40+ Findings gleich laut. Diese Funktion
// beantwortet die einzige Frage, die ein Betreiber wirklich hat: "Was zuerst?"
// Genutzt von der Oberfläche UND der Report-Mail, damit beide dieselbe
// Reihenfolge zeigen.
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

// Alle Findings → Kategorie-Ergebnisse + Gesamtscore.
export function buildScores(allFindings: Finding[]): {
  categories: CategoryResult[];
  overallScore: number;
  overallGrade: string;
} {
  const cats: Category[] = ["dsgvo", "security", "ai-act", "accessibility", "seo", "geo", "performance", "psychology"];
  const categories: CategoryResult[] = cats.map((category) => {
    const findings = allFindings.filter((f) => f.category === category);
    const score = computeCategoryScore(findings);
    return {
      category,
      score,
      grade: scoreToGrade(score),
      findings,
      checks: findings.length,
      confidence: Math.round(confidence(findings.length, category) * 100) / 100,
    };
  });

  // Gewicht je Kategorie mit ihrer Prüfdichte dämpfen und anschließend auf
  // Summe 1 normalisieren — sonst würde der Gesamtscore bei dünn belegten
  // Kategorien systematisch zu niedrig ausfallen (das fehlende Gewicht ginge
  // als "0 Punkte" in die Summe ein statt umverteilt zu werden).
  const weighted = categories.map((c) => ({
    score: c.score,
    weight: CATEGORY_WEIGHTS[c.category] * confidence(c.checks, c.category),
  }));
  const weightSum = weighted.reduce((s, w) => s + w.weight, 0);

  const overallScore = weightSum > 0
    ? Math.round(weighted.reduce((sum, w) => sum + w.score * w.weight, 0) / weightSum)
    : 0;

  return { categories, overallScore, overallGrade: scoreToGrade(overallScore) };
}
