// Die Netzgrenze ist die einzige Schutzschicht, deren Versagen NIEMAND sieht.
//
// Fällt eine Prüfregel aus, steht ein falscher Satz im Report. Fällt die
// Netzgrenze aus, ruft ein Fremder über diesen Server interne Adressen ab, und
// im Report steht überhaupt nichts davon. Deshalb steht sie hier als Test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, assertPublicUrl, leseBegrenzt, leseRohBegrenzt } from "../scripts/engine/ssrf";

test("private und reservierte Adressbereiche werden erkannt", () => {
  const privat = [
    "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "172.31.255.254",
    "169.254.169.254", // AWS/GCP-Metadaten — der Klassiker
    "100.64.0.1",      // CGNAT
    "0.0.0.0", "224.0.0.1",
    "::1", "fd00::1", "fe80::1",
    "::ffff:127.0.0.1", // IPv4 in IPv6-Schreibweise
  ];
  for (const ip of privat) {
    assert.equal(isPrivateIp(ip), true, `${ip} müsste als intern gelten`);
  }

  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1::"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} müsste als öffentlich gelten`);
  }
});

test("Unsinn in der IP führt zum Blocken, nicht zum Durchlassen", () => {
  // Im Zweifel sperren. Eine nicht parsbare Adresse ist kein Freibrief.
  assert.equal(isPrivateIp("nicht-eine-ip"), true);
  assert.equal(isPrivateIp("1.2.3"), true);
});

test("nur die Ports 80 und 443 werden abgerufen", async () => {
  // Ohne Portgrenze wäre jede Prüfung eine Portsonde gegen fremde Server —
  // mit der IP dieses Servers als Absender.
  await assert.rejects(
    () => assertPublicUrl("https://example.com:6379/"),
    /Standard-Ports/,
    "Redis-Port müsste abgelehnt werden"
  );
  await assert.rejects(() => assertPublicUrl("http://example.com:8080/"), /Standard-Ports/);
  // Die erlaubten Fälle dürfen nicht an der Portprüfung scheitern; ob die
  // Domain auflösbar ist, ist eine andere Frage und hier nicht der Punkt.
  await assert.doesNotReject(() => assertPublicUrl("https://example.com/"));
  await assert.doesNotReject(() => assertPublicUrl("https://example.com:443/"));
});

test("fremde Schemata werden abgelehnt", async () => {
  for (const url of ["file:///etc/passwd", "gopher://example.com/", "ftp://example.com/"]) {
    await assert.rejects(() => assertPublicUrl(url), /http/i, `${url} müsste abgelehnt werden`);
  }
});

// Hilfsmittel: eine Antwort, die weit mehr liefert als angekündigt.
function endloseAntwort(bytes: number, contentLength?: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      let gesendet = 0;
      while (gesendet < bytes) {
        const stueck = Math.min(64 * 1024, bytes - gesendet);
        c.enqueue(new Uint8Array(stueck).fill(65)); // "A"
        gesendet += stueck;
      }
      c.close();
    },
  });
  const headers = new Headers();
  if (contentLength) headers.set("content-length", contentLength);
  return new Response(stream, { headers });
}

test("zu große Antworten werden im Strom abgeschnitten", async () => {
  // 5 MB angeboten, 100 KB erlaubt. Vorher las das Werkzeug erst alles in den
  // Speicher und kürzte danach — die Grenze schützte die Auswertung, nicht
  // den Server.
  const { text, gekappt } = await leseBegrenzt(endloseAntwort(5_000_000), 100_000);
  assert.equal(gekappt, true, "die Kappung müsste gemeldet werden");
  assert.equal(text.length, 100_000, "es dürfte kein Byte mehr durchkommen");
});

test("eine angekündigt zu große Antwort wird gar nicht erst gelesen", async () => {
  const { text, gekappt } = await leseBegrenzt(endloseAntwort(1_000, "999999999"), 100_000);
  assert.equal(gekappt, true);
  assert.equal(text, "", "bei angekündigter Übergröße wird nichts gelesen");
});

test("normale Antworten bleiben unangetastet", async () => {
  const { text, gekappt } = await leseBegrenzt(new Response("robots.txt-Inhalt"), 100_000);
  assert.equal(gekappt, false);
  assert.equal(text, "robots.txt-Inhalt");
});

test("auch binäre Antworten werden begrenzt", async () => {
  // Der Range-Header beim Bildabruf ist nur eine Bitte; ein Server darf ihn
  // ignorieren und die ganze Datei schicken.
  const { bytes, gekappt } = await leseRohBegrenzt(endloseAntwort(2_000_000), 98_304);
  assert.equal(gekappt, true);
  assert.equal(bytes.byteLength, 98_304);
});
