// Content-Modul: arbeitet auf dem bereits geladenen HTML (kein 2. Browserstart).
// Deckt drei Bereiche ab:
//   - DSGVO-Pflichtseiten (Impressum, Datenschutzerklärung)
//   - Barrierefreiheit (BFSG / WCAG-Heuristiken)
//   - EU AI Act (Chatbot-Transparenz, Art. 50)

import { Finding } from "../types";

// Bekannte Chat-/Bot-Widgets (oft KI-gestützt → Kennzeichnungspflicht).
// Chat-Werkzeuge, getrennt nach dem, was sie tatsächlich sind.
//
// Der AI Act verlangt Transparenz, wenn Menschen mit einem KI-SYSTEM
// interagieren. Ein von Menschen bedienter Live-Chat ist keins. Intercom,
// Zendesk & Co. sind in erster Linie Support-Postfächer — sie pauschal als
// „möglicher KI-Chatbot" zu melden, erzeugt einen Rechtsverdacht, für den es
// keinen Anhaltspunkt gibt.
const BOT_PLATTFORMEN = [
  // Plattformen, deren Zweck automatisierte Dialoge sind.
  "manychat", "voiceflow", "botpress", "landbot", "chatfuel", "dialogflow",
  "rasa.", "kore.ai", "ada.cx", "intercom-fin", "convai-widget",
];
const LIVECHAT_PLATTFORMEN = [
  // Plattformen, die überwiegend von Menschen bedient werden. Ein KI-Modus
  // ist dort zubuchbar, aber nicht die Voreinstellung.
  "intercom", "drift.com", "tidio", "crisp.chat", "tawk.to", "livechat",
  "zendesk", "hubspot", "userlike", "smartsupp", "chatwoot",
];

