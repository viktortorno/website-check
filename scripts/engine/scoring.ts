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
    return { category, score, grade: scoreToGrade(score), findings };
  });

  const overallScore = Math.round(
    categories.reduce((sum, c) => sum + c.score * CATEGORY_WEIGHTS[c.category], 0)
  );

  return { categories, overallScore, overallGrade: scoreToGrade(overallScore) };
}
