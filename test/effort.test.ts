// Prüft die Aufwands-Zuordnung gegen die tatsächlich vergebenen Finding-IDs.
//
// Diese Datei lag bisher nur in der App, während Kommentare in der Engine
// hier auf sie verwiesen — ein externes Review hat das zu Recht als
// "Kommentare behaupten eine Absicherung, die es nicht gibt" bemängelt.
//
// Anlass: In AUFWAND_JE_ID standen sechs Schlüssel der Form
// `security.header-<name>` — die gibt es zwar, sie stehen aber für einen
// GESETZTEN Header und tauchen im Fahrplan nie auf. Für die fehlenden Header
// vergibt security.ts `security.missing-<name>`. Die Zuordnung lief damit ins
// Leere, ohne dass irgendetwas fehlschlug: Der Fahrplan zeigte "ca. 1 Stunde"
// statt "wenige Minuten" und sortierte falsch.
//
// Ein Laufzeit-Test kann das nicht fangen (die IDs entstehen erst beim Scan),
// deshalb liest dieser Test die Modul-Quelltexte und gleicht ab. Er kostet
// keine Netzwerkzugriffe und schlägt sofort fehl, wenn jemand eine ID umbenennt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aufwandVon, AUFWAND_LABEL, baueFahrplan } from "../scripts/engine/effort";
import type { Category, Finding, ScanReport } from "../scripts/engine/types";
import { buildScores, zaehlePruefungen } from "../scripts/engine/scoring";

const MODUL_DIR = join(process.cwd(), "scripts/engine/modules");

// Alle IDs einsammeln: feste Zeichenketten (id: "…") und die dynamisch
// gebauten Muster, die sich aus einem Präfix plus Schlüssel zusammensetzen.
function bekannteIds(): Set<string> {
  const ids = new Set<string>();
  for (const datei of readdirSync(MODUL_DIR).filter((f) => f.endsWith(".ts"))) {
    const quelle = readFileSync(join(MODUL_DIR, datei), "utf8");
    for (const m of quelle.matchAll(/id:\s*"([a-z0-9-]+\.[a-z0-9-]+)"/gi)) ids.add(m[1]);

    // security.ts: `security.missing-${key}` / `security.header-${key}` über
    // die Schlüssel aus EXPECTED_HEADERS.
    const headerBlock = quelle.match(/const EXPECTED_HEADERS[\s\S]*?\n\};/);
    if (headerBlock) {
      for (const m of headerBlock[0].matchAll(/^\s*"([a-z-]+)":\s*\{/gm)) {
        ids.add(`security.missing-${m[1]}`);
        ids.add(`security.header-${m[1]}`);
      }
    }
    // legalpages.ts: `${idBase}-<suffix>` mit idBase aus dsgvo.impressum/privacy.
    for (const m of quelle.matchAll(/id:\s*`\$\{idBase\}-([a-z-]+)`/g)) {
      ids.add(`dsgvo.impressum-${m[1]}`);
      ids.add(`dsgvo.privacy-${m[1]}`);
    }
  }
  return ids;
}

test("jede Aufwands-Zuordnung zeigt auf eine ID, die es wirklich gibt", () => {
  const echte = bekannteIds();
  const quelle = readFileSync(join(process.cwd(), "scripts/engine/effort.ts"), "utf8");
  const abschnitt = quelle.slice(
    quelle.indexOf("const AUFWAND_JE_ID"),
    quelle.indexOf("const AUFWAND_JE_KATEGORIE")
  );
  const zugeordnet = [...abschnitt.matchAll(/"([a-z0-9-]+\.[a-z0-9-]+)":/g)].map((m) => m[1]);

  assert.ok(zugeordnet.length > 50, "die Zuordnung sollte nicht leer sein");
  const tot = zugeordnet.filter((id) => !echte.has(id));
  assert.deepEqual(tot, [], `Zuordnung zeigt auf nicht existierende Finding-IDs: ${tot.join(", ")}`);
});

test("unbekannte IDs fallen auf die Kategorie-Voreinstellung zurück", () => {
  const erfunden = { id: "seo.gibt-es-nicht", category: "seo" } as Finding;
  assert.equal(aufwandVon(erfunden), "stunde");
  assert.ok(AUFWAND_LABEL[aufwandVon(erfunden)]);
});

// Kleiner, vollständig synthetischer Report — kein Netzwerk, keine Zufälle.
//
// Wichtig: Scores kommen aus buildScores, nicht aus hartkodierten Werten.
// Sonst passen Ausgangswert und Neuberechnung im Fahrplan nicht zusammen und
// der Test prüft eine Situation, die es im Betrieb nie gibt.
function bericht(findings: Finding[]): ScanReport {
  const { categories, gruppen, status } = buildScores(findings);
  return {
    id: "test",
    url: "https://example.invalid/",
    finalUrl: "https://example.invalid/",
    scannedAt: new Date(0).toISOString(),
    durationMs: 0,
    scanStatus: status,
    gruppen,
    categories,
  } as ScanReport;
}

