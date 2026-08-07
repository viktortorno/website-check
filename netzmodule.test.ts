// Die netzabhängigen Module gegen bekannte Wahrheit.
//
// Bis hierher waren geo, legalpages, aiact und security nur über Live-Scans
// geprüft — ausgerechnet die Module mit den meisten Rechtsaussagen. Der Grund
// war der eigene SSRF-Schutz, der einen lokalen Fixture-Server (127.0.0.1)
// zu Recht sperrt. Die Sperre bleibt und hat jetzt eine eng abgesteckte
// Testausnahme (siehe loopbackErlaubt in ssrf.ts).
//
// Wie in fixtures.ts gilt: Die "darf nicht kommen"-Seite ist die wichtigere.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteFixtureServer, FixtureServer } from "./fixture-server";
import { runGeo } from "../lib/scan/modules/geo";
import { runLegalPages } from "../lib/scan/modules/legalpages";
import { runAiAct } from "../lib/scan/modules/aiact";
import { runSecurity } from "../lib/scan/modules/security";
import { safeFetch, leseBegrenzt, assertPublicUrl, _leereHostCache } from "../lib/scan/ssrf";

let srv: FixtureServer;

before(async () => {
  // Die Ausnahme gilt nur mit BEIDEN Flags; NODE_ENV=test setzt das npm-Skript.
  process.env.SCAN_ALLOW_LOOPBACK = "1";
  _leereHostCache();
  srv = await starteFixtureServer();
});

after(async () => {
  await srv?.stop();
  delete process.env.SCAN_ALLOW_LOOPBACK;
  _leereHostCache();
});

function ids(findings: { id: string }[]): Set<string> {
  return new Set(findings.map((f) => f.id));
}

// ---------------------------------------------------------------- legalpages

test("vollständige Rechtsseiten werden als vollständig erkannt", async () => {
  const html = `<a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a>`;
  const f = await runLegalPages(html, `${srv.basis}/`);
  const i = ids(f);

  // Der teuerste denkbare Fehlalarm: einem Betreiber mit korrektem Impressum
  // und korrekter Datenschutzerklärung fehlende Pflichtangaben vorwerfen.
  assert.ok(i.has("dsgvo.impressum-complete"), `Impressum müsste vollständig sein, war: ${[...i].join(", ")}`);
  assert.ok(i.has("dsgvo.privacy-complete"), `Datenschutz müsste vollständig sein, war: ${[...i].join(", ")}`);
  assert.ok(!i.has("dsgvo.impressum-missing"));
  assert.ok(!i.has("dsgvo.impressum-unreachable"));
});

test("eine 200er-Antwort ohne Pflichtangaben gilt nicht als Rechtsseite", async () => {
  // Der Fall, der die Prüfung früher ausgehebelt hat: Der Server antwortet
  // freundlich mit 200, liefert aber eine Fehlerseite. "Erreichbar" ist keine
  // Aussage über den Inhalt.
  const html = `<a href="/falsche-rechtsseite">Impressum</a><a href="/falsche-rechtsseite">Datenschutz</a>`;
  const f = await runLegalPages(html, `${srv.basis}/`);
  const i = ids(f);
  assert.ok(
    !i.has("dsgvo.impressum-complete"),
    "eine Fehlerseite mit HTTP 200 darf nicht als vollständiges Impressum durchgehen"
  );
});

// ----------------------------------------------------------------------- geo

test("robots.txt-Gruppen werden getrennt gelesen", async () => {
  // Die Fixture erlaubt alle Bots global und sperrt GPTBot in einer EIGENEN
  // Gruppe. Eine Regex über die ganze Datei hätte das nie auseinandergehalten.
  const f = await runGeo(`<html lang="de"><h1>Test</h1></html>`, `${srv.basis}/`);
  const i = ids(f);
  assert.ok(!i.has("geo.no-robots"), "die robots.txt ist da");
  assert.ok(!i.has("geo.robots-global-block"), "global ist nichts gesperrt");
  assert.ok(i.has("geo.ai-bots-blocked"), `GPTBot ist gesperrt — erwartet ai-bots-blocked, war: ${[...i].join(", ")}`);
});

