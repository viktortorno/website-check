// Mehrseiten-Crawl: die Checks, die man erst über mehrere Seiten sieht.
//
// Gegen den Fixture-Server, der eine kleine Website mit gezielten Fehlern
// nachstellt: doppelte Titles, ein interner 404er, eine Redirect-Kette, eine
// noindex-Seite in der Sitemap, eine verwaiste Seite. Beide Richtungen — der
// Fehler MUSS auffallen, und eine saubere Struktur darf keinen Vorwurf ernten.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteFixtureServer, FixtureServer } from "./fixture-server";
import { runCrawl } from "../scripts/engine/modules/crawl";
import { _leereHostCache } from "../scripts/engine/ssrf";

let srv: FixtureServer;

before(async () => {
  process.env.SCAN_ALLOW_LOOPBACK = "1";
  _leereHostCache();
  // Die Sitemap listet crawl-a/b/uniq/noindex. crawl-noindex wird NICHT von der
  // Startseite verlinkt → verwaist. crawl-404 und crawl-redir1 stehen nicht in
  // der Sitemap, werden aber von der Startseite verlinkt.
  srv = await starteFixtureServer({
    sitemapUrls: ["/crawl-a", "/crawl-b", "/crawl-uniq", "/crawl-noindex"],
  });
});

after(async () => {
  await srv?.stop();
  delete process.env.SCAN_ALLOW_LOOPBACK;
  _leereHostCache();
});

function startHtml(basis: string): string {
  // Startseite verlinkt: a, b, uniq, 404 (kaputt), redir1 (Kette). NICHT
  // noindex (→ verwaist).
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Start</title></head><body>
    <a href="${basis}/crawl-a">A</a>
    <a href="${basis}/crawl-b">B</a>
    <a href="${basis}/crawl-uniq">Uniq</a>
    <a href="${basis}/crawl-404">Kaputt</a>
    <a href="${basis}/crawl-redir1">Umleitung</a>
  </body></html>`;
}

test("der Crawl findet die seitenübergreifenden Fehler", async () => {
  const f = await runCrawl(startHtml(srv.basis), `${srv.basis}/crawl-start`);
  const ids = new Set(f.map((x) => x.id));

  assert.ok(ids.has("seo.internal-broken-links"), `interner 404er fehlt: ${[...ids].join(", ")}`);
  assert.ok(ids.has("seo.redirect-chains"), "Redirect-Kette (redir1→redir2→uniq) fehlt");
  assert.ok(ids.has("seo.duplicate-titles"), "doppelte Titles (a/b) fehlen");
  assert.ok(ids.has("seo.duplicate-descriptions"), "doppelte Descriptions (a/b) fehlen");
  assert.ok(ids.has("seo.sitemap-noindex"), "noindex-in-Sitemap fehlt");
  assert.ok(ids.has("seo.orphan-pages"), "verwaiste Seite (noindex nur in Sitemap) fehlt");
  assert.ok(ids.has("seo.crawl-summary"), "Crawl-Übersicht fehlt");
});

test("eine saubere kleine Website erzeugt keine Fehler", async () => {
  // Nur eindeutige, erreichbare, verlinkte Seiten — kein Vorwurf außer der
  // Übersicht.
  const sauber = await starteFixtureServer({ sitemapUrls: ["/crawl-uniq"] });
  try {
    const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Start</title></head><body>
      <a href="${sauber.basis}/crawl-uniq">Eindeutig</a>
    </body></html>`;
    const f = await runCrawl(html, `${sauber.basis}/`);
    const ids = new Set(f.map((x) => x.id));
    for (const id of ["seo.internal-broken-links", "seo.redirect-chains", "seo.duplicate-titles", "seo.duplicate-descriptions", "seo.sitemap-noindex", "seo.orphan-pages"]) {
      assert.ok(!ids.has(id), `${id} ist ein Fehlalarm auf einer sauberen Website`);
    }
    assert.ok(ids.has("seo.crawl-summary"));
  } finally {
    await sauber.stop();
  }
});
