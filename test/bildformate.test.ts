// Bildformat-Analyse: WebP/AVIF pro Bild, nicht pauschal.
//
// Der frühere Check hatte ein Loch — ein einzelnes WebP irgendwo erklärte die
// ganze Seite für modern. Diese Tests sichern beide Richtungen: ein echtes
// Format-Problem MUSS auffallen, und korrekt ausgelieferte moderne Bilder (auch
// als <picture>-Fallback) dürfen KEINEN Vorwurf erzeugen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { analysiereBildformate } from "../scripts/engine/modules/seo";

test("das Loch ist zu: ein WebP-Logo rettet nicht zwanzig JPEGs", () => {
  const html = `<html><body>
    <img src="/logo.webp">
    ${Array.from({ length: 20 }, (_, i) => `<img src="/foto-${i}.jpg">`).join("")}
  </body></html>`;
  const b = analysiereBildformate(html);
  assert.equal(b.gesamt, 21);
  assert.equal(b.modern, 1);
  assert.equal(b.alt.length > 0, true, "die JPEGs müssen als nicht-modern gezählt werden");
});

test("alle Bilder WebP/AVIF — keine Beanstandung", () => {
  const html = `<html><body><img src="/a.webp"><img src="/b.avif"><img src="/c.webp"></body></html>`;
  const b = analysiereBildformate(html);
  assert.equal(b.gesamt, 3);
  assert.equal(b.modern, 3);
  assert.equal(b.alt.length, 0);
});

test("<picture> mit WebP-source: das <img src=jpg> ist nur Fallback, kein Mangel", () => {
  // Der korrekte, empfohlene Weg — der Browser lädt WebP, das JPEG ist nur die
  // Rückfallebene. Ein naiver Scan würde das .jpg fälschlich anmahnen.
  const html = `<html><body>
    <picture>
      <source srcset="/held.webp" type="image/webp">
      <img src="/held.jpg" alt="Held">
    </picture>
  </body></html>`;
  const b = analysiereBildformate(html);
  assert.equal(b.modern, 1, "das Bild gilt als modern ausgeliefert");
  assert.equal(b.alt.length, 0, "kein Vorwurf gegen den JPEG-Fallback");
});

test("srcset mit WebP zählt als modern", () => {
  const html = `<html><body><img src="/a.jpg" srcset="/a.webp 1x, /a-2x.webp 2x"></body></html>`;
  const b = analysiereBildformate(html);
  assert.equal(b.modern, 1);
  assert.equal(b.alt.length, 0);
});

test("data-URLs und SVGs werden nicht mitgezählt (kein Format bestimmbar)", () => {
  const html = `<html><body>
    <img src="data:image/png;base64,iVBOR...">
    <img src="/icon.svg">
    <img src="/foto.jpg">
  </body></html>`;
  const b = analysiereBildformate(html);
  assert.equal(b.gesamt, 1, "nur das JPEG ist ein bestimmbares Rasterbild");
  assert.equal(b.alt.length, 1);
});

test("Query-Strings brechen die Formaterkennung nicht", () => {
  const html = `<html><body><img src="/foto.jpg?v=3"><img src="/neu.webp?cache=1"></body></html>`;
  const b = analysiereBildformate(html);
  assert.equal(b.gesamt, 2);
  assert.equal(b.modern, 1);
  assert.equal(b.alt.length, 1);
});