test("sitemap.xml und llms.txt werden gefunden", async () => {
  const f = await runGeo(`<html lang="de"><h1>Test</h1></html>`, `${srv.basis}/`);
  const i = ids(f);
  assert.ok(i.has("geo.sitemap-ok"), "sitemap.xml liegt vor");
  assert.ok(i.has("geo.llms-txt-ok"), "llms.txt liegt vor");
  assert.ok(!i.has("geo.no-sitemap"));
  assert.ok(!i.has("geo.no-llms-txt"));
});

test("ein Bot-Block per WAF wird erkannt, obwohl robots.txt ihn erlaubt", async () => {
  // Der Fall, den eine reine robots.txt-Prüfung nie sieht: Die Datei sagt ja,
  // der Server antwortet dem Bot mit 403.
  const f = await runGeo(`<html lang="de"><h1>Test</h1></html>`, `${srv.basis}/bot-gesperrt`);
  const i = ids(f);
  assert.ok(
    i.has("geo.bot-blocked-server"),
    `403 gegenüber KI-Bots müsste auffallen, war: ${[...i].join(", ")}`
  );
  // Und der Beleg, dass die Probe wirklich unter dem Bot-Namen lief.
  assert.ok(srv.gesehen.some((ua) => /OAI-SearchBot/.test(ua)), "die Probe müsste als OAI-SearchBot laufen");
});

// --------------------------------------------------------------------- aiact

test("KI-Herkunftsspuren im Bild werden gefunden", async () => {
  const html = `<html lang="de"><body><img src="/ki-bild.jpg" alt="Beispiel"></body></html>`;
  const f = await runAiAct(html, `${srv.basis}/`, []);
  const i = ids(f);
  assert.ok(
    i.has("ai-act.ai-images-unlabeled"),
    `der IPTC-Marker trainedAlgorithmicMedia müsste gefunden werden, war: ${[...i].join(", ")}`
  );
});

test("ein gewöhnliches Foto erzeugt keinen KI-Verdacht", async () => {
  // Ohne Spuren wird KEINE Aussage getroffen. Ein "vermutlich KI-generiert"
  // wäre eine Unterstellung, die sich von außen nie belegen lässt.
  const html = `<html lang="de"><body><img src="/normal-bild.jpg" alt="Halle"></body></html>`;
  const f = await runAiAct(html, `${srv.basis}/`, []);
  const i = ids(f);
  assert.ok(!i.has("ai-act.ai-images-unlabeled"), "ohne Spuren kein Verdacht");
  assert.ok(!i.has("ai-act.ai-images-labeled"));
});

// -------------------------------------------------------------- Netzgrenze

test("die Größengrenze greift auch gegen einen echten Server", async () => {
  // Vorher nur gegen eine konstruierte Response geprüft. Hier antwortet ein
  // echter Server mit 25 MB ohne content-length.
  const res = await safeFetch(`${srv.basis}/endlos`);
  const { text, gekappt } = await leseBegrenzt(res, 200_000);
  assert.equal(gekappt, true);
  assert.equal(text.length, 200_000);
});

test("eine Weiterleitung auf die Cloud-Metadaten-Adresse wird geblockt", async () => {
  // Der Klassiker: Die erste Antwort ist harmlos, das Redirect-Ziel nicht.
  // safeFetch prüft vor JEDEM Hop erneut.
  await assert.rejects(
    () => safeFetch(`${srv.basis}/redirect-intern`),
    /interne|reservierte/i,
    "169.254.169.254 darf auch als Redirect-Ziel nicht abgerufen werden"
  );
});

test("die Testausnahme greift nur mit beiden Flags", async () => {
  // Die wichtigste Zusicherung dieser Datei: Die Ausnahme, die diese Tests
  // erst möglich macht, darf im Betrieb nicht wirken.
  const merk = process.env.SCAN_ALLOW_LOOPBACK;
  delete process.env.SCAN_ALLOW_LOOPBACK;
  _leereHostCache();
  try {
    await assert.rejects(
      () => assertPublicUrl(`${srv.basis}/`),
      /interne|reservierte|Standard-Ports/i,
      "ohne SCAN_ALLOW_LOOPBACK muss Loopback gesperrt bleiben"
    );
  } finally {
    process.env.SCAN_ALLOW_LOOPBACK = merk;
    _leereHostCache();
  }
});

