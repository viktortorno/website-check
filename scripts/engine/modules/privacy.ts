// Datenschutz-Modul (Ergänzung zum Browser-Scan).
//
// Der Browser-Scan beantwortet: Feuern Tracker vor der Einwilligung? Dieses
// Modul beantwortet die Fragen, die daneben am häufigsten abgemahnt werden:
//   - Welche fremden Server werden beim Seitenaufruf ungefragt kontaktiert?
//     (Jede eingebettete Karte, jedes Video, jede CDN-Schrift überträgt die
//     IP-Adresse des Besuchers, bevor irgendjemand zugestimmt hat.)
//   - Wie lange leben die gesetzten Cookies?
//   - Willigt der Nutzer beim Absenden eines Formulars informiert ein?
//
// Alles hier arbeitet auf Daten, die der Browser-Scan ohnehin erhoben hat —
// kein zusätzlicher Seitenaufruf.

import { Finding } from "../types";

type Cookie = { name: string; domain: string; expires: number };

// Eingebettete Dienste, die beim bloßen Laden Daten an Dritte übertragen.
// „note" erklärt dem Betreiber in einem Satz, worin das Problem besteht.
const EINBETTUNGEN: { name: string; re: RegExp; note: string; us: boolean }[] = [
  { name: "YouTube (ohne erweiterten Datenschutzmodus)", re: /(?:https?:)?\/\/(?:www\.)?youtube\.com\/embed/i, note: "überträgt IP und setzt Cookies bereits beim Laden; youtube-nocookie.com vermeidet das teilweise", us: true },
  { name: "Vimeo", re: /player\.vimeo\.com/i, note: "lädt Player und Statistik-Skripte von Vimeo", us: true },
  { name: "Google Maps (iframe/API)", re: /(?:www\.)?google\.com\/maps\/embed|maps\.googleapis\.com/i, note: "überträgt IP an Google, sobald die Karte lädt", us: true },
  { name: "Google reCAPTCHA", re: /(?:www\.)?google\.com\/recaptcha|recaptcha\.net/i, note: "überträgt IP und Verhaltensdaten an Google, meist schon vor dem Absenden", us: true },
  { name: "Gravatar", re: /(?:secure\.)?gravatar\.com/i, note: "überträgt einen Hash der E-Mail-Adresse an Automattic", us: true },
  { name: "Font Awesome (CDN)", re: /use\.fontawesome\.com|kit\.fontawesome\.com/i, note: "Schriften/Icons von fremdem Server statt lokal", us: true },
  { name: "Adobe Fonts / Typekit", re: /use\.typekit\.net|p\.typekit\.net/i, note: "Schriften von Adobe-Servern", us: true },
  { name: "jsDelivr / unpkg / cdnjs", re: /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/i, note: "Bibliotheken von fremdem CDN — die IP jedes Besuchers geht dorthin", us: true },
  { name: "Mailchimp", re: /list-manage\.com|mailchimp\.com/i, note: "Newsletter-Einbindung mit Datenübertragung in die USA", us: true },
  { name: "Brevo / Sendinblue", re: /sibforms\.com|sendinblue\.com|brevo\.com/i, note: "Newsletter-Formular eines Drittanbieters", us: false },
  { name: "HubSpot", re: /js\.hs-scripts\.com|hubspot\.com/i, note: "Marketing-Skript mit umfangreichem Tracking", us: true },
  { name: "Calendly", re: /assets\.calendly\.com|calendly\.com\/assets/i, note: "Terminbuchung als Einbettung eines US-Anbieters", us: true },
  { name: "Trustpilot", re: /widget\.trustpilot\.com/i, note: "Bewertungs-Widget mit eigenem Tracking", us: false },
  { name: "Instagram-/Facebook-Einbettung", re: /platform\.instagram\.com|connect\.facebook\.net\/.*sdk/i, note: "Meta-SDK überträgt Daten beim Laden", us: true },
];

// Ein Jahr in Sekunden — die Grenze, oberhalb der Aufsichtsbehörden bei
// Einwilligungs-Cookies regelmäßig widersprechen.
const EIN_JAHR = 365 * 24 * 3600;

