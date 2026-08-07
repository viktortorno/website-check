// Strukturierte Daten VALIDIEREN, nicht nur zählen.
//
// Das SEO-Modul stellt fest, OB JSON-LD da ist. Das genügt Google nicht:
// „Formal vorhandenes Markup reicht nicht — unvollständige oder irreführende
// strukturierte Daten kosten die Rich-Result-Berechtigung." Ein Product ohne
// Preis, ein Article ohne Datum, eine FAQPage ohne Antworten erzeugen kein
// Rich Snippet — und schlimmer: Bewertungssterne, die im Markup stehen, aber
// auf der Seite nirgends sichtbar sind, sind ein Richtlinienverstoß (und in
// Deutschland ein Abmahngrund wegen irreführender Werbung).
//
// Dieses Modul parst das JSON-LD wirklich, prüft die Pflichtfelder der
// häufigsten Rich-Result-Typen und schlägt bei nicht belegten Bewertungen an.
//
// Bewusste Grenze: Google unterstützt Dutzende Typen mit je eigenen Regeln.
// Hier sind die abgedeckt, die bei KMU-Seiten real vorkommen — Organization,
// LocalBusiness, Product, Article-Familie, FAQPage, BreadcrumbList, Event.
// Ein unbekannter Typ wird nicht als Fehler gewertet (kein Vorwurf ins Blaue).

import { Finding } from "../types";

// --- JSON-LD einlesen, kaputte Blöcke ZÄHLEN (nicht still schlucken) --------
interface LdErgebnis {
  objekte: Record<string, unknown>[];
  kaputt: number; // Zahl der <script>-Blöcke, die nicht als JSON parsten
}

function parseJsonLd(html: string): LdErgebnis {
  const objekte: Record<string, unknown>[] = [];
  let kaputt = 0;

  const flach = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(flach); return; }
    const o = n as Record<string, unknown>;
    // @graph bündelt mehrere Objekte in einem Block — auflösen.
    if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(flach);
    if (o["@type"]) objekte.push(o);
  };

  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const roh = m[1].trim();
    if (!roh) continue;
    try {
      flach(JSON.parse(roh));
    } catch {
      kaputt++;
    }
  }
  return { objekte, kaputt };
}

// @type kann String oder Array sein. Normalisiert auf Kleinbuchstaben-Liste.
function typen(o: Record<string, unknown>): string[] {
  const t = o["@type"];
  const liste = Array.isArray(t) ? t : [t];
  return liste.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase());
}

