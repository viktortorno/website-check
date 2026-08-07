// Kontrollierte Testfälle mit bekannter Wahrheit.
//
// Der Zweck ist NICHT, zu prüfen, ob eine Regel überhaupt anspringt. Das ist
// der leichte Teil und war schon vorher abgedeckt. Der Zweck ist die andere
// Richtung:
//
//   Erzeugt ein KORREKTES Setup garantiert keinen Vorwurf?
//
// Ein Prüfwerkzeug, das bei sauberen Seiten Mängel meldet, ist schlimmer als
// keins — es kostet den Betreiber Zeit für nicht existierende Probleme und
// den Anbieter die Glaubwürdigkeit für die echten Funde. Deshalb führt jeder
// Fall zwei Listen: `erwartet` (muss kommen, sonst falsch-negativ) und
// `verboten` (darf nicht kommen, sonst falsch-positiv).
//
// Bewusste Grenze: Hier stehen nur Module, die ohne Netz und ohne Browser
// laufen. security, dns, geo, legalpages, seo und aiact rufen echte Adressen
// ab; für sie bräuchte es einen Fixture-Server, den der eigene SSRF-Schutz
// zu Recht blockieren würde (localhost). Diese Lücke ist bekannt und in
// KALIBRIERUNG.md benannt — nicht stillschweigend übergangen.

import { Finding } from "../scripts/engine/types";
import { runContent } from "../scripts/engine/modules/content";
import { runPrivacy } from "../scripts/engine/modules/privacy";
import { runPsychology } from "../scripts/engine/modules/psychology";
import { runTechStack } from "../scripts/engine/modules/techstack";

type Cookie = { name: string; domain: string; expires: number };

export interface Fixture {
  name: string;
  // Warum dieser Fall existiert — die fachliche Behauptung, die er festnagelt.
  these: string;
  html: string;
  requestUrls?: string[];
  cookies?: Cookie[];
  erwartet: string[]; // diese Finding-IDs MÜSSEN auftreten
  verboten: string[]; // diese Finding-IDs dürfen NICHT auftreten
}

// Eine vollständig korrekte deutsche Firmenseite. Baustein für die Fälle
// unten: Was hier ergänzt wird, ist der jeweils einzige Unterschied.
function sauber(einschub = "", opt: { lang?: string } = {}): string {
  return `<!DOCTYPE html>
<html lang="${opt.lang ?? "de"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Musterbau GmbH — Schlüsselfertiger Hallenbau in Niedersachsen</title>
</head>
<body>
  <h1>Wir bauen Gewerbehallen in 14 Wochen</h1>
  <p>Seit 1998 planen und errichten wir schlüsselfertige Hallen für mittelständische
     Betriebe. Über 240 abgeschlossene Projekte, feste Preise, ein Ansprechpartner.</p>
  <img src="/halle.jpg" alt="Fertiggestellte Produktionshalle in Lingen">
  <img src="/trennlinie.svg" alt="">
  <h2>Das sagen unsere Kunden</h2>
  <blockquote>„Termin gehalten, Budget gehalten." — Firma Wegener, Osnabrück</blockquote>
  <p>Zertifiziert nach ISO 9001. Mitglied im Bundesverband Bausysteme.</p>
  <h2>Kontakt</h2>
  <p>Musterbau GmbH, Industriestraße 4, 49808 Lingen ·
     Telefon <a href="tel:+495911234567">0591 1234567</a> ·
     <a href="mailto:info@musterbau.example">info@musterbau.example</a></p>
  <a href="/kontakt" class="btn">Jetzt Beratungstermin vereinbaren</a>
  <a href="/leitfaden.pdf">Kostenloser Leitfaden Hallenbau</a>
  ${einschub}
  <footer>
    <a href="/impressum">Impressum</a>
    <a href="/datenschutz">Datenschutzerklärung</a>
  </footer>
</body>
</html>`;
}

