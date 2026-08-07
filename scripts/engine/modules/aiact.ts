// EU-AI-Act-Modul: sichtbare Anzeichen für KI-Einsatz auf der Website.
//
// Zeitlicher Rahmen: Die Transparenzpflichten aus Art. 50 gelten seit dem
// 2. August 2026. Betroffen ist, wer KI-Systeme betreibt, die mit Menschen
// interagieren (Art. 50 Abs. 1) oder synthetische Bilder/Videos veröffentlicht,
// die echten Personen, Orten oder Ereignissen ähneln — Deepfakes (Abs. 4).
//
// Ehrlichkeitsgebot dieses Moduls: Ob ein Bild KI-generiert ist, lässt sich von
// außen NICHT beweisen. Was sich beweisen lässt, sind Herkunftsspuren:
//   - C2PA/Content Credentials (kryptografisch signierte Herkunft, Adobe,
//     OpenAI, Google, Leica) — als JUMBF-Block in der Datei,
//   - der IPTC-Wert `trainedAlgorithmicMedia` (Standardkennung für KI-Medien),
//   - Speicherorte und Dateinamen bekannter Generatoren.
// Findet das Modul solche Spuren, benennt es sie als Spuren — nicht als Urteil.
// Ohne Spuren wird KEINE Aussage getroffen (kein "vermutlich KI"), weil genau
// diese Sorte Halbwissen im Report mehr schadet als nützt.

import { Finding } from "../types";
import { safeFetch } from "../ssrf";

// Speicherorte und Namensmuster bekannter Bildgeneratoren.
const GENERATOR_MUSTER: { name: string; re: RegExp }[] = [
  { name: "OpenAI DALL·E / GPT-Image", re: /oaidalleapiprodscus\.blob\.core\.windows\.net|\bdall-?e\b|cdn\.openai\.com/i },
  { name: "Midjourney", re: /cdn\.midjourney\.com|midjourney/i },
  { name: "Stable Diffusion", re: /stable-?diffusion|stability\.ai|sdxl/i },
  { name: "Adobe Firefly", re: /firefly\.adobe\.com|adobe-?firefly/i },
  { name: "Replicate", re: /replicate\.delivery/i },
  { name: "Leonardo.ai", re: /cdn\.leonardo\.ai/i },
  { name: "Ideogram", re: /ideogram\.ai/i },
  { name: "Flux", re: /\bflux-?(1|pro|dev|schnell)\b/i },
  { name: "Google Imagen / Gemini", re: /imagen|gemini-generated/i },
  { name: "Allgemeine KI-Kennzeichnung im Dateinamen", re: /\b(ai|ki)[-_]?(generated|generiert|erzeugt|image|bild)\b|\b(generated|generiert)[-_]?(by[-_]?)?(ai|ki)\b/i },
];

// Eingebundene KI-Dienste (Interaktion mit Menschen → Art. 50 Abs. 1).
const KI_DIENSTE: { name: string; re: RegExp }[] = [
  { name: "OpenAI API", re: /api\.openai\.com/i },
  { name: "Anthropic API", re: /api\.anthropic\.com/i },
  { name: "Mistral API", re: /api\.mistral\.ai/i },
  { name: "Google Generative AI", re: /generativelanguage\.googleapis\.com/i },
  { name: "Hugging Face", re: /huggingface\.co|hf\.space/i },
  { name: "Replicate", re: /api\.replicate\.com/i },
  { name: "ElevenLabs (Sprachsynthese / ConvAI-Widget)", re: /elevenlabs\.io|@elevenlabs\/|convai-widget/i },
  { name: "Voiceflow", re: /voiceflow\.com/i },
  { name: "Botpress", re: /botpress\.(cloud|com)/i },
];

// Biometrie/Emotionserkennung im Browser. Emotionserkennung am Arbeitsplatz und
// in Bildungseinrichtungen ist nach Art. 5 verboten, biometrische Kategorisierung
// stark eingeschränkt — ein Fund gehört in jedem Fall geprüft.
const BIOMETRIE: { name: string; re: RegExp }[] = [
  { name: "face-api.js (Gesichtserkennung)", re: /face-?api(\.min)?\.js|faceapi/i },
  { name: "MediaPipe Face/Iris", re: /mediapipe\/face|face_mesh|iris_landmark/i },
  { name: "TensorFlow.js Face-/Emotion-Modelle", re: /blazeface|facemesh|emotion-?(net|detection)/i },
  { name: "clmtrackr / tracking.js", re: /clmtrackr|tracking\.js/i },
  { name: "Amazon Rekognition", re: /rekognition\.[a-z0-9-]+\.amazonaws\.com/i },
  { name: "Azure Face API", re: /api\.cognitive\.microsoft\.com\/face/i },
];