// Ist ein Feld belegt? Leer-String, leeres Array und null zählen als fehlend.
function hat(o: Record<string, unknown>, feld: string): boolean {
  const v = o[feld];
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// Ein verschachteltes Pflichtfeld (z. B. offers.price). Akzeptiert Objekt ODER
// Array von Objekten.
function hatVerschachtelt(o: Record<string, unknown>, aussen: string, innen: string): boolean {
  const v = o[aussen];
  const objs = Array.isArray(v) ? v : [v];
  return objs.some((x) => x && typeof x === "object" && hat(x as Record<string, unknown>, innen));
}

// --- Pflichtfeld-Regeln je Typ ---------------------------------------------
// Rückgabe: Liste fehlender Felder (leer = alles da). null = Typ nicht geprüft.
function fehlendeFelder(o: Record<string, unknown>, ts: string[]): string[] | null {
  const fehlt: string[] = [];
  const pflicht = (f: string) => { if (!hat(o, f)) fehlt.push(f); };

  if (ts.some((t) => ["article", "newsarticle", "blogposting", "techarticle"].includes(t))) {
    pflicht("headline"); pflicht("image"); pflicht("datePublished");
    return fehlt;
  }
  if (ts.includes("product")) {
    pflicht("name");
    // Ein Product braucht mindestens EINE der drei Angebots-/Bewertungsformen.
    if (!hat(o, "offers") && !hat(o, "review") && !hat(o, "aggregateRating")) {
      fehlt.push("offers | review | aggregateRating");
    } else if (hat(o, "offers") && !hatVerschachtelt(o, "offers", "price") && !hatVerschachtelt(o, "offers", "lowPrice")) {
      fehlt.push("offers.price");
    }
    return fehlt;
  }
  if (ts.includes("localbusiness") || ts.some((t) => t.endsWith("business") || ["restaurant", "store", "professionalservice"].includes(t))) {
    pflicht("name"); pflicht("address");
    return fehlt;
  }
  if (ts.includes("organization")) {
    pflicht("name"); pflicht("url");
    return fehlt;
  }
  if (ts.includes("faqpage")) {
    if (!hat(o, "mainEntity")) { fehlt.push("mainEntity"); return fehlt; }
    const fragen = Array.isArray(o.mainEntity) ? o.mainEntity : [o.mainEntity];
    const ok = fragen.every((f) => {
      const q = f as Record<string, unknown>;
      return q && hat(q, "name") && hatVerschachtelt(q, "acceptedAnswer", "text");
    });
    if (!ok) fehlt.push("mainEntity[].acceptedAnswer.text");
    return fehlt;
  }
  if (ts.includes("breadcrumblist")) {
    if (!hat(o, "itemListElement")) fehlt.push("itemListElement");
    return fehlt;
  }
  if (ts.includes("event")) {
    pflicht("name"); pflicht("startDate"); pflicht("location");
    return fehlt;
  }
  return null; // Typ nicht in unserer Prüfliste
}

// Label für die Ausgabe.
function typLabel(ts: string[]): string {
  return ts[0] ? ts[0].charAt(0).toUpperCase() + ts[0].slice(1) : "Objekt";
}

export function runSchema(html: string): Finding[] {
  const findings: Finding[] = [];
  if (!html) return findings;

  const { objekte, kaputt } = parseJsonLd(html);

  // --- 1. Kaputte JSON-LD-Blöcke ------------------------------------------
  if (kaputt > 0) {
    findings.push({
      id: "seo.schema-invalid-json", category: "seo",
      title: `${kaputt} JSON-LD-Block${kaputt === 1 ? "" : "-Blöcke"} mit ungültigem JSON`,
      status: "fail", severity: "medium",
      description: `${kaputt} Block/Blöcke mit strukturierten Daten enthalten kein gültiges JSON (häufig: fehlendes Komma, Zeilenumbruch in einem Wert, kaputtes Escaping). Google verwirft solche Blöcke komplett — das ausgezeichnete Rich Snippet entsteht nicht.`,
      recommendation: "Das JSON-LD durch den Rich-Results-Test von Google prüfen und den Syntaxfehler beheben.",
    });
  }

  if (objekte.length === 0) return findings; // Existenz behandelt das SEO-Modul

  // --- 2. Pflichtfelder je Typ --------------------------------------------
  const unvollstaendig: string[] = [];
  for (const o of objekte) {
    const ts = typen(o);
    const fehlt = fehlendeFelder(o, ts);
    if (fehlt && fehlt.length > 0) {
      unvollstaendig.push(`${typLabel(ts)}: fehlt ${fehlt.join(", ")}`);
    }
  }
  if (unvollstaendig.length > 0) {
    findings.push({
      id: "seo.schema-incomplete", category: "seo",
      title: `${unvollstaendig.length} strukturierte${unvollstaendig.length === 1 ? "s Objekt" : " Objekte"} mit fehlenden Pflichtfeldern`,
      status: "warn", severity: "medium",
      description: "Diesen Schema.org-Objekten fehlen Felder, die Google für ein Rich Snippet voraussetzt. Ohne sie ist das Markup zwar vorhanden, bleibt aber wirkungslos.",
      recommendation: "Die genannten Pflichtfelder ergänzen (Referenz: Googles Rich-Results-Dokumentation je Typ).",
      evidence: unvollstaendig.slice(0, 8),
    });
  } else {
    // Nur melden, wenn wir überhaupt einen bekannten Typ geprüft haben.
    const geprueft = objekte.some((o) => fehlendeFelder(o, typen(o)) !== null);
    if (geprueft) {
      findings.push({
        id: "seo.schema-complete", category: "seo",
        title: "Strukturierte Daten vollständig",
        status: "pass", severity: "info",
        description: "Die geprüften Schema.org-Objekte enthalten die von Google geforderten Pflichtfelder.",
      });
    }
  }

  // --- 3. Bewertungssterne ohne sichtbaren Beleg --------------------------
  // Der heikelste Fall: aggregateRating/Review im Markup, aber auf der Seite
  // ist keine Bewertung zu sehen. Google wertet das als Verstoß; in DE ist es
  // irreführende Werbung. Bewusst konservativ: Nur anschlagen, wenn WEDER die
  // Bewertungszahl NOCH ein typischer Bewertungsbegriff im sichtbaren Text
  // vorkommt — sonst Fehlalarm gegen eine Seite, die ihre Sterne korrekt zeigt.
  const bewertungsObjekt = objekte.find((o) =>
    hat(o, "aggregateRating") || typen(o).includes("aggregaterating") || typen(o).includes("review")
  );
  if (bewertungsObjekt) {
    const sichtbar = sichtbarerText(html);
    const ratingWert = findeRatingWert(bewertungsObjekt);
    const zahlSichtbar = ratingWert ? sichtbar.includes(ratingWert) || sichtbar.includes(ratingWert.replace(".", ",")) : false;
    const begriffSichtbar = /\b(bewertung|rezension|sterne|★|⭐|kundenstimmen|erfahrung|testimonial|proven expert|trustpilot|google[- ]?bewertung)\b/i.test(sichtbar);
    if (!zahlSichtbar && !begriffSichtbar) {
      findings.push({
        id: "seo.schema-fake-rating", category: "seo",
        title: "Bewertungssterne im Markup, aber nicht auf der Seite sichtbar",
        status: "fail", severity: "high",
        description: "Die strukturierten Daten enthalten eine Bewertung (aggregateRating/Review), aber auf der sichtbaren Seite ist keine Bewertung zu finden. Google verlangt, dass ausgezeichnete Bewertungen für Besucher sichtbar sind — andernfalls droht der Entzug aller Rich Snippets. In Deutschland ist eine nicht belegte Sternebewertung zudem als irreführende Werbung abmahnbar.",
        recommendation: "Entweder die echten Bewertungen sichtbar auf der Seite darstellen — oder das Bewertungs-Markup entfernen, wenn es keine gibt.",
        legalRef: "Google-Richtlinien für Bewertungs-Snippets; § 5 UWG (irreführende Werbung)",
      });
    }
  }

  return findings;
}

// Sichtbaren Text grob extrahieren (Script/Style raus).
function sichtbarerText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

// ratingValue aus einem (evtl. verschachtelten) Objekt ziehen.
function findeRatingWert(o: Record<string, unknown>): string | null {
  const direkt = o["ratingValue"];
  if (typeof direkt === "string" || typeof direkt === "number") return String(direkt);
  const agg = o["aggregateRating"];
  if (agg && typeof agg === "object") {
    const v = (agg as Record<string, unknown>)["ratingValue"];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return null;
}
