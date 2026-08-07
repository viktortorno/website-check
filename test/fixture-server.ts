// Ein kontrollierter Webserver für die Testsuite.
//
// Bis hierher waren security, geo, legalpages und aiact nicht gegen bekannte
// Wahrheit geprüft — ausgerechnet die Module, die die meisten Rechtsaussagen
// treffen. Der Grund war banal: Sie rufen echte Adressen ab, und der eigene
// SSRF-Schutz sperrt 127.0.0.1. Die Sperre bleibt; sie hat für die Testsuite
// eine eng abgesteckte Ausnahme bekommen (siehe loopbackErlaubt in ssrf.ts).
//
// Der Server antwortet auf feste Pfade mit Inhalten, deren korrekte Bewertung
// feststeht — kaputte Header, fehlende Pflichtseiten, Seiten, die einen Bot
// abweisen, ein Bild mit C2PA-Marker.

import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { AddressInfo } from "node:net";

export interface FixtureServer {
  basis: string; // z.B. http://127.0.0.1:41234
  stop: () => Promise<void>;
  // Welche User-Agents haben angefragt? Belegt, dass Bot-Proben wirklich
  // unter dem angegebenen Namen laufen.
  gesehen: string[];
}

const IMPRESSUM_HTML = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Impressum</title></head>
<body><h1>Impressum</h1>
<p>Angaben gemäß § 5 DDG</p>
<p>Musterbau GmbH<br>Industriestraße 4<br>49808 Lingen</p>
<p>Vertreten durch: Anna Muster, Geschäftsführerin</p>
<p>Telefon: 0591 1234567<br>E-Mail: info@musterbau.example</p>
<p>Handelsregister: HRB 12345, Amtsgericht Osnabrück</p>
<p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: DE123456789</p>
<p>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: Anna Muster, Anschrift wie oben</p>
</body></html>`;

const DATENSCHUTZ_HTML = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Datenschutzerklärung</title></head>
<body><h1>Datenschutzerklärung</h1>
<p>Verantwortlicher im Sinne der DSGVO ist die Musterbau GmbH, Industriestraße 4, 49808 Lingen.</p>
<h2>Verarbeitung personenbezogener Daten</h2>
<p>Wir verarbeiten personenbezogene Daten auf Grundlage von Art. 6 Abs. 1 lit. b und lit. f DSGVO.</p>
<h2>Betroffenenrechte</h2>
<p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
   Datenübertragbarkeit und Widerspruch. Außerdem besteht ein Beschwerderecht bei einer
   Aufsichtsbehörde.</p>
<h2>Speicherdauer</h2>
<p>Wir löschen personenbezogene Daten, sobald der Zweck entfällt, spätestens nach 24 Monaten.</p>
<h2>Empfänger</h2><p>Eine Übermittlung in Drittländer findet nicht statt.</p>
</body></html>`;