// Sichtbare Kennzeichnung von KI-Inhalten irgendwo auf der Seite.
const KENNZEICHNUNG =
  /\b(ki|ai)[- ]?(generiert|erzeugt|erstellt|generated|created)\b|\bmit\s+(ki|künstlicher intelligenz)\s+(erstellt|erzeugt|generiert)\b|\bcontent credentials\b|\bsynthetisch(e|es)?\s+(bild|medien|inhalt)/i;

// Erste Bytes einer Bilddatei holen. C2PA-Manifeste und XMP stehen am
// Dateianfang — 96 KB reichen, ohne jedes Bild vollständig zu laden.
async function bildKopf(url: string, timeoutMs = 5000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "ComplianceCheckerBot/1.0 (+https://check.viktortorno.de)",
        Range: "bytes=0-98304",
      },
    });
    if (!res.ok && res.status !== 206) return "";
    const buf = await res.arrayBuffer();
    // Binär als Latin-1 lesen: die gesuchten Marker sind ASCII-Zeichenketten
    // in einem sonst binären Strom.
    return Buffer.from(buf).toString("latin1");
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

export async function runAiAct(html: string, finalUrl: string, requestUrls: string[] = []): Promise<Finding[]> {
  const findings: Finding[] = [];
  if (!html) return findings;

  const alleUrls = requestUrls.join(" ");
  const durchsucht = `${html} ${alleUrls}`;
  const kennzeichnungVorhanden = KENNZEICHNUNG.test(html);

  // ---------- 1. Bildherkunft prüfen ----------
  const bildQuellen: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["']/gi)) bildQuellen.push(m[1]);
  for (const m of html.matchAll(/<source\b[^>]*\ssrcset=["']([^"',\s]+)/gi)) bildQuellen.push(m[1]);

  const absolut = [...new Set(bildQuellen)]
    .map((s) => { try { return new URL(s, finalUrl).toString(); } catch { return ""; } })
    .filter((u) => /^https?:/i.test(u) && !/^data:/i.test(u));

  // a) Spuren im Pfad/Dateinamen — kostet keinen Abruf.
  const namensTreffer = GENERATOR_MUSTER
    .map((g) => ({ name: g.name, urls: absolut.filter((u) => g.re.test(u)) }))
    .filter((g) => g.urls.length > 0);

  // b) Signierte Herkunft in den Dateien selbst. Bewusst nur die ersten fünf
  //    Bilder: der Scan darf nicht an einer Bildergalerie hängenbleiben.
  const kandidaten = absolut.filter((u) => /\.(jpe?g|png|webp|avif)(\?|$)/i.test(u)).slice(0, 5);
  const koepfe = await Promise.all(kandidaten.map((u) => bildKopf(u)));
  const signiert: string[] = [];
  for (let i = 0; i < kandidaten.length; i++) {
    const kopf = koepfe[i];
    if (!kopf) continue;
    if (/trainedAlgorithmicMedia/i.test(kopf)) signiert.push(`${kandidaten[i].split("/").pop()} — IPTC: trainedAlgorithmicMedia`);
    else if (/c2pa|jumbf|contentauth/i.test(kopf)) signiert.push(`${kandidaten[i].split("/").pop()} — Content Credentials (C2PA)`);
    else if (/(DALL·E|DALL-E|Midjourney|Stable Diffusion|Firefly)/i.test(kopf)) signiert.push(`${kandidaten[i].split("/").pop()} — Generator im Metadatum`);
  }

  if (signiert.length > 0 || namensTreffer.length > 0) {
    const belege = [
      ...signiert,
      ...namensTreffer.map((g) => `${g.name}: ${g.urls.length} Bild(er), z. B. ${g.urls[0].split("/").pop()}`),
    ].slice(0, 8);
    if (kennzeichnungVorhanden) {
      findings.push({
        id: "ai-act.ai-images-labeled", category: "ai-act",
        title: "KI-Bildspuren gefunden — Kennzeichnung vorhanden",
        status: "pass", severity: "info",
        description: "In den eingebundenen Bildern wurden Herkunftsspuren generativer Systeme gefunden, und die Seite weist an anderer Stelle auf KI-erzeugte Inhalte hin.",
        evidence: belege,
      });
    } else {
      findings.push({
        id: "ai-act.ai-images-unlabeled", category: "ai-act",
        title: `KI-Bildspuren ohne Kennzeichnung (${signiert.length + namensTreffer.length} Fund(e))`,
        status: "warn", severity: "medium",
        description:
          "Es wurden Spuren generativer Bildsysteme gefunden (signierte Herkunft, IPTC-Kennung oder Speicherort/Dateiname), aber kein sichtbarer Hinweis auf KI-erzeugte Inhalte. Zeigt ein solches Bild echte Personen, Orte oder Ereignisse, greift die Offenlegungspflicht für Deepfakes; in allen anderen Fällen ist die Kennzeichnung eine Frage der Glaubwürdigkeit.",
        recommendation: "KI-erzeugte Bilder sichtbar kennzeichnen (Bildunterschrift oder Hinweis im Impressum/Bildnachweis) und die Content Credentials in der Datei belassen.",
        legalRef: "Art. 50 Abs. 4 EU AI Act (seit 02.08.2026 anwendbar)",
        evidence: belege,
      });
    }
  } else if (kandidaten.length > 0) {
    findings.push({
      id: "ai-act.no-ai-image-traces", category: "ai-act",
      title: "Keine KI-Spuren in den Bildern",
      status: "pass", severity: "info",
      description: `${kandidaten.length} Bild(er) auf Herkunftsdaten geprüft (C2PA/Content Credentials, IPTC-Kennung, Speicherort) — kein Hinweis auf generative Erzeugung. Das ist kein Beweis für Fotografie: Metadaten gehen beim Bearbeiten und Skalieren regelmäßig verloren.`,
    });
  }

  // ---------- 2. Eingebundene KI-Dienste ----------
  const dienste = KI_DIENSTE.filter((d) => d.re.test(durchsucht));
  if (dienste.length > 0) {
    findings.push({
      id: "ai-act.ai-services", category: "ai-act",
      title: `${dienste.length} KI-Dienst(e) eingebunden`,
      // Bewusst KEIN "pass" allein wegen eines Hinweises irgendwo auf der Seite.
      //
      // Art. 50 Abs. 1 verlangt die Information rechtzeitig — spätestens bei
      // der ersten Interaktion. Ein Satz im Impressum oder in der
      // Datenschutzerklärung erfüllt das nicht. Ob der Hinweis am richtigen
      // Ort steht, kann diese Prüfung nicht feststellen; deshalb bleibt es ein
      // Hinweis zum Nachsehen statt eines Freispruchs.
      status: "warn",
      severity: "low",
      description:
        "Die Seite spricht KI-Dienste direkt an. Wer mit einem solchen System interagiert, muss spätestens bei der ersten Interaktion darüber informiert werden — nicht erst in der Datenschutzerklärung." +
        (kennzeichnungVorhanden
          ? " Ein KI-Hinweis wurde auf der Seite gefunden; ob er an der Stelle der Interaktion steht, lässt sich automatisch nicht feststellen."
          : " Ein solcher Hinweis wurde nicht gefunden."),
      recommendation: "An der Stelle der Interaktion kenntlich machen, dass ein KI-System antwortet, und die Verarbeitung in der Datenschutzerklärung beschreiben.",
      legalRef: "Art. 50 Abs. 1 EU AI Act",
      evidence: dienste.map((d) => d.name),
    });
  }

  // ---------- 3. Biometrie / Emotionserkennung ----------
  const biometrie = BIOMETRIE.filter((b) => b.re.test(durchsucht));
  if (biometrie.length > 0) {
    findings.push({
      id: "ai-act.biometrics", category: "ai-act",
      title: `Biometrie-/Gesichtsanalyse im Einsatz (${biometrie.length})`,
      status: "fail", severity: "high",
      description:
        "Es wurden Bibliotheken zur Gesichts- bzw. Emotionsanalyse gefunden. Emotionserkennung am Arbeitsplatz und in Bildungseinrichtungen ist verboten, biometrische Kategorisierung stark eingeschränkt — unabhängig davon greift bei biometrischen Daten Art. 9 DSGVO (besondere Kategorie, ausdrückliche Einwilligung).",
      recommendation: "Einsatzzweck prüfen und dokumentieren. Ohne belastbare Rechtsgrundlage entfernen; sonst ausdrückliche Einwilligung einholen und in der Datenschutzerklärung beschreiben.",
      legalRef: "Art. 5 EU AI Act, Art. 9 DSGVO",
      evidence: biometrie.map((b) => b.name),
    });
  }

  // ---------- 4. Generator-Kennung ----------
  const generator = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i);
  if (generator && /\b(ai|ki|gpt|claude|copilot|jasper|writesonic|neuroflash)\b/i.test(generator[1])) {
    findings.push({
      id: "ai-act.generator-meta", category: "ai-act",
      title: "KI-Werkzeug im Generator-Tag genannt",
      status: "warn", severity: "low",
      description: `Das Generator-Meta-Tag nennt ein KI-Werkzeug („${generator[1]}“). Bei Texten zu Themen von öffentlichem Interesse verlangt der AI Act eine Offenlegung KI-erzeugter Inhalte.`,
      recommendation: "Prüfen, ob die veröffentlichten Texte offenlegungspflichtig sind, und redaktionelle Verantwortung sichtbar machen (Autor, Prüfung).",
      legalRef: "Art. 50 Abs. 4 EU AI Act",
      evidence: [generator[1]],
    });
  }

  return findings;
}
