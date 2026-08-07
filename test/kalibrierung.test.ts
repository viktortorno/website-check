// Kalibrierung: Wie oft irrt sich das Werkzeug gegen bekannte Wahrheit?
//
// Der Test schlägt bei JEDER Abweichung fehl — es gibt keine geduldete Quote.
// Eine "akzeptable Fehlalarmrate" wäre genau die Sorte Zahl, die man später
// stillschweigend nach oben zieht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURES, messeKalibrierung, pruefeFixture } from "./fixtures";

test("kein Fehlalarm bei korrekt umgesetzten Seiten", () => {
  const { abweichungen, gepruefteErwartungen } = messeKalibrierung();
  const fp = abweichungen.filter((a) => a.art === "falsch-positiv");
  const fn = abweichungen.filter((a) => a.art === "falsch-negativ");

  const bericht = abweichungen
    .map((a) => `  ${a.art === "falsch-positiv" ? "FEHLALARM " : "ÜBERSEHEN "} ${a.fixture} → ${a.id}`)
    .join("\n");

  assert.equal(
    abweichungen.length,
    0,
    `${gepruefteErwartungen} Erwartungen geprüft, ${fp.length} Fehlalarme, ${fn.length} übersehene Mängel:\n${bericht}`
  );
});

// Jede Fixture einzeln, damit ein Fehlschlag benennt, WELCHER Fall bricht —
// statt einer Sammelmeldung, in der man die Ursache sucht.
for (const f of FIXTURES) {
  test(`Fixture: ${f.name}`, () => {
    const ids = new Set(pruefeFixture(f).map((x) => x.id));
    for (const id of f.erwartet) {
      assert.ok(ids.has(id), `${id} fehlt — ${f.these}`);
    }
    for (const id of f.verboten) {
      assert.ok(!ids.has(id), `${id} wurde fälschlich gemeldet — ${f.these}`);
    }
  });
}
