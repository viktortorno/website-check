// Consent-Balance: Ist „Ablehnen" genauso leicht wie „Akzeptieren"?
//
// Anders als die meisten Tests hier läuft dieser gegen ein ECHTES Chromium:
// Der Check wertet das gerenderte DOM aus (Sichtbarkeit, Overlay, Knöpfe im
// selben Kasten) — das lässt sich nicht aus rohem HTML nachstellen. Zwei
// Chromium-Starts, entsprechend langsamer als der Rest der Suite.
//
// Beide Richtungen: Der Verstoß (nur Akzeptieren) MUSS auffallen, und ein
// fairer Banner (Akzeptieren + Ablehnen gleichwertig) darf KEINEN Vorwurf
// ernten.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteFixtureServer, FixtureServer } from "./fixture-server";
import { runBrowserScan } from "../scripts/engine/modules/browser";
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
  const r = await runBrowserScan(`${srv.basis}${pfad}`);
  return new Set(r.findings.map((f) => f.id));
}

test("Banner mit gleichwertigem Ablehnen besteht", async () => {
  const i = await ids("/banner-mit-ablehnen");
  assert.ok(i.has("dsgvo.consent-reject-ok"), `erwartet consent-reject-ok, war: ${[...i].filter((x) => x.startsWith("dsgvo.consent")).join(", ")}`);
  assert.ok(!i.has("dsgvo.consent-no-reject"), "ein fairer Banner darf nicht beanstandet werden");
});

test("Banner mit nur Akzeptieren (Ablehnen hinter Einstellungen) fällt auf", async () => {
  const i = await ids("/banner-ohne-ablehnen");
  assert.ok(i.has("dsgvo.consent-no-reject"), `erwartet consent-no-reject, war: ${[...i].filter((x) => x.startsWith("dsgvo.consent")).join(", ")}`);
  assert.ok(!i.has("dsgvo.consent-reject-ok"));
});
