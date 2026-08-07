#!/usr/bin/env node
// CLI-Einstieg des Website-Checks.
//
// Aufruf:
//   npm run scan -- <url>            → lesbarer Report (Markdown/Text)
//   npm run scan -- <url> --json     → vollständiger Report als JSON
//   npx tsx scripts/scan.ts <url>
//
// Gibt bei --json ausschließlich JSON auf stdout aus (maschinenlesbar für Claude).

import { runScan } from "./engine/runner";
import { parseKontext, kontextAngegeben } from "./engine/kontext";
import { CATEGORY_LABELS, CATEGORY_SHORT, CATEGORY_GROUP, GROUP_LABELS, CATEGORY_EXPERIMENTELL } from "./engine/types";
import type { ScanReport, Status, CategoryGroup, Category, ScanKontext } from "./engine/types";
import { baueFahrplan, AUFWAND_LABEL } from "./engine/effort";

function parseArgs(argv: string[]): { url?: string; json: boolean; all: boolean; kontext: ScanKontext } {
  let url: string | undefined;
  let json = false;
  let all = false;
  // Freiwillige Angaben zum Betreiber. Ohne sie läuft alles wie zuvor —
  // sie entscheiden nur, ob eine gefundene Abweichung für DIESEN Betreiber
  // eine Rechtspflicht verletzt (siehe engine/kontext.ts).
  const roh: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    if (a === "--json") json = true;
    else if (a === "--all") all = true;
    else if (a.startsWith("--land=")) roh.land = a.slice(7);
    else if (a.startsWith("--kunden=")) roh.zielgruppe = a.slice(9);
    else if (a.startsWith("--groesse=")) roh.groesse = a.slice(10);
    else if (a.startsWith("--angebot=")) roh.angebot = a.slice(10);
    else if (!a.startsWith("--")) url = a;
  }
  return { url, json, all, kontext: parseKontext(roh) };
}

const STATUS_ICON: Record<Status, string> = { pass: "✓", warn: "!", fail: "✗" };