export function runPrivacy(
  html: string,
  requestUrls: string[],
  cookies: Cookie[]
): Finding[] {
  const findings: Finding[] = [];
  if (!html) return findings;

  const durchsucht = `${html} ${requestUrls.join(" ")}`;

  // ---------- 1. Fremde Einbettungen ohne Einwilligung ----------
  const gefunden = EINBETTUNGEN.filter((e) => e.re.test(durchsucht));
  if (gefunden.length > 0) {
    const usAnteil = gefunden.filter((g) => g.us).length;
    findings.push({
      id: "dsgvo.third-party-embeds",
      category: "dsgvo",
      title: `${gefunden.length} fremde Einbettung(en) laden ohne Einwilligung`,
      status: "fail",
      severity: usAnteil > 0 ? "high" : "medium",
      description:
        "Diese Dienste werden beim Seitenaufruf kontaktiert, bevor der Besucher zugestimmt hat. Dabei wird mindestens seine IP-Adresse übertragen." +
        (usAnteil > 0 ? ` ${usAnteil} davon in die USA — dafür braucht es eine tragfähige Grundlage und einen Hinweis in der Datenschutzerklärung.` : ""),
      recommendation:
        "Einbettungen erst nach Klick laden (Zwei-Klick-Lösung), Schriften und Bibliotheken lokal hosten, YouTube auf youtube-nocookie.com umstellen.",
      legalRef: "Art. 6 Abs. 1, Art. 44 ff. DSGVO, § 25 TDDDG",
      evidence: gefunden.map((g) => `${g.name} — ${g.note}`),
    });
  } else {
    findings.push({
      id: "dsgvo.no-third-party-embeds",
      category: "dsgvo",
      title: "Keine fremden Einbettungen beim Laden",
      status: "pass",
      severity: "info",
      description: "Es wurden keine bekannten Drittanbieter-Einbettungen (Karten, Videos, CDN-Schriften, Captcha) gefunden, die ungefragt Daten übertragen.",
    });
  }

  // ---------- 2. Cookie-Laufzeiten ----------
  const jetzt = Date.now() / 1000;
  const langlebig = cookies
    .filter((c) => c.expires > 0 && c.expires - jetzt > EIN_JAHR)
    .map((c) => ({ ...c, monate: Math.round((c.expires - jetzt) / (30 * 24 * 3600)) }));
  if (langlebig.length > 0) {
    findings.push({
      id: "dsgvo.cookie-lifetime",
      category: "dsgvo",
      title: `${langlebig.length} Cookie(s) mit Laufzeit über 12 Monate`,
      status: "warn",
      severity: "medium",
      description:
        "Cookies laufen deutlich länger als ein Jahr. Aufsichtsbehörden halten Speicherfristen über 12 Monate bei Einwilligungs- und Analyse-Cookies regelmäßig für unverhältnismäßig — eine Einwilligung von vorgestern trägt nicht beliebig lange.",
      recommendation: "Laufzeiten auf höchstens 12 Monate begrenzen und die Frist in der Datenschutzerklärung nennen.",
      legalRef: "Art. 5 Abs. 1 lit. e DSGVO (Speicherbegrenzung)",
      evidence: langlebig.slice(0, 8).map((c) => `${c.name} (${c.domain}) — ${c.monate} Monate`),
    });
  }

  // ---------- 3. Formular ohne Datenschutzhinweis ----------
  // Wer personenbezogene Daten erhebt, muss spätestens bei der Erhebung
  // informieren. In der Praxis fehlt der Hinweis am Kontaktformular oft ganz.
  const hatFormular = /<form\b/i.test(html) && /<(input|textarea)\b[^>]*(type=["'](text|email|tel)["']|name=["'][^"']*(name|mail|nachricht|message|telefon|phone)[^"']*["'])/i.test(html);
  if (hatFormular) {
    // Der Hinweis muss im Formular oder unmittelbar daneben stehen — deshalb
    // nur der Formularbereich, nicht die ganze Seite (sonst zählt der
    // Fußzeilen-Link jedes Mal als Erfüllung).
    const formulare = [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((m) => m[0]).join(" ");
    const hinweisImFormular = /datenschutz|privacy|einwillig|zustimm/i.test(formulare);
    if (!hinweisImFormular) {
      findings.push({
        id: "dsgvo.form-no-privacy-note",
        category: "dsgvo",
        title: "Formular ohne Datenschutzhinweis",
        status: "warn",
        severity: "medium",
        description:
          "Die Seite erhebt über ein Formular personenbezogene Daten, im Formularbereich selbst findet sich aber kein Hinweis auf die Datenschutzerklärung. Informiert werden muss spätestens im Moment der Erhebung — ein Link in der Fußzeile genügt dafür nicht zuverlässig.",
        recommendation: "Direkt beim Absende-Knopf auf die Datenschutzerklärung verlinken (Ankreuzfeld nur, wenn die Verarbeitung wirklich auf Einwilligung beruht).",
        legalRef: "Art. 13 DSGVO",
      });
    } else {
      findings.push({
        id: "dsgvo.form-privacy-note",
        category: "dsgvo",
        title: "Formular mit Datenschutzhinweis",
        status: "pass",
        severity: "info",
        description: "Im Formularbereich wird auf den Datenschutz hingewiesen — die Informationspflicht bei der Erhebung ist damit adressiert.",
      });
    }
  }

  return findings;
}