const JAHR = 365 * 24 * 3600;
const JETZT = 1_775_000_000; // fester Zeitpunkt — Tests dürfen nicht mit der Uhr wandern

export const FIXTURES: Fixture[] = [
  {
    name: "korrekte Firmenseite",
    these:
      "Der wichtigste Fall überhaupt. Eine Seite, die alles richtig macht, darf KEINEN einzigen Vorwurf auslösen. Jeder Treffer hier ist ein falscher Vorwurf gegenüber einem realen Kunden.",
    html: sauber(),
    erwartet: ["dsgvo.impressum", "dsgvo.privacy", "a11y.lang", "a11y.h1", "a11y.viewport", "a11y.img-alt-ok"],
    verboten: [
      "dsgvo.no-impressum", "dsgvo.no-privacy", "dsgvo.third-party-embeds",
      "dsgvo.cookie-lifetime", "dsgvo.form-no-privacy-note",
      "a11y.no-lang", "a11y.no-h1", "a11y.no-viewport", "a11y.img-alt", "a11y.no-labels",
      "ai-act.chatbot-undisclosed",
      "psy.no-cta", "psy.no-headline", "psy.no-social-proof", "psy.no-contact", "psy.no-trust",
      "security.jquery-outdated", "security.version-leak",
    ],
  },

  {
    name: "dekoratives Bild mit leerem alt",
    these:
      'alt="" ist die VORGESCHRIEBENE Auszeichnung für dekorative Bilder (WCAG 1.1.1). Wer es richtig macht, darf dafür nicht abgestraft werden — ein klassischer Fehlalarm von Prüfwerkzeugen.',
    html: sauber('<img src="/zierleiste.png" alt=""><img src="/muster.png" alt="">'),
    erwartet: ["a11y.img-alt-ok"],
    verboten: ["a11y.img-alt"],
  },

  {
    name: "YouTube im erweiterten Datenschutzmodus",
    these:
      "youtube-nocookie.com ist genau die Maßnahme, die das Werkzeug empfiehlt. Wer sie umsetzt, muss den Befund loswerden — sonst ist der Rat wertlos.",
    html: sauber('<iframe src="https://www.youtube-nocookie.com/embed/xyz123" title="Werksführung"></iframe>'),
    erwartet: [],
    verboten: ["dsgvo.third-party-embeds"],
  },

  {
    name: "YouTube ohne Datenschutzmodus",
    these: "Gegenprobe: Die normale Einbettung überträgt beim Laden Daten und muss erkannt werden.",
    html: sauber('<iframe src="https://www.youtube.com/embed/xyz123" title="Werksführung"></iframe>'),
    erwartet: ["dsgvo.third-party-embeds"],
    verboten: ["dsgvo.no-third-party-embeds"],
  },

  {
    name: "Sitzungs-Cookie ohne Laufzeit",
    these:
      "Ein Session-Cookie (expires = -1) ist technisch notwendig und datenschutzrechtlich unauffällig. Es darf nicht als Laufzeit-Problem gelten.",
    html: sauber(),
    cookies: [{ name: "PHPSESSID", domain: "musterbau.example", expires: -1 }],
    erwartet: [],
    verboten: ["dsgvo.cookie-lifetime"],
  },

  {
    name: "Cookie mit zwei Jahren Laufzeit",
    these: "Gegenprobe: Über ein Jahr Laufzeit beanstanden Aufsichtsbehörden regelmäßig.",
    html: sauber(),
    cookies: [{ name: "_ga", domain: ".musterbau.example", expires: JETZT + 2 * JAHR }],
    erwartet: ["dsgvo.cookie-lifetime"],
    verboten: [],
  },

  {
    name: "Formular mit Einwilligungshinweis",
    these:
      "Ein Kontaktformular MIT Datenschutzhinweis ist der korrekte Zustand — der häufigste Fall bei gepflegten Seiten und deshalb ein teurer Fehlalarm.",
    html: sauber(`<form action="/kontakt" method="post">
        <label for="name">Name</label><input id="name" name="name">
        <label for="mail">E-Mail</label><input id="mail" name="mail" type="email">
        <label for="nachricht">Nachricht</label><textarea id="nachricht" name="nachricht"></textarea>
        <label><input type="checkbox" name="dsgvo" required> Ich habe die
          <a href="/datenschutz">Datenschutzerklärung</a> gelesen und stimme der
          Verarbeitung meiner Daten zu.</label>
        <button type="submit">Anfrage senden</button>
      </form>`),
    erwartet: ["dsgvo.form-privacy-note"],
    verboten: ["dsgvo.form-no-privacy-note", "a11y.no-labels"],
  },

  {
    name: "Formular ohne Einwilligungshinweis",
    these: "Gegenprobe: Ohne jeden Hinweis auf die Datenverarbeitung fehlt die informierte Einwilligung.",
    html: sauber(`<form action="/kontakt" method="post">
        <label for="n2">Name</label><input id="n2" name="name">
        <button type="submit">Absenden</button>
      </form>`),
    erwartet: ["dsgvo.form-no-privacy-note"],
    verboten: ["dsgvo.form-privacy-note"],
  },

  {
    name: "menschlicher Live-Chat (Intercom)",
    these:
      "Ein besetzter Chat mit echten Mitarbeitern ist KEIN KI-System. Art. 50 AI Act verlangt dafür keine Offenlegung — der Befund wäre eine erfundene Rechtspflicht.",
    html: sauber('<script src="https://widget.intercom.io/widget/abc123"></script>'),
    erwartet: ["ai-act.livechat-present"],
    verboten: ["ai-act.chatbot-undisclosed"],
  },

  {
    name: "KI-Chatbot ohne Hinweis",
    these: "Gegenprobe: Ein Bot-Baukasten ohne jeden Hinweis auf KI ist der Fall, den Art. 50 Abs. 1 adressiert.",
    html: sauber('<script src="https://cdn.voiceflow.com/widget/bundle.mjs"></script>'),
    erwartet: ["ai-act.chatbot-undisclosed"],
    verboten: ["ai-act.no-chatbot", "ai-act.chatbot-disclosed"],
  },

  {
    name: "KI-Chatbot mit Hinweis",
    these: "Wer die Offenlegung umgesetzt hat, muss den Vorwurf loswerden.",
    html: sauber(
      '<script src="https://cdn.voiceflow.com/widget/bundle.mjs"></script>' +
      '<p>Hinweis: Dieser Chat wird von einem KI-Assistenten beantwortet. Auf Wunsch übernimmt ein Mitarbeiter.</p>'
    ),
    erwartet: ["ai-act.chatbot-disclosed"],
    verboten: ["ai-act.chatbot-undisclosed"],
  },

  {
    name: "Seite ohne Sprachauszeichnung",
    these: "Gegenprobe zur wichtigsten maschinell prüfbaren WCAG-Regel: ohne lang liest der Screenreader deutschen Text englisch vor.",
    html: sauber("", { lang: "" }).replace('<html lang="">', "<html>"),
    erwartet: ["a11y.no-lang"],
    verboten: ["a11y.lang"],
  },

  {
    name: "Formularfelder mit aria-label statt <label>",
    these:
      "aria-label ist eine WCAG-konforme Alternative zum sichtbaren <label> (4.1.2). Wer sie nutzt, erfüllt die Anforderung — ein Vorwurf wäre hier fachlich falsch.",
    html: sauber(`<form action="/suche" method="get">
        <input type="search" name="q" aria-label="Suchbegriff eingeben">
        <input type="email" name="mail" aria-label="E-Mail-Adresse für den Newsletter">
        <button type="submit">Suchen</button>
      </form>`),
    erwartet: [],
    verboten: ["a11y.no-labels"],
  },

  {
    name: "Rechtsseiten unter abweichender Beschriftung",
    these:
      'Viele Seiten verlinken "Rechtliches" oder "Anbieterkennzeichnung" statt "Impressum". Die Pflichtangabe ist vorhanden — nur anders beschriftet. Ein Vorwurf wäre ein Fehlalarm gegen eine korrekte Seite.',
    html: sauber().replace(
      '<a href="/impressum">Impressum</a>\n    <a href="/datenschutz">Datenschutzerklärung</a>',
      '<a href="/rechtliches">Rechtliches</a>\n    <a href="/datenschutz">Datenschutz</a>'
    ),
    erwartet: [],
    verboten: ["dsgvo.no-impressum", "dsgvo.no-privacy"],
  },

  {
    name: "Fachartikel über KI-Chatbots ohne eigenen Bot",
    these:
      "Eine Agentur, die ÜBER Chatbots schreibt, betreibt deshalb keinen. Erkennung an Textwörtern statt an eingebundenen Diensten wäre eine erfundene Rechtspflicht.",
    html: sauber(`<article>
        <h2>Was der EU AI Act für Chatbots bedeutet</h2>
        <p>Wer einen KI-Chatbot einsetzt, muss seit August 2026 offenlegen, dass
           Nutzer mit einer Maschine sprechen. Ein Chatbot von Voiceflow oder
           Botpress fällt darunter, ein besetzter Live-Chat nicht.</p>
      </article>`),
    erwartet: [],
    verboten: ["ai-act.chatbot-undisclosed", "ai-act.chatbot-disclosed"],
  },

  {
    name: "Cookie knapp unter der Jahresgrenze",
    these:
      "Elf Monate Laufzeit entsprechen der Empfehlung der Aufsichtsbehörden. Genau dieser Wert darf nicht beanstandet werden — sonst ist der Rat unerfüllbar.",
    html: sauber(),
    cookies: [{ name: "consent", domain: "musterbau.example", expires: JETZT + Math.round(JAHR * 0.9) }],
    erwartet: [],
    verboten: ["dsgvo.cookie-lifetime"],
  },

  {
    name: "aktuelles jQuery",
    these:
      "Eine gepflegte, aktuelle Bibliothek darf keine Sicherheitswarnung auslösen. Die Versionsprüfung muss die Zahl lesen, nicht den Namen.",
    html: sauber('<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>'),
    erwartet: [],
    verboten: ["security.jquery-outdated"],
  },

  {
    name: "veraltetes jQuery 1.x",
    these: "Gegenprobe: jQuery 1.x hat bekannte XSS-Lücken und wird nicht mehr gepflegt.",
    html: sauber('<script src="/js/jquery-1.7.2.min.js"></script>'),
    erwartet: ["security.jquery-outdated"],
    verboten: [],
  },
];