export function runContent(html: string, finalUrl: string, axeRan = false): Finding[] {
  const findings: Finding[] = [];
  if (!html) return findings;
  const lower = html.toLowerCase();

  // ---------- DSGVO: Impressum ----------
  const hasImpressum =
    /href=["'][^"']*impressum/i.test(html) || />\s*impressum\s*</i.test(html);
  findings.push(
    hasImpressum
      ? { id: "dsgvo.impressum", category: "dsgvo", title: "Impressum verlinkt", status: "pass", severity: "info", description: "Ein Impressum-Link wurde gefunden." }
      : { id: "dsgvo.no-impressum", category: "dsgvo", title: "Kein Impressum gefunden", status: "fail", severity: "high", description: "Auf der Startseite ist kein Impressum verlinkt.", recommendation: "Impressum mit vollständigen Pflichtangaben einbinden und von jeder Seite verlinken.", legalRef: "§ 5 DDG (ehem. § 5 TMG)" }
  );

  // ---------- DSGVO: Datenschutzerklärung ----------
  const hasPrivacy =
    /href=["'][^"']*(datenschutz|privacy)/i.test(html) ||
    />\s*(datenschutz|datenschutzerkl)/i.test(html);
  findings.push(
    hasPrivacy
      ? { id: "dsgvo.privacy", category: "dsgvo", title: "Datenschutzerklärung verlinkt", status: "pass", severity: "info", description: "Ein Datenschutz-Link wurde gefunden." }
      : { id: "dsgvo.no-privacy", category: "dsgvo", title: "Keine Datenschutzerklärung gefunden", status: "fail", severity: "critical", description: "Es ist keine Datenschutzerklärung verlinkt — auf praktisch jeder Website Pflicht.", recommendation: "DSGVO-konforme Datenschutzerklärung erstellen und verlinken.", legalRef: "Art. 13 DSGVO" }
  );

  // ---------- Barrierefreiheit (BFSG / WCAG) ----------
  // Fallback-Heuristik: greift NUR, wenn axe-core nicht laufen konnte.
  // Lief axe (Normalfall), liefert accessibility.ts die echten WCAG-Findings.
  if (!axeRan) {
  // 1. Sprach-Attribut
  if (/<html[^>]*\slang=["'][a-z]/i.test(html)) {
    findings.push({ id: "a11y.lang", category: "accessibility", title: "Sprach-Attribut gesetzt", status: "pass", severity: "info", description: "<html lang> ist vorhanden — wichtig für Screenreader." });
  } else {
    findings.push({ id: "a11y.no-lang", category: "accessibility", title: "Kein lang-Attribut", status: "fail", severity: "medium", description: "Dem <html>-Tag fehlt das lang-Attribut. Screenreader können die Sprache nicht erkennen.", recommendation: 'lang="de" am <html>-Tag ergänzen.', legalRef: "WCAG 3.1.1 / BFSG" });
  }

  // 2. Bilder ohne Alt-Text
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter((t) => !/\salt=/i.test(t));
  if (imgs.length > 0 && imgsNoAlt.length > 0) {
    findings.push({ id: "a11y.img-alt", category: "accessibility", title: `${imgsNoAlt.length} von ${imgs.length} Bildern ohne Alt-Text`, status: imgsNoAlt.length > imgs.length / 2 ? "fail" : "warn", severity: "medium", description: "Bilder ohne Alternativtext sind für blinde Nutzer unzugänglich.", recommendation: "Allen informativen Bildern ein aussagekräftiges alt-Attribut geben (dekorative: alt=\"\").", legalRef: "WCAG 1.1.1 / BFSG" });
  } else if (imgs.length > 0) {
    findings.push({ id: "a11y.img-alt-ok", category: "accessibility", title: "Alle Bilder mit Alt-Text", status: "pass", severity: "info", description: "Alle <img> haben ein alt-Attribut." });
  }

  // 3. H1-Überschrift vorhanden
  if (/<h1[\s>]/i.test(html)) {
    findings.push({ id: "a11y.h1", category: "accessibility", title: "H1-Überschrift vorhanden", status: "pass", severity: "info", description: "Die Seite hat eine Hauptüberschrift." });
  } else {
    findings.push({ id: "a11y.no-h1", category: "accessibility", title: "Keine H1-Überschrift", status: "warn", severity: "low", description: "Es fehlt eine <h1> — erschwert Orientierung und Screenreader-Navigation.", recommendation: "Genau eine aussagekräftige <h1> pro Seite verwenden.", legalRef: "WCAG 1.3.1 / 2.4.6" });
  }

  // 4. Viewport (mobile / Zoom)
  if (/<meta[^>]*name=["']viewport["']/i.test(html)) {
    findings.push({ id: "a11y.viewport", category: "accessibility", title: "Viewport-Meta gesetzt", status: "pass", severity: "info", description: "Responsive Viewport-Konfiguration vorhanden." });
  } else {
    findings.push({ id: "a11y.no-viewport", category: "accessibility", title: "Kein Viewport-Meta", status: "warn", severity: "low", description: "Ohne Viewport-Meta skaliert die Seite auf Mobilgeräten schlecht.", recommendation: '<meta name="viewport" content="width=device-width, initial-scale=1"> ergänzen.' });
  }

  // 5. Eingabefelder ohne Label (grobe Heuristik)
  const inputs = (html.match(/<input\b[^>]*>/gi) || []).filter((t) => !/type=["'](hidden|submit|button)["']/i.test(t));
  const labelCount = (html.match(/<label\b/gi) || []).length;
  if (inputs.length > 2 && labelCount === 0) {
    findings.push({ id: "a11y.no-labels", category: "accessibility", title: "Formularfelder ohne <label>", status: "warn", severity: "medium", description: `Es gibt ${inputs.length} Eingabefelder, aber kein <label>. Felder sind für Screenreader schwer bedienbar.`, recommendation: "Jedes Feld mit einem <label for=...> verknüpfen.", legalRef: "WCAG 1.3.1 / 4.1.2" });
  }
  } // Ende Fallback-Heuristik (!axeRan)

  // ---------- EU AI Act: Chatbot-Transparenz ----------
  const botPlattform = BOT_PLATTFORMEN.find((w) => lower.includes(w));
  const livechat = LIVECHAT_PLATTFORMEN.find((w) => lower.includes(w));
  const widget = botPlattform ?? livechat;
  if (widget) {
    const disclosed = /(ki-?(assistent|bot|chat)|künstliche intelligenz|automatisierter (chat|assistent)|virtuelle[rn]? assistent|ai assistant|powered by ai|chatbot)/i.test(html);
    if (disclosed) {
      findings.push({ id: "ai-act.chatbot-disclosed", category: "ai-act", title: "Chatbot vorhanden & gekennzeichnet", status: "pass", severity: "info", description: `Chat-Widget erkannt (${widget}) mit Hinweis auf KI/Automatisierung.` });
    } else if (!botPlattform) {
      // Live-Chat ohne KI-Hinweis: Das ist der Normalfall und kein Mangel.
      findings.push({
        id: "ai-act.livechat-present",
        category: "ai-act",
        title: "Chat-Werkzeug erkannt (Live-Chat)",
        status: "pass",
        severity: "info",
        description: `Es wurde ein Chat-Werkzeug gefunden (${widget}). Solche Postfächer werden überwiegend von Menschen bedient — dann besteht keine Transparenzpflicht nach Art. 50 AI Act.`,
        recommendation: "Nur falls dort ein KI-Modus aktiv ist: an der Stelle der Interaktion kenntlich machen, dass ein System antwortet.",
      });
    } else {
      findings.push({ id: "ai-act.chatbot-undisclosed", category: "ai-act", title: "Chatbot ohne klare KI-Kennzeichnung", status: "warn", severity: "medium", description: `Ein Chat-Widget wurde erkannt (${widget}), aber kein eindeutiger Hinweis, dass es sich um ein KI-/automatisiertes System handelt.`, recommendation: "Falls KI-gestützt: Nutzer transparent darüber informieren, dass sie mit einem KI-System interagieren.", legalRef: "Art. 50 EU AI Act (Transparenzpflicht, ab 08/2026)" });
    }
  } else {
    findings.push({ id: "ai-act.no-chatbot", category: "ai-act", title: "Kein Chatbot erkannt", status: "pass", severity: "info", description: "Es wurde kein bekanntes Chat-/Bot-Widget gefunden — keine AI-Act-Transparenzpflicht aus diesem Grund." });
  }

  // Hinweis: AI Act ist automatisiert nur eingeschränkt prüfbar.
  findings.push({ id: "ai-act.note", category: "ai-act", title: "Hinweis zur AI-Act-Prüfung", status: "pass", severity: "info", description: "Der EU AI Act betrifft KI-Systeme, nicht primär Websites. Diese automatische Prüfung deckt nur sichtbare Anzeichen (z.B. Chatbots) ab und ersetzt keine Rechtsberatung.", evidence: [finalUrl] });

  return findings;
}
