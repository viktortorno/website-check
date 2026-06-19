// Psychologie-/Conversion-Modul: Wie überzeugend ist die Seite aufgebaut?
// Prüft heuristisch die bewährten Bausteine wirksamer Landingpages
// (Cialdini-Prinzipien + Conversion-Best-Practices):
//   - Klarer Call-to-Action (Handlungsaufforderung)
//   - Nutzenversprechen "above the fold" (H1 + Subline)
//   - Social Proof (Testimonials, Bewertungen, Kundenlogos)
//   - Vertrauenssignale (Garantien, Siegel, echte Kontaktwege)
//   - Reziprozität / Lead-Magnet (kostenloses Angebot)
//   - Verknappung & Dringlichkeit (maßvoll, nicht manipulativ)
//
// Rein heuristisch auf dem gerenderten HTML — versteht keine Semantik, sondern
// erkennt typische Muster/Formulierungen. Liefert Anhaltspunkte, kein Gutachten.

import { Finding } from "../types";

// Nur den sichtbaren Text grob extrahieren (Tags/Script/Style raus).
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const CTA_PHRASES = [
  "jetzt", "kostenlos", "anfragen", "buchen", "termin", "kontakt aufnehmen",
  "loslegen", "starten", "anmelden", "registrieren", "demo", "angebot",
  "beratung", "mehr erfahren", "herunterladen", "kaufen", "bestellen",
  "gespräch", "call", "get started", "sign up", "book", "request",
];

const SOCIAL_PROOF = [
  "testimonial", "bewertung", "rezension", "kundenstimmen", "referenz",
  "trustpilot", "google bewertung", "sterne", "★", "⭐", "proven expert",
  "auszeichnung", "zufriedene kund", "das sagen", "erfahrungen", "review",
  "5 sterne", "4,9", "4.9", "bekannt aus", "vertrauen", "kunden",
];

const TRUST_SIGNALS = [
  "garantie", "geld-zurück", "geld zurück", "zertifiziert", "tüv", "iso ",
  "ssl", "dsgvo-konform", "datenschutz", "sicher", "verschlüsselt", "siegel",
  "money-back", "guarantee", "kostenlose stornierung", "geprüft",
];

const URGENCY = [
  "nur noch", "begrenzt", "limitiert", "endet", "letzte chance", "heute",
  "jetzt sichern", "solange der vorrat", "countdown", "verbleibend",
  "exklusiv", "nur für kurze zeit", "frühbucher", "limited", "deadline",
];