function renderText(report: ScanReport, showAll: boolean): string {
  const out: string[] = [];
  out.push("");
  out.push("════════════════════════════════════════════════════════════");
  out.push(`  WEBSITE-CHECK — ${report.finalUrl}`);
  out.push("════════════════════════════════════════════════════════════");
  const issues = report.categories.reduce(
    (n, c) => n + c.findings.filter((f) => f.status !== "pass").length, 0
  );
  // Zwei getrennte Werte statt einer gemeinsamen Note: Gute Sichtbarkeit
  // gleicht keine fehlende Pflichtangabe aus.
  for (const g of report.gruppen) {
    const label = g.gruppe === "compliance" ? "Rechtssicherheit" : "Sichtbarkeit  ";
    out.push(
      `  ${label}: ` +
      (g.score === null ? "nicht geprüft" : `Note ${g.grade}  (${g.score}/100)${g.gedeckelt ? "  [kritischer Befund deckelt die Note]" : ""}`)
    );
  }
  if (report.scanStatus !== "complete") {
    const offen = report.categories.filter((c) => c.score === null && c.geltung !== "gilt-nicht").map((c) => c.category);
    out.push("");
    out.push(`  ACHTUNG: Scan ${report.scanStatus === "failed" ? "gescheitert" : "unvollständig"} — nicht geprüft: ${offen.join(", ") || "—"}`);
    out.push("  \"Nicht geprüft\" ist nicht dasselbe wie \"in Ordnung\".");
  }
  out.push(`  ${issues} Auffälligkeiten · ${(report.durationMs / 1000).toFixed(1)} s`);
  if (report.kontext && kontextAngegeben(report.kontext)) {
    const k = report.kontext;
    out.push(`  Angaben: Land ${k.land} · Kunden ${k.zielgruppe} · Größe ${k.groesse} · Angebot ${k.angebot}`);
  }
  out.push("");

  // Reihenfolge der Arbeit: sortiert nach Wirkung pro Aufwand, nicht nach
  // Schwere. Die Schwere-Sicht steht ohnehin weiter unten in den Kategorien.
  const plan = baueFahrplan(report, 5);
  if (plan.schritte.length > 0) {
    out.push("── SCHNELLSTE GEWINNE ─────────────────────────────────────");
    out.push("");
    for (const [i, s] of plan.schritte.entries()) {
      out.push(`  ${String(i + 1).padStart(2, "0")}. ${s.finding.title}`);
      out.push(`      ${AUFWAND_LABEL[s.aufwand]} · +${s.punkteKategorie} Punkte bei ${CATEGORY_SHORT[s.finding.category as Category]}`);
    }
    out.push("");
    if (plan.vorher !== null && plan.neuerScore !== null) {
      const gruppe = plan.gruppe === "compliance" ? "Rechtssicherheit" : "Sichtbarkeit";
      out.push(`  Zusammen: ${gruppe} ${plan.vorher} → ${plan.neuerScore} von 100`);
    }
    out.push("");
  }

  for (const group of ["compliance", "growth"] as CategoryGroup[]) {
    const cats = report.categories.filter((c) => CATEGORY_GROUP[c.category as Category] === group);
    if (!cats.length) continue;
    out.push(`── ${GROUP_LABELS[group].toUpperCase()} ──────────────────────────────`);
    for (const c of cats) {
      out.push("");
      const kopf =
        c.geltung === "gilt-nicht"
          ? "NICHT ANWENDBAR"
          : c.score === null
            ? "nicht geprüft"
            : `Note ${c.grade} (${c.score}/100)`;
      // Die Unsicherheit gehört an die Note, nicht in eine Fußnote.
      const experimentell = CATEGORY_EXPERIMENTELL[c.category as Category];
      out.push(`  ▸ ${CATEGORY_LABELS[c.category as Category]} — ${kopf}${experimentell ? "  [experimentell]" : ""}`);
      if (experimentell) out.push(`     ${experimentell}`);
      if (c.geltung === "gilt-nicht") out.push(`     ${c.geltungGrund}`);
      const sorted = [...c.findings].sort(
        (a, b) => ({ fail: 0, warn: 1, pass: 2 }[a.status] - { fail: 0, warn: 1, pass: 2 }[b.status])
      );
      for (const f of sorted) {
        if (!showAll && f.status === "pass") continue;
        out.push(`     ${STATUS_ICON[f.status]} ${f.title}`);
        if (f.status !== "pass") {
          out.push(`        ${f.description}`);
          if (f.recommendation) out.push(`        → ${f.recommendation}`);
          if (f.legalRef) out.push(`        ⚖ ${f.legalRef}`);
        }
      }
      const passCount = c.findings.filter((f) => f.status === "pass").length;
      if (!showAll && passCount) out.push(`     (${passCount} Prüfungen bestanden)`);
    }
    out.push("");
  }
  out.push("────────────────────────────────────────────────────────────");
  out.push("  Hinweis: Automatisierte Prüfung — ersetzt keine Rechtsberatung.");
  out.push("────────────────────────────────────────────────────────────");
  out.push("");
  return out.join("\n");
}

async function main() {
  const { url, json, all, kontext } = parseArgs(process.argv);
  if (!url) {
    console.error("Verwendung: npm run scan -- <url> [--json] [--all]");
    console.error("Beispiel:   npm run scan -- example.com");
    process.exit(1);
  }

  try {
    const report = await runScan(url, kontext);
    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write(renderText(report, all));
    }

    // Exit-Code sagt die Wahrheit über die Vollständigkeit.
    //
    // Vorher endete auch ein Scan mit Code 0, bei dem der Browser gar nicht
    // startete — in einer Pipeline sah das aus wie ein sauberer Durchlauf.
    // 2 = nichts geprüft, 1 = teilweise, 0 = vollständig.
    if (report.scanStatus === "failed") process.exit(2);
    if (report.scanStatus === "partial") process.exit(1);
  } catch (err) {
    console.error("Scan fehlgeschlagen:", (err as Error).message);
    process.exit(1);
  }
}

main();
