// Indexierungs-Diagnose gegen den Fixture-Server.
//
// Die teuersten SEO-Fehler sind unsichtbar: eine Seite rankt nicht, und der
// Grund steht in einem HTTP-Header oder in einem Canonical, das im Kreis zeigt.
// Genau diese Fälle werden hier gegen bekannte Wahrheit geprüft — beide
// Richtungen: der Fehler MUSS auffallen, und eine saubere Seite darf keinen
// Vorwurf ernten.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteFixtureServer, FixtureServer } from "./fixture-server";
import { runIndexierung } from "../scripts/engine/modules/indexierung";
import { _leereHostCache } from "../scripts/engine/ssrf";

let srv: FixtureServer;

before(async () => {
  process.env.SCAN_ALLOW_LOOPBACK = "1";
  _leereHostCache();
  srv = await starteFixtureServer();
});

after(async () => {
  await srv?.stop();
  delete process.env.SCAN_ALLOW_LOOPBACK;
  _leereHostCache();
});

async function ids(pfad: string): Promise<Set<string>> {
  const html = await (await fetch(`${srv.basis}${pfad}`)).text();
  const f = await runIndexierung(html, `${srv.basis}${pfad}`);
  return new Set(f.map((x) => x.id));
}

// -------------------------------------------------------------- X-Robots-Tag

test("noindex im HTTP-Header wird erkannt", async () => {
  // Der Fall, den eine Quelltext-Prüfung nie sieht: noindex steht nur im Header.
  const i = await ids("/x-robots-noindex");
  assert.ok(i.has("seo.x-robots-noindex"), `erwartet x-robots-noindex, war: ${[...i].join(", ")}`);
});

test("eine gewöhnliche Seite hat keine Index-Vorwürfe", async () => {
  const i = await ids("/");
  for (const id of ["seo.x-robots-noindex", "seo.robots-conflict", "seo.canonical-loop", "seo.canonical-noindex", "seo.hreflang-no-self"]) {
    assert.ok(!i.has(id), `${id} dürfte auf einer sauberen Seite nicht auftreten`);
  }
});

// ------------------------------------------------------------------ Canonical

test("eine Canonical-Schleife wird erkannt", async () => {
  // /canon-a → /canon-b, /canon-b → /canon-a. Google kann sich für keine
  // entscheiden.
  const i = await ids("/canon-a");
  assert.ok(i.has("seo.canonical-loop"), `erwartet canonical-loop, war: ${[...i].join(", ")}`);
});

test("ein Canonical auf eine noindex-Seite wird erkannt", async () => {
  // Der stille Killer: Die Seite weist Google zu einer Adresse, die gar nicht
  // in den Index darf — keine der beiden rankt.
  const i = await ids("/canon-nach-noindex");
  assert.ok(i.has("seo.canonical-noindex"), `erwartet canonical-noindex, war: ${[...i].join(", ")}`);
});

test("ein sauberer Cross-Canonical erzeugt keinen Vorwurf", async () => {
  // Ziel bestätigt sich selbst und ist indexierbar — der legitime Normalfall
  // (Parameter-Variante, Druckansicht). Muss als pass durchgehen.
  const i = await ids("/canon-nach-sauber");
  assert.ok(i.has("seo.canonical-cross-ok"), `erwartet canonical-cross-ok, war: ${[...i].join(", ")}`);
  assert.ok(!i.has("seo.canonical-loop"));
  assert.ok(!i.has("seo.canonical-chain"));
  assert.ok(!i.has("seo.canonical-noindex"));
});

// -------------------------------------------------------------------- hreflang

test("hreflang ohne Selbstreferenz fällt auf", async () => {
  // Der häufigste hreflang-Fehler: Google verwirft das ganze Set.
  const i = await ids("/hreflang-ohne-self");
  assert.ok(i.has("seo.hreflang-no-self"), `erwartet hreflang-no-self, war: ${[...i].join(", ")}`);
});

test("ein korrektes hreflang-Set wird als korrekt erkannt", async () => {
  const i = await ids("/hreflang-gut");
  assert.ok(i.has("seo.hreflang-ok"), `erwartet hreflang-ok, war: ${[...i].join(", ")}`);
  assert.ok(!i.has("seo.hreflang-no-self"));
  assert.ok(!i.has("seo.hreflang-invalid"));
  assert.ok(!i.has("seo.hreflang-no-xdefault"), "x-default ist vorhanden");
});

test("ein ungültiger hreflang-Code wird benannt", async () => {
  const i = await ids("/hreflang-kaputt");
  assert.ok(i.has("seo.hreflang-invalid"), `erwartet hreflang-invalid, war: ${[...i].join(", ")}`);
});

// ----------------------------------------------------- Grenzfall (Fehlalarm)

test("ein Self-Canonical mit trailing-slash-Unterschied ist kein Cross-Verweis", async () => {
  // firma.de/x (ohne Slash) mit Canonical firma.de/x/ (mit Slash) ist DIESELBE
  // Seite. Viele CMS setzen es genau so. Ein naiver Vergleich würde daraus
  // fälschlich einen Verweis auf eine andere Seite machen — und je nach Ziel
  // sogar eine Schleife oder Kette melden.
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
    <link rel="canonical" href="${srv.basis}/self-slash/"><title>x</title></head><body><h1>x</h1></body></html>`;
  const f = await runIndexierung(html, `${srv.basis}/self-slash`);
  const i = new Set(f.map((x) => x.id));
  for (const id of ["seo.canonical-cross-ok", "seo.canonical-loop", "seo.canonical-chain", "seo.canonical-noindex", "seo.canonical-unreachable"]) {
    assert.ok(!i.has(id), `${id} ist ein Fehlalarm — self mit/ohne Slash ist dieselbe Seite`);
  }
});