export function runPsychology(html: string): Finding[] {
  const findings: Finding[] = [];
  if (!html) return findings;
  const text = visibleText(html);

  // ---------- 1. Klarer Call-to-Action ----------
  const buttons = (html.match(/<(button|a)\b[^>]*>([\s\S]*?)<\/\1>/gi) || []);
  const ctaButtons = buttons.filter((b) => {
    const t = visibleText(b);
    return CTA_PHRASES.some((p) => t.includes(p));
  });
  if (ctaButtons.length === 0) {
    findings.push({ id: "psy.no-cta", category: "psychology", title: "Kein klarer Call-to-Action erkannt", status: "fail", severity: "high", description: "Es wurde kein eindeutiger Handlungs-Button (z. B. „Jetzt Termin buchen”, „Kostenlos anfragen”) gefunden. Ohne klare Handlungsaufforderung wissen Besucher nicht, was sie tun sollen — der häufigste Conversion-Killer.", recommendation: "Einen prominenten, handlungsorientierten CTA-Button platzieren (Verb + Nutzen, z. B. „Kostenloses Erstgespräch sichern”)." });
  } else if (ctaButtons.length > 12) {
    findings.push({ id: "psy.too-many-cta", category: "psychology", title: `Sehr viele CTAs (${ctaButtons.length})`, status: "warn", severity: "low", description: "Auffällig viele konkurrierende Handlungsaufforderungen können überfordern (Choice Overload).", recommendation: "Eine primäre Handlung pro Abschnitt klar hervorheben, sekundäre zurücknehmen." });
  } else {
    findings.push({ id: "psy.cta-ok", category: "psychology", title: "Call-to-Action vorhanden", status: "pass", severity: "info", description: `${ctaButtons.length} handlungsorientierte Schaltfläche(n) erkannt.` });
  }

  // ---------- 2. Nutzenversprechen above the fold (H1 + Subline) ----------
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1 ? h1[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!h1Text) {
    findings.push({ id: "psy.no-headline", category: "psychology", title: "Keine klare Hauptbotschaft (H1)", status: "fail", severity: "medium", description: "Ohne prägnante Überschrift „above the fold” erfassen Besucher in den ersten Sekunden nicht, worum es geht — und springen ab.", recommendation: "Eine nutzenorientierte H1 setzen, die in einem Satz sagt, was der Besucher davon hat." });
  } else if (h1Text.length < 12) {
    findings.push({ id: "psy.weak-headline", category: "psychology", title: "Hauptbotschaft sehr knapp", status: "warn", severity: "low", description: `Die H1 („${h1Text}”) ist sehr kurz und transportiert evtl. wenig Nutzen.`, recommendation: "Die Headline um ein konkretes Nutzenversprechen erweitern (Ergebnis für den Kunden)." });
  } else {
    findings.push({ id: "psy.headline-ok", category: "psychology", title: "Klare Hauptbotschaft vorhanden", status: "pass", severity: "info", description: `Die Seite startet mit einer aussagekräftigen Überschrift: „${h1Text}”.` });
  }

  // ---------- 3. Social Proof ----------
  const proofHits = SOCIAL_PROOF.filter((p) => text.includes(p));
  if (proofHits.length === 0) {
    findings.push({ id: "psy.no-social-proof", category: "psychology", title: "Kein Social Proof erkennbar", status: "warn", severity: "medium", description: "Es wurden keine Hinweise auf Kundenstimmen, Bewertungen, Referenzen oder Auszeichnungen gefunden. Sozialer Beweis ist einer der stärksten Vertrauens- und Conversion-Hebel (Cialdini).", recommendation: "Echte Testimonials, Bewertungssterne, Kundenlogos oder Fallstudien sichtbar einbinden." });
  } else {
    findings.push({ id: "psy.social-proof-ok", category: "psychology", title: "Social Proof vorhanden", status: "pass", severity: "info", description: "Hinweise auf Bewertungen/Referenzen/Auszeichnungen gefunden — stärkt das Vertrauen neuer Besucher.", evidence: proofHits.slice(0, 6) });
  }

  // ---------- 4. Vertrauenssignale ----------
  const trustHits = TRUST_SIGNALS.filter((p) => text.includes(p));
  if (trustHits.length === 0) {
    findings.push({ id: "psy.no-trust", category: "psychology", title: "Wenige Vertrauenssignale", status: "warn", severity: "low", description: "Es wurden kaum vertrauensbildende Elemente (Garantien, Siegel, Sicherheitshinweise) erkannt. Sie senken das wahrgenommene Risiko vor einer Kontaktaufnahme oder einem Kauf.", recommendation: "Garantien, Zertifikate/Siegel und Sicherheitshinweise an Entscheidungspunkten platzieren." });
  } else {
    findings.push({ id: "psy.trust-ok", category: "psychology", title: "Vertrauenssignale vorhanden", status: "pass", severity: "info", description: "Vertrauensbildende Elemente (z. B. Garantien/Siegel) gefunden.", evidence: trustHits.slice(0, 6) });
  }

  // ---------- 5. Erreichbarkeit / Kontaktmöglichkeit ----------
  const hasPhone = /(tel:|href=["']tel:)/i.test(html) || /\b(0[\s\d\/\-]{6,}\d)\b/.test(text);
  const hasMail = /mailto:/i.test(html);
  const hasForm = /<form\b/i.test(html);
  const contactChannels = [hasPhone && "Telefon", hasMail && "E-Mail", hasForm && "Formular"].filter(Boolean) as string[];
  if (contactChannels.length === 0) {
    findings.push({ id: "psy.no-contact", category: "psychology", title: "Keine direkte Kontaktmöglichkeit", status: "warn", severity: "medium", description: "Es wurde weder Telefon, E-Mail noch ein Kontaktformular erkannt. Fehlende, niederschwellige Kontaktwege kosten Leads.", recommendation: "Mindestens einen direkten Kontaktweg (Formular, Telefon mit klickbarem tel:-Link, E-Mail) gut sichtbar anbieten." });
  } else {
    findings.push({ id: "psy.contact-ok", category: "psychology", title: "Kontaktmöglichkeit vorhanden", status: "pass", severity: "info", description: `Kontaktwege erkannt: ${contactChannels.join(", ")}.` });
  }

  // ---------- 6. Reziprozität / Lead-Magnet ----------
  const hasLeadMagnet = /(kostenlos|gratis|free|checkliste|whitepaper|e-?book|leitfaden|webinar|guide|vorlage|template|erstgespräch|probe)/i.test(text);
  if (hasLeadMagnet) {
    findings.push({ id: "psy.reciprocity-ok", category: "psychology", title: "Kostenfreies Angebot / Lead-Magnet", status: "pass", severity: "info", description: "Ein kostenloser Mehrwert (z. B. Erstgespräch, Checkliste, Guide) wurde erkannt — nutzt das Prinzip der Reziprozität und senkt die Einstiegshürde." });
  } else {
    findings.push({ id: "psy.no-reciprocity", category: "psychology", title: "Kein niederschwelliges Einstiegsangebot", status: "warn", severity: "low", description: "Es wurde kein kostenloser „erster Schritt” (Erstgespräch, Checkliste, Demo) erkannt. Ein Lead-Magnet senkt die Hemmschwelle für unentschlossene Besucher.", recommendation: "Einen kostenlosen, wertvollen Einstieg anbieten (z. B. „Kostenlose Website-Analyse” — wie dieses Tool)." });
  }

  // ---------- 7. Verknappung / Dringlichkeit (informativ) ----------
  const urgencyHits = URGENCY.filter((p) => text.includes(p));
  if (urgencyHits.length > 0) {
    findings.push({ id: "psy.urgency", category: "psychology", title: "Dringlichkeit/Verknappung eingesetzt", status: "pass", severity: "info", description: "Elemente von Dringlichkeit/Verknappung erkannt. Maßvoll und ehrlich eingesetzt erhöhen sie die Handlungsbereitschaft — übertrieben oder falsch wirken sie unseriös und können abmahnbar sein.", evidence: urgencyHits.slice(0, 5) });
  }

  return findings;
}
