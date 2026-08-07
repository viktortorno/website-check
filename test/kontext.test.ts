// Rechtliche Anwendbarkeit: Wann darf das Werkzeug eine Pflicht behaupten?
//
// Die Tests hier sichern vor allem eine Richtung ab: Das Werkzeug darf keine
// Pflicht erfinden, die den Betreiber nicht trifft — und es darf umgekehrt
// nicht verstummen, nur weil niemand etwas ausgefüllt hat.

import { test } from "node:test";
import assert from "node:assert/strict";
import { geltungFuer, parseKontext, KONTEXT_UNBEKANNT, wendeGeltungAn, kontextSchluessel } from "../scripts/engine/kontext";
import { buildScores } from "../scripts/engine/scoring";
import { Category, Finding, ScanKontext } from "../scripts/engine/types";

function f(id: string, category: Category, extra: Partial<Finding> = {}): Finding {
  return {
    id, category, title: id, status: "fail", severity: "high",
    description: "Testbefund", ...extra,
  };
}

test("ohne Angaben bleibt alles bewertbar", () => {
  // Der Normalfall: niemand füllt etwas aus. Würde "unklar" aus der Bewertung
  // nehmen, wäre die Abfrage keine Präzisierung, sondern eine Hürde — und der
  // Standard-Report leer.
  for (const c of ["dsgvo", "ai-act", "accessibility", "security", "seo"] as Category[]) {
    assert.notEqual(geltungFuer(c, KONTEXT_UNBEKANNT).geltung, "gilt-nicht", `${c} dürfte nicht wegfallen`);
  }
});

test("BFSG gilt nicht für reine Geschäftskunden-Angebote", () => {
  const k: ScanKontext = { land: "de", zielgruppe: "b2b", groesse: "ab10", angebot: "nur-info" };
  const u = geltungFuer("accessibility", k);
  assert.equal(u.geltung, "gilt-nicht");
  assert.match(u.grund, /Verbraucher/);
});

test("BFSG gilt nicht für Kleinstunternehmen ohne Online-Abschluss", () => {
  const k: ScanKontext = { land: "de", zielgruppe: "b2c", groesse: "kleinst", angebot: "nur-info" };
  assert.equal(geltungFuer("accessibility", k).geltung, "gilt-nicht");
});

test("BFSG gilt für den Verbraucher-Shop ab zehn Beschäftigten", () => {
  const k: ScanKontext = { land: "de", zielgruppe: "b2c", groesse: "ab10", angebot: "online-abschluss" };
  assert.equal(geltungFuer("accessibility", k).geltung, "gilt");
});

test("nicht anwendbar heißt keine Note, aber die Befunde bleiben", () => {
  // Alle Kategorien haben etwas geliefert — die einzige Besonderheit ist,
  // dass das BFSG diesen Betreiber nicht trifft.
  const ALLE: Category[] = ["dsgvo", "security", "ai-act", "accessibility", "seo", "geo", "performance", "psychology"];
  const findings = [
    ...ALLE.map((c) => f(`${c}.ok`, c, { status: "pass", severity: "info" })),
    f("a11y.kontrast", "accessibility"),
    f("dsgvo.pre-consent-tracking", "dsgvo", { severity: "critical" }),
  ];
  const k: ScanKontext = { land: "de", zielgruppe: "b2b", groesse: "kleinst", angebot: "nur-info" };
  const { categories, status } = buildScores(findings, new Set(ALLE), false, k);

  const a11y = categories.find((c) => c.category === "accessibility")!;
  assert.equal(a11y.score, null, "eine nicht anwendbare Pflicht bekommt keine Note");
  assert.equal(a11y.geltung, "gilt-nicht");
  assert.equal(a11y.findings.length, 2, "der Befund bleibt sichtbar — er ist ein Qualitätsmangel, nur keine Rechtsverletzung");

  // Und der entscheidende Punkt: Der Scan gilt trotzdem als vollständig.
  // Sonst stünde die Warnung "hier fehlen Messungen" ausgerechnet dann da,
  // wenn das Werkzeug besonders genau war.
  assert.notEqual(status, "partial", "nicht anwendbar ist keine Messlücke");
});

test("außerhalb Deutschlands wird das DDG nicht mehr zitiert", () => {
  const findings = [f("legal.no-imprint", "dsgvo", { severity: "critical", legalRef: "§ 5 DDG" })];
  const angepasst = wendeGeltungAn(findings, { ...KONTEXT_UNBEKANNT, land: "ausserhalb" });

  assert.equal(angepasst[0].severity, "medium", "kein kritischer Verstoß gegen ein Gesetz, das nicht gilt");
  assert.match(angepasst[0].legalRef!, /2000\/31\/EG/, "stattdessen die europäische Grundlage");
  assert.match(angepasst[0].description, /außerhalb Deutschlands/);
});

test("bei deutschem Betrieb bleibt der Befund unverändert", () => {
  const findings = [f("legal.no-imprint", "dsgvo", { severity: "critical", legalRef: "§ 5 DDG" })];
  const angepasst = wendeGeltungAn(findings, { ...KONTEXT_UNBEKANNT, land: "de" });
  assert.equal(angepasst[0].severity, "critical");
  assert.equal(angepasst[0].legalRef, "§ 5 DDG");
});

test("fremder Input kann keine unbekannten Werte einschleusen", () => {
  const k = parseKontext({ land: "<script>", zielgruppe: "b2b", groesse: 42, angebot: null, extra: "x" });
  assert.deepEqual(k, { land: "unbekannt", zielgruppe: "b2b", groesse: "unbekannt", angebot: "unbekannt" });
  assert.deepEqual(parseKontext(null), KONTEXT_UNBEKANNT);
  assert.deepEqual(parseKontext("kaputt"), KONTEXT_UNBEKANNT);
});

test("verschiedene Angaben ergeben verschiedene Cache-Schlüssel", () => {
  // Ohne das bekäme der zweite Nutzer derselben URL das Urteil, das zu den
  // Angaben des ersten gehört.
  const a = kontextSchluessel({ land: "de", zielgruppe: "b2b", groesse: "kleinst", angebot: "nur-info" });
  const b = kontextSchluessel({ land: "de", zielgruppe: "b2c", groesse: "kleinst", angebot: "nur-info" });
  assert.notEqual(a, b);
});
