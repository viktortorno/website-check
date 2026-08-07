// Seitentyp-Erkennung und die Fehlalarme, die sie abstellt.
//
// Wie überall in dieser Suite ist die wichtigere Richtung die zweite: nicht
// "erkennt der Detektor einen Artikel?", sondern "hört das Conversion-Modul
// auf, ein Impressum wie eine schlechte Landingpage zu behandeln?".

import { test } from "node:test";
import assert from "node:assert/strict";
import { erkenneSeitentyp, wendeSeitentypAn } from "../scripts/engine/seitentyp";
import { Finding, Seitentyp } from "../scripts/engine/types";

function f(id: string, category: Finding["category"], extra: Partial<Finding> = {}): Finding {
  return { id, category, title: id, status: "fail", severity: "high", description: "x", ...extra };
}

// ---------------------------------------------------------------- Erkennung

test("Rechtsseiten werden am Pfad erkannt", () => {
  for (const url of [
    "https://firma.de/impressum",
    "https://firma.de/datenschutz",
    "https://firma.de/datenschutzerklaerung",
    "https://firma.de/agb",
    "https://firma.de/widerruf",
  ]) {
    assert.equal(erkenneSeitentyp("<html><body><h1>x</h1></body></html>", url), "rechtsseite", url);
  }
});

test("eine Rechtsseite ohne sprechenden Pfad wird an der Überschrift erkannt", () => {
  const html = `<html lang="de"><head><title>Impressum – Musterbau</title></head><body><h1>Impressum</h1></body></html>`;
  assert.equal(erkenneSeitentyp(html, "https://firma.de/seite-7"), "rechtsseite");
});

test("die Startseite wird an der Wurzel erkannt", () => {
  assert.equal(erkenneSeitentyp("<html><body>x</body></html>", "https://firma.de/"), "homepage");
  assert.equal(erkenneSeitentyp("<html><body>x</body></html>", "https://firma.de"), "homepage");
});

test("ein Artikel braucht zwei Belege, wenn kein Schema vorliegt", () => {
  const mitBeidem = `<html><body><article><h1>Titel</h1><time datetime="2026-01-01">Jan</time></article></body></html>`;
  assert.equal(erkenneSeitentyp(mitBeidem, "https://firma.de/blog/beitrag"), "artikel");

  // <article> allein reicht nicht — Shops nutzen es für Produktkacheln.
  const nurArticle = `<html><body><article><h2>Kachel</h2></article></body></html>`;
  assert.notEqual(erkenneSeitentyp(nurArticle, "https://firma.de/shop/x"), "artikel");
});

test("Schema.org schlägt jede Heuristik", () => {
  const html = `<html><body><script type="application/ld+json">{"@type":"BlogPosting","headline":"x"}</script></body></html>`;
  assert.equal(erkenneSeitentyp(html, "https://firma.de/irgendwas"), "artikel");

  const produkt = `<html><body><script type="application/ld+json">{"@type":"Product","name":"x"}</script></body></html>`;
  assert.equal(erkenneSeitentyp(produkt, "https://firma.de/p/123"), "produkt");
});

test("im Zweifel unbekannt — und Unbekanntes ändert keine Regel", () => {
  const html = `<html lang="de"><body><h1>Über uns</h1><p>Wir sind ein Team.</p></body></html>`;
  assert.equal(erkenneSeitentyp(html, "https://firma.de/ueber-uns"), "unbekannt");

  const findings = [f("psy.no-cta", "psychology")];
  assert.deepEqual(wendeSeitentypAn(findings, "unbekannt"), findings, "unbekannt lässt alles unverändert");
});

test("Login- und Kontoseiten werden erkannt", () => {
  for (const url of ["https://firma.de/login", "https://firma.de/mein-konto", "https://firma.de/dashboard", "https://firma.de/anmelden"]) {
    assert.equal(erkenneSeitentyp("<html><body><h1>x</h1></body></html>", url), "login", url);
  }
  // Passwortfeld + Anmelde-Überschrift auch ohne sprechenden Pfad.
  const html = `<html><body><h1>Anmelden</h1><form><input type="password"></form></body></html>`;
  assert.equal(erkenneSeitentyp(html, "https://firma.de/x"), "login");
});

test("Checkout/Warenkorb werden erkannt", () => {
  for (const url of ["https://shop.de/checkout", "https://shop.de/warenkorb", "https://shop.de/kasse"]) {
    assert.equal(erkenneSeitentyp("<html><body><h1>x</h1></body></html>", url), "checkout", url);
  }
});

test("ein Passwortfeld allein macht keine Login-Seite", () => {
  // Eine Kontaktseite mit einem Passwort-Reset-Feld ist keine Login-Seite.
  const html = `<html><body><h1>Kontakt</h1><form><input type="password"></form></body></html>`;
  assert.notEqual(erkenneSeitentyp(html, "https://firma.de/kontakt-x"), "login");
});

// -------------------------------------------------------- Fehlalarm-Abbau

