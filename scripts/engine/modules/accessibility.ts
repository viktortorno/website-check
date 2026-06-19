// Barrierefreiheits-Modul: übersetzt die im Browser erhobenen axe-core-Verstöße
// in Findings. axe-core ist der Industrie-Standard für automatisierte WCAG-Tests
// (~50 Regeln) und macht den BFSG-Teil belastbar statt nur heuristisch.
//
// Hinweis: Automatisierte Tests decken ca. 30–50 % der WCAG-Kriterien ab —
// manuelle Prüfung (Tastatur, Screenreader) bleibt für volle BFSG-Konformität
// nötig. Das wird im Report transparent gemacht.

import { Finding } from "../types";
import { AxeViolation } from "./browser";

// axe-impact → unsere Schweregrade & Ampel.
const IMPACT_MAP: Record<string, { severity: Finding["severity"]; status: Finding["status"] }> = {
  critical: { severity: "high", status: "fail" },
  serious: { severity: "medium", status: "fail" },
  moderate: { severity: "medium", status: "warn" },
  minor: { severity: "low", status: "warn" },
};

export function runAccessibility(violations: AxeViolation[], axeRan: boolean): Finding[] {
  // Lief axe nicht, übernimmt die Heuristik in content.ts → hier nichts tun.
  if (!axeRan) return [];

  const findings: Finding[] = [];

  if (violations.length === 0) {
    findings.push({
      id: "a11y.axe-clean",
      category: "accessibility",
      title: "Keine automatisch erkennbaren WCAG-Verstöße",
      status: "pass",
      severity: "info",
      description: "Die automatisierte WCAG-Prüfung (axe-core, Level A & AA) hat keine Verstöße gefunden. Gute Grundlage für BFSG-Konformität.",
    });
  } else {
    for (const v of violations) {
      const map = IMPACT_MAP[v.impact || "minor"] || IMPACT_MAP.minor;
      findings.push({
        id: `a11y.axe-${v.id}`,
        category: "accessibility",
        title: `${v.help} (${v.nodes}×)`,
        status: map.status,
        severity: map.severity,
        description: `${v.description} Betroffene Stellen: ${v.nodes}. Schweregrad laut axe: ${v.impact || "minor"}.`,
        recommendation: "Details & Lösungsweg: " + v.helpUrl,
        legalRef: "WCAG 2.1 A/AA · BFSG",
        evidence: [v.helpUrl],
      });
    }
  }

  // Transparenz-Hinweis zur Reichweite automatisierter Tests.
  findings.push({
    id: "a11y.axe-note",
    category: "accessibility",
    title: "Hinweis zur Barrierefreiheits-Prüfung",
    status: "pass",
    severity: "info",
    description: "Automatisierte Tests (axe-core) decken nur einen Teil der WCAG-Kriterien ab. Für volle BFSG-Konformität sind zusätzlich manuelle Prüfungen (Tastatur-Bedienung, Screenreader, Kontraste im Kontext) nötig.",
  });

  return findings;
}
