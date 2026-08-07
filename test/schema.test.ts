// Schema.org-Validierung: Pflichtfelder, kaputtes JSON, unbelegte Bewertungen.
//
// Rein HTML-basiert, kein Netz — deshalb direkte Unit-Tests. Wie überall gilt:
// Die "darf keinen Vorwurf geben"-Fälle sind die wichtigeren, weil ein
// Fehlalarm auf korrektem Markup den Betreiber an etwas schicken würde, das in
// Ordnung ist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSchema } from "../scripts/engine/modules/schema";

function ids(html: string): Set<string> {
  return new Set(runSchema(html).map((f) => f.id));
}

function ld(obj: object): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body>Inhalt</body></html>`;
}

// -------------------------------------------------------------- kaputtes JSON

test("ungültiges JSON-LD wird erkannt, nicht stillschweigend verworfen", () => {
  const html = `<html><head><script type="application/ld+json">{ "@type": "Product", "name": "x", }</script></head><body>x</body></html>`;
  assert.ok(ids(html).has("seo.schema-invalid-json"));
});

test("gültiges JSON-LD erzeugt keinen JSON-Fehler", () => {
  assert.ok(!ids(ld({ "@type": "Organization", name: "Musterbau", url: "https://x.de" })).has("seo.schema-invalid-json"));
});

// ---------------------------------------------------------------- Pflichtfelder

test("ein Product ohne Preis fällt auf", () => {
  const i = ids(ld({ "@type": "Product", name: "Halle", offers: { "@type": "Offer", priceCurrency: "EUR" } }));
  assert.ok(i.has("seo.schema-incomplete"), [...i].join(","));
});

test("ein vollständiges Product besteht", () => {
  const i = ids(ld({ "@type": "Product", name: "Halle", offers: { "@type": "Offer", price: "1000", priceCurrency: "EUR" } }));
  assert.ok(i.has("seo.schema-complete"));
  assert.ok(!i.has("seo.schema-incomplete"));
});

test("ein Article ohne datePublished fällt auf", () => {
  const i = ids(ld({ "@type": "BlogPosting", headline: "Titel", image: "https://x.de/b.jpg" }));
  assert.ok(i.has("seo.schema-incomplete"));
});

test("eine FAQPage ohne Antworten fällt auf", () => {
  const i = ids(ld({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Frage?" }] }));
  assert.ok(i.has("seo.schema-incomplete"));
});

test("eine vollständige FAQPage besteht", () => {
  const i = ids(ld({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Frage?", acceptedAnswer: { "@type": "Answer", text: "Antwort." } }] }));
  assert.ok(i.has("seo.schema-complete"));
  assert.ok(!i.has("seo.schema-incomplete"));
});

test("@graph wird aufgelöst — verschachtelte Objekte werden geprüft", () => {
  const html = ld({ "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", name: "Musterbau", url: "https://x.de" },
    { "@type": "Product", name: "Halle" }, // fehlt offers/review/rating
  ] });
  assert.ok(ids(html).has("seo.schema-incomplete"));
});

test("ein unbekannter Typ erzeugt keinen Vorwurf", () => {
  // Wir kennen nicht jeden der Dutzenden Google-Typen. Ein ungeprüfter Typ
  // darf nicht als „unvollständig“ gelten — das wäre ein Vorwurf ins Blaue.
  const i = ids(ld({ "@type": "WebSite", name: "x", potentialAction: {} }));
  assert.ok(!i.has("seo.schema-incomplete"));
  assert.ok(!i.has("seo.schema-complete"), "ohne geprüften Typ auch kein pass");
});

// -------------------------------------------------------- Bewertungssterne

test("Bewertungssterne ohne sichtbaren Beleg schlagen an", () => {
  // aggregateRating im Markup, aber im sichtbaren Text keine Spur davon.
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "Product", name: "Halle",
    offers: { "@type": "Offer", price: "1000", priceCurrency: "EUR" },
    aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "212" },
  })}</script></head><body><h1>Halle kaufen</h1><p>Feste Preise.</p></body></html>`;
  assert.ok(ids(html).has("seo.schema-fake-rating"));
});

test("sichtbare Bewertung erzeugt keinen Fake-Rating-Vorwurf", () => {
  // Dieselbe Bewertung, aber die Zahl steht auch sichtbar auf der Seite —
  // der korrekte Normalfall, der nicht bestraft werden darf.
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "Product", name: "Halle",
    offers: { "@type": "Offer", price: "1000", priceCurrency: "EUR" },
    aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "212" },
  })}</script></head><body><h1>Halle</h1><p>Kundenbewertung: 4,9 von 5 Sternen aus 212 Rezensionen.</p></body></html>`;
  assert.ok(!ids(html).has("seo.schema-fake-rating"));
});

test("kein Bewertungs-Markup, kein Fake-Rating-Vorwurf", () => {
  assert.ok(!ids(ld({ "@type": "Organization", name: "x", url: "https://x.de" })).has("seo.schema-fake-rating"));
});