test("auf einer Rechtsseite entfallen die Conversion-Vorwürfe", () => {
  // Der Kernfall: Eine Datenschutzerklärung ist keine schlechte Landingpage,
  // nur weil sie keinen "Jetzt buchen"-Button hat.
  const findings = [
    f("psy.no-cta", "psychology", { status: "fail", severity: "high" }),
    f("psy.no-social-proof", "psychology", { status: "warn", severity: "medium" }),
    f("psy.no-headline", "psychology", { status: "fail", severity: "medium" }),
    f("dsgvo.no-privacy", "dsgvo", { status: "fail", severity: "critical" }),
  ];
  const out = wendeSeitentypAn(findings, "rechtsseite");

  for (const id of ["psy.no-cta", "psy.no-social-proof", "psy.no-headline"]) {
    const g = out.find((x) => x.id === id)!;
    assert.equal(g.status, "pass", `${id} darf auf einer Rechtsseite nicht mehr durchfallen`);
    assert.equal(g.severity, "info");
  }
  // Rechtliche Befunde bleiben unangetastet — ein fehlendes Impressum ist auf
  // JEDER Seite ein Problem.
  const dsgvo = out.find((x) => x.id === "dsgvo.no-privacy")!;
  assert.equal(dsgvo.status, "fail");
  assert.equal(dsgvo.severity, "critical");
});

test("auf einem Artikel wird der harte CTA-Vorwurf zum Hinweis", () => {
  const out = wendeSeitentypAn([f("psy.no-cta", "psychology", { status: "fail", severity: "high" })], "artikel");
  const cta = out.find((x) => x.id === "psy.no-cta")!;
  assert.equal(cta.status, "warn");
  assert.equal(cta.severity, "low");
});

test("auf einer Login-Seite ist noindex korrekt, kein Mangel", () => {
  // Der klassische Fehlalarm: seo.noindex (high) gegen eine Login-Seite, die
  // bewusst nicht im Index stehen soll.
  const out = wendeSeitentypAn([f("seo.noindex", "seo", { status: "fail", severity: "high" })], "login");
  const ni = out.find((x) => x.id === "seo.noindex")!;
  assert.equal(ni.status, "pass");
  assert.equal(ni.severity, "info");
});

test("auf Funktions- und Pflichtseiten ist wenig Text kein Mangel", () => {
  for (const typ of ["login", "checkout", "kontakt", "rechtsseite"] as const) {
    const out = wendeSeitentypAn([f("seo.thin-content", "seo", { status: "warn", severity: "low" })], typ);
    assert.equal(out.find((x) => x.id === "seo.thin-content")!.status, "pass", typ);
  }
});

test("auf einer Login-Seite entfallen die Conversion-Vorwürfe", () => {
  const out = wendeSeitentypAn([f("psy.no-cta", "psychology", { status: "fail", severity: "high" })], "login");
  assert.equal(out.find((x) => x.id === "psy.no-cta")!.status, "pass");
});

test("auf der Startseite ist ein fehlendes Breadcrumb belanglos", () => {
  const out = wendeSeitentypAn([f("seo.no-breadcrumb", "seo", { status: "warn", severity: "low" })], "homepage");
  const bc = out.find((x) => x.id === "seo.no-breadcrumb")!;
  assert.equal(bc.status, "pass");
});

test("was der Typ nicht betrifft, bleibt unverändert", () => {
  // Eine Rechtsseite entschärft Conversion — aber nicht SEO oder Sicherheit.
  const findings = [
    f("seo.no-title", "seo", { status: "fail", severity: "high" }),
    f("security.no-https", "security", { status: "fail", severity: "high" }),
  ];
  const out = wendeSeitentypAn(findings, "rechtsseite");
  assert.deepEqual(out, findings, "SEO und Sicherheit gelten auf jeder Seite gleich");
});

// Gegenprobe: kein Typ darf je verschärfen. Wenn ein Befund nach der Anpassung
// härter dasteht als vorher, ist das ein Fehler — neue Vorwürfe gehören belegt
// in ein Modul, nicht als Nebeneffekt der Typ-Erkennung.
test("kein Seitentyp verschärft je einen Befund", () => {
  const rang: Record<string, number> = { pass: 0, warn: 1, fail: 2 };
  const gewicht: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const alle: Seitentyp[] = ["homepage", "artikel", "produkt", "kategorie", "kontakt", "rechtsseite", "login", "checkout"];
  const probe = [
    f("psy.no-cta", "psychology", { status: "fail", severity: "high" }),
    f("seo.no-breadcrumb", "seo", { status: "warn", severity: "low" }),
    f("dsgvo.no-privacy", "dsgvo", { status: "fail", severity: "critical" }),
    f("psy.cta-ok", "psychology", { status: "pass", severity: "info" }),
  ];
  for (const typ of alle) {
    const out = wendeSeitentypAn(probe, typ);
    for (let i = 0; i < probe.length; i++) {
      assert.ok(rang[out[i].status] <= rang[probe[i].status], `${typ}/${probe[i].id}: Status verschärft`);
      assert.ok(gewicht[out[i].severity] <= gewicht[probe[i].severity], `${typ}/${probe[i].id}: Schwere verschärft`);
    }
  }
});