test("der Fahrplan rechnet den Punktgewinn und sortiert nach Wirkung pro Stunde", () => {
  const findings: Finding[] = [
    // Viel Wirkung, kaum Aufwand → muss oben stehen.
    { id: "security.missing-strict-transport-security", category: "security", title: "HSTS fehlt", status: "fail", severity: "high", description: "" },
    // Gleiche Schwere, aber ein eigenes Vorhaben → muss darunter stehen.
    { id: "geo.js-dependency", category: "geo", title: "Ohne JS leer", status: "fail", severity: "high", description: "" },
  ];
  const start = baueFahrplan(bericht(findings));

  assert.equal(start.schritte[0].finding.id, "security.missing-strict-transport-security");
  assert.equal(start.schritte[0].aufwand, "minuten");
  assert.equal(start.schritte[1].aufwand, "projekt");
  assert.ok(start.schritte[0].punkteKategorie > 0, "Beheben muss Punkte bringen");
});

test("bestandene Prüfungen stehen nie im Fahrplan", () => {
  const r = bericht([
    { id: "seo.title-ok", category: "seo", title: "Title ok", status: "pass", severity: "info", description: "" },
  ]);
  assert.deepEqual(baueFahrplan(r).schritte, []);
});

// --- Der Blocker aus dem externen Review ---------------------------------
//
// Ein gescheiterter Browser-Scan lieferte vorher Gesamtnote A (100/100) und
// sechs Kategorien mit "A" bei null ausgeführten Prüfungen. Dieser Test hält
// fest, dass "nicht geprüft" nie wieder zu einer Note wird.

test("ohne ausgeführte Prüfungen gibt es keine Note", () => {
  const nurScanFehler: Finding[] = [{
    id: "dsgvo.scan-error", category: "dsgvo", title: "Browser-Scan fehlgeschlagen",
    status: "warn", severity: "info", description: "",
  }];
  // So ruft der Runner es auf, wenn der Browser ausfällt: nur security lief.
  const r = buildScores(nurScanFehler, new Set<Category>(["security"]));

  // security steht zwar im gelaufen-Set, hat aber keine einzige Prüfung
  // geliefert — dann ist auch dort keine Aussage möglich. "failed" ist die
  // ehrliche Antwort, nicht "partial".
  assert.equal(r.status, "failed", "ohne jede Prüfung ist der Scan gescheitert");
  for (const c of r.categories) {
    if (c.category === "dsgvo") continue; // trägt das Fehler-Finding
    assert.equal(c.score, null, `${c.category} darf ohne Prüfung keine Punktzahl haben`);
    assert.equal(c.grade, null, `${c.category} darf ohne Prüfung keine Note haben`);
    assert.equal(c.checks, 0);
  }
  const growth = r.gruppen.find((g) => g.gruppe === "growth");
  assert.equal(growth?.score, null, "ohne eine einzige Wachstums-Prüfung gibt es keinen Wachstumswert");
});

test("ein kritischer Befund deckelt die Note", () => {
  const findings: Finding[] = [
    { id: "dsgvo.privacy-missing", category: "dsgvo", title: "Keine Datenschutzerklärung",
      status: "fail", severity: "critical", description: "" },
    // Viele bestandene Prüfungen dürfen den kritischen Befund nicht wegmitteln.
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `dsgvo.ok-${i}`, category: "dsgvo" as Category, title: "ok",
      status: "pass" as const, severity: "info" as const, description: "",
    })),
  ];
  const r = buildScores(findings);
  const dsgvo = r.categories.find((c) => c.category === "dsgvo");
  assert.ok(dsgvo!.score !== null && dsgvo!.score <= 44, `Deckel greift nicht: ${dsgvo!.score}`);
  assert.ok(["D", "E", "F"].includes(dsgvo!.grade as string));
  const compliance = r.gruppen.find((g) => g.gruppe === "compliance");
  assert.equal(compliance?.gedeckelt, true, "der Deckel muss auch auf der Gruppe sichtbar sein");
});

test("Recht und Wachstum werden nicht miteinander verrechnet", () => {
  const findings: Finding[] = [
    { id: "dsgvo.pre-consent-tracking", category: "dsgvo", title: "Tracker vor Einwilligung",
      status: "fail", severity: "critical", description: "" },
    { id: "seo.title-ok", category: "seo", title: "Title ok", status: "pass", severity: "info", description: "" },
    { id: "seo.h1-ok", category: "seo", title: "H1 ok", status: "pass", severity: "info", description: "" },
  ];
  const r = buildScores(findings);
  const compliance = r.gruppen.find((g) => g.gruppe === "compliance")!;
  const growth = r.gruppen.find((g) => g.gruppe === "growth")!;
  assert.ok(compliance.score !== null && compliance.score <= 44, "Rechtswert muss schlecht sein");
  assert.ok(growth.score !== null && growth.score >= 90, "Wachstumswert bleibt davon unberührt");
});

test("axe-Verstöße zählen als EINE Prüfung, nicht als viele", () => {
  const viele: Finding[] = Array.from({ length: 9 }, (_, i) => ({
    id: `a11y.axe-color-contrast-${i}`, category: "accessibility" as Category,
    title: "Kontrast", status: "fail" as const, severity: "medium" as const, description: "",
  }));
  assert.equal(zaehlePruefungen(viele), 1);
});