const START_HTML = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Musterbau GmbH — Hallenbau</title>
<meta name="description" content="Schlüsselfertiger Hallenbau für den Mittelstand. Feste Preise, 14 Wochen Bauzeit.">
<link rel="canonical" href="/">
</head><body>
<h1>Wir bauen Gewerbehallen in 14 Wochen</h1>
<p>Seit 1998 planen und errichten wir schlüsselfertige Hallen.</p>
<a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a>
<a href="/kontakt">Jetzt Beratungstermin vereinbaren</a>
</body></html>`;

// Ein winziges JPEG mit XMP-Marker, wie ihn KI-Generatoren hinterlassen.
function kiBild(): Buffer {
  const marker = Buffer.from(
    '<?xpacket begin="" ?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    "<rdf:Description Iptc4xmpExt:digitalSourceType=" +
    '"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>' +
    "</x:xmpmeta><?xpacket end=\"w\"?>",
    "latin1"
  );
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), marker, Buffer.from([0xff, 0xd9])]);
}

export interface FixtureOptionen {
  // Eigener robots.txt-Inhalt. runGeo holt immer ${origin}/robots.txt — für
  // eine zweite Variante braucht es deshalb einen zweiten Server.
  robots?: string;
}

export async function starteFixtureServer(opt: FixtureOptionen = {}): Promise<FixtureServer> {
  const gesehen: string[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const pfad = (req.url || "/").split("?")[0];
    const ua = req.headers["user-agent"] || "";
    gesehen.push(String(ua));

    const html = (body: string, extra: Record<string, string> = {}, code = 200) => {
      res.writeHead(code, { "content-type": "text/html; charset=utf-8", ...extra });
      res.end(body);
    };
    const text = (body: string, code = 200) => {
      res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
      res.end(body);
    };

    switch (pfad) {
      // --- Rechtsseiten ---------------------------------------------------
      case "/":
        return html(START_HTML);
      case "/impressum":
        return html(IMPRESSUM_HTML);
      case "/datenschutz":
        return html(DATENSCHUTZ_HTML);

      // Eine Seite, die mit 200 antwortet, aber inhaltlich etwas anderes ist.
      // Der klassische Fehlalarm-Erzeuger: "Seite erreichbar" ≠ "Pflichtangaben da".
      case "/falsche-rechtsseite":
        return html("<!DOCTYPE html><html lang=de><body><h1>Seite nicht gefunden</h1>" +
          "<p>Die gewünschte Seite existiert leider nicht. Zurück zur Startseite.</p></body></html>");

      // --- Header-Fälle (security) ---------------------------------------
      case "/hsts-aus":
        return html(START_HTML, { "strict-transport-security": "max-age=0" });
      case "/hsts-kurz":
        return html(START_HTML, { "strict-transport-security": "max-age=3600" });
      case "/hsts-gut":
        return html(START_HTML, { "strict-transport-security": "max-age=31536000; includeSubDomains" });
      case "/server-leak":
        return html(START_HTML, { server: "Apache/2.4.29 (Ubuntu)" });

      // --- robots.txt-Varianten (geo) ------------------------------------
      case "/robots.txt":
        return text(opt.robots ?? "User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: /sitemap.xml\n");
      case "/sitemap.xml":
        res.writeHead(200, { "content-type": "application/xml" });
        return res.end('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>/</loc></url></urlset>');
      case "/llms.txt":
        return text("# Musterbau GmbH\n\n> Schlüsselfertiger Hallenbau.\n");

      // --- Bot-Abwehr: erlaubt in robots.txt, blockt trotzdem ------------
      case "/bot-gesperrt":
        if (/OAI-SearchBot|PerplexityBot|GPTBot/i.test(String(ua))) {
          res.writeHead(403, { "content-type": "text/html" });
          return res.end("<html><body>Forbidden</body></html>");
        }
        return html(START_HTML);

      // Eine Rechtsseite, die den Prüf-Bot abweist. "403" heißt nicht
      // "existiert nicht" — der Unterschied entscheidet zwischen einem
      // Hinweis und einem Vorwurf.
      case "/impressum-403":
        res.writeHead(403, { "content-type": "text/html" });
        return res.end("<html><body>Forbidden</body></html>");

      // --- Bilder (aiact) -------------------------------------------------
      case "/ki-bild.jpg": {
        const buf = kiBild();
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": String(buf.length) });
        return res.end(buf);
      }
      case "/normal-bild.jpg": {
        const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64), Buffer.from([0xff, 0xd9])]);
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": String(buf.length) });
        return res.end(buf);
      }

      // --- Missbrauchsfälle für die Netzgrenze ---------------------------
      // Antwort ohne Ende: prüft, dass die Größengrenze wirklich greift.
      case "/endlos": {
        res.writeHead(200, { "content-type": "text/plain" });
        const block = "A".repeat(64 * 1024);
        let n = 0;
        const schreiben = () => {
          while (n < 400) { // 25 MB, weit über jeder Grenze
            n++;
            if (!res.write(block)) { res.once("drain", schreiben); return; }
          }
          res.end();
        };
        return schreiben();
      }
      // Weiterleitung ins interne Netz — muss vor dem Folgen geblockt werden.
      case "/redirect-intern":
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();

      default:
        return html("<!DOCTYPE html><html lang=de><body><h1>404</h1></body></html>", {}, 404);
    }
  });

  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;

  return {
    basis: `http://127.0.0.1:${port}`,
    gesehen,
    stop: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