// -------------------------------------------------- Grenzfälle (Fehlalarme)

test("ein gesperrter SEO-Crawler ist kein gesperrter KI-Bot", async () => {
  // AhrefsBot und SemrushBot sperren viele Seiten aus Kostengründen. Das sagt
  // über die Sichtbarkeit in KI-Antwortsystemen nichts — ein Vorwurf hier wäre
  // ein Fehlalarm gegen eine bewusst getroffene, sinnvolle Entscheidung.
  const zweit = await starteFixtureServer({
    robots: "User-agent: *\nAllow: /\n\nUser-agent: AhrefsBot\nDisallow: /\n\nUser-agent: SemrushBot\nDisallow: /\n",
  });
  try {
    const f = await runGeo(`<html lang="de"><h1>Test</h1></html>`, `${zweit.basis}/`);
    const i = ids(f);
    assert.ok(!i.has("geo.ai-bots-blocked"), "nur SEO-Crawler gesperrt — kein KI-Bot betroffen");
    assert.ok(!i.has("geo.robots-global-block"), "global ist nichts gesperrt");
    assert.ok(i.has("geo.ai-bots-allowed"), `KI-Bots sind erlaubt, war: ${[...i].join(", ")}`);
  } finally {
    await zweit.stop();
  }
});

test("eine abgewiesene Rechtsseite gilt nicht als fehlende Rechtsseite", async () => {
  // 403 heißt "ich zeige es dir nicht", nicht "es gibt es nicht". Ein
  // "Impressum fehlt" (Schwere high) gegen einen Betreiber, dessen WAF nur
  // unseren Bot abweist, ist ein teurer Fehlalarm.
  const html = `<a href="/impressum-403">Impressum</a><a href="/datenschutz">Datenschutz</a>`;
  const f = await runLegalPages(html, `${srv.basis}/`);
  const i = ids(f);
  assert.ok(!i.has("dsgvo.impressum-missing"), `403 ist kein fehlendes Impressum, war: ${[...i].join(", ")}`);
  assert.ok(i.has("dsgvo.impressum-blocked"), "der Abwehr-Fall müsste als solcher benannt werden");
});

// ------------------------------------------------------------------ security
//
// Ehrliche Grenze: Der Fixture-Server spricht kein TLS, also läuft er über
// http://. Die Zertifikats- und Protokollprüfungen von runSecurity sind damit
// NICHT abgedeckt — nur die Auswertung der Antwort-Header. Der Befund
// "security.no-https" ist in diesen Tests erwartet und kein Fehler.

test("HSTS mit max-age=0 gilt als abgeschaltet, nicht als vorhanden", async () => {
  // Der Header IST gesetzt — eine reine Existenzprüfung hätte hier "in
  // Ordnung" gemeldet. max-age=0 weist den Browser aber ausdrücklich an, die
  // Regel zu vergessen. Vorhanden ist nicht wirksam.
  const i = ids(await runSecurity(`${srv.basis}/hsts-aus`));
  assert.ok(i.has("security.hsts-disabled"), `erwartet hsts-disabled, war: ${[...i].join(", ")}`);
});

test("eine zu kurze HSTS-Laufzeit wird benannt", async () => {
  const i = ids(await runSecurity(`${srv.basis}/hsts-kurz`));
  assert.ok(i.has("security.hsts-short"), `erwartet hsts-short, war: ${[...i].join(", ")}`);
  assert.ok(!i.has("security.hsts-disabled"), "eine Stunde ist kurz, aber nicht abgeschaltet");
});

test("korrektes HSTS erzeugt keinen Vorwurf", async () => {
  const i = ids(await runSecurity(`${srv.basis}/hsts-gut`));
  assert.ok(!i.has("security.hsts-disabled"));
  assert.ok(!i.has("security.hsts-short"));
  assert.ok(!i.has("security.missing-strict-transport-security"));
});

test("eine Server-Version im Header fällt auf", async () => {
  const i = ids(await runSecurity(`${srv.basis}/server-leak`));
  assert.ok(i.has("security.server-leak"), `erwartet server-leak, war: ${[...i].join(", ")}`);
});