// Alle browserfreien Module über eine Fixture laufen lassen.
export function pruefeFixture(f: Fixture): Finding[] {
  const url = "https://musterbau.example/";
  return [
    ...runContent(f.html, url, false),
    ...runPrivacy(f.html, f.requestUrls ?? [], f.cookies ?? []),
    ...runPsychology(f.html),
    ...runTechStack(f.html),
  ];
}

export interface Abweichung {
  fixture: string;
  art: "falsch-positiv" | "falsch-negativ";
  id: string;
}

// Alle Fixtures prüfen und die Abweichungen zurückgeben.
export function messeKalibrierung(): {
  abweichungen: Abweichung[];
  gepruefteErwartungen: number;
} {
  const abweichungen: Abweichung[] = [];
  let gepruefteErwartungen = 0;

  for (const f of FIXTURES) {
    const ids = new Set(pruefeFixture(f).map((x) => x.id));
    for (const id of f.erwartet) {
      gepruefteErwartungen++;
      if (!ids.has(id)) abweichungen.push({ fixture: f.name, art: "falsch-negativ", id });
    }
    for (const id of f.verboten) {
      gepruefteErwartungen++;
      if (ids.has(id)) abweichungen.push({ fixture: f.name, art: "falsch-positiv", id });
    }
  }
  return { abweichungen, gepruefteErwartungen };
}
