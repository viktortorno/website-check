// DNS-Modul: E-Mail-Sicherheit (SPF, DMARC, DKIM).
// Fehlende Records bedeuten: Angreifer können im Namen der Domain Mails fälschen
// (Spoofing/Phishing) — relevant für Sicherheit UND Reputation.

import { resolveTxt, resolveCaa } from "node:dns/promises";
import { Finding } from "../types";

async function txt(host: string): Promise<string[]> {
  try {
    const records = await resolveTxt(host);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

// Zweistufige öffentliche Suffixe, bei denen erst die dritte Ebene eine
// registrierbare (Organisations-)Domain ist — z.B. "firma.co.uk", nicht "co.uk".
// Keine vollständige Public-Suffix-Liste, sondern die gängigsten Fälle: ohne
// diese Liste würde die Domain-Suche bei "firma.co.uk" fälschlich bei "co.uk"
// aufhören und dort DMARC nachschlagen, statt beim eigentlichen Betreiber.
export const TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.za", "co.il", "co.in",
  "com.br", "com.mx", "com.tr",
]);

// DMARC gilt auch dann für eine Subdomain, wenn nur die ORGANISATIONSDOMAIN
// einen _dmarc-Record trägt (RFC 7489, "Organizational Domain"). Ohne diese
// Vererbung meldet der Scan bei jeder Subdomain fälschlich "kein DMARC" —
// selbst wenn die Hauptdomain sauber konfiguriert ist.
//
// Läuft von der vollen Domain nach oben und bricht ab, sobald die
// registrierbare Domain erreicht ist (kein Aufstieg bis zur reinen TLD).
export async function findDmarc(domain: string): Promise<{ record: string; domain: string } | null> {
  const labels = domain.split(".");
  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join(".");
    const remaining = labels.length - i;
    if (remaining === 2 && TWO_LABEL_PUBLIC_SUFFIXES.has(candidate)) continue; // Suffix selbst, keine echte Domain
    const rec = (await txt(`_dmarc.${candidate}`)).find((r) => r.toLowerCase().startsWith("v=dmarc1"));
    if (rec) return { record: rec, domain: candidate };
  }
  return null;
}

// Wie viele DNS-Abfragen löst dieser SPF-Record aus?
//
// RFC 7208 § 4.6.4 erlaubt HÖCHSTENS ZEHN. Gezählt werden die Mechanismen
// a, mx, ptr, exists und include sowie der redirect-Modifier — und zwar
// rekursiv: Jedes include bringt die Lookups des eingebundenen Records mit.
//
// Warum das wichtiger ist, als es klingt: Wer Microsoft 365, ein Newsletter-
// Werkzeug und ein CRM einträgt, reißt die Grenze schnell. Der Record gilt
// dann als Ganzes als ungültig ("permerror") — nicht etwa teilweise. Die Folge
// sind Zustellprobleme, die niemand mit SPF in Verbindung bringt, weil der
// Record im DNS ja sichtbar dasteht.
//
// Die Zählung bricht bei 15 ab: Ob es 15 oder 40 sind, ändert am Befund nichts,
// und der Scan soll keine DNS-Lawine auslösen.
export async function zaehleSpfLookups(
  record: string,
  domain: string,
  tiefe = 0,
  gesehen = new Set<string>()
): Promise<{ anzahl: number; kette: string[] }> {
  if (tiefe > 5) return { anzahl: 0, kette: [] };
  let anzahl = 0;
  const kette: string[] = [];

  for (const teil of record.split(/\s+/)) {
    const t = teil.toLowerCase().replace(/^[+\-~?]/, "");
    if (/^(a|mx|ptr)(:|$)/.test(t) || t.startsWith("exists:")) {
      anzahl++;
      continue;
    }
    const ziel = t.startsWith("include:") ? t.slice(8) : t.startsWith("redirect=") ? t.slice(9) : null;
    if (!ziel) continue;

    anzahl++;
    kette.push(ziel);
    // Schleifen abfangen (include:a → include:b → include:a).
    if (gesehen.has(ziel) || anzahl > 15) continue;
    gesehen.add(ziel);

    const eingebunden = (await txt(ziel)).find((r) => r.toLowerCase().startsWith("v=spf1"));
    if (eingebunden) {
      const unter = await zaehleSpfLookups(eingebunden, ziel, tiefe + 1, gesehen);
      anzahl += unter.anzahl;
      kette.push(...unter.kette.map((k) => `${ziel} → ${k}`));
    }
    if (anzahl > 15) break;
  }
  return { anzahl, kette };
}

export async function runDns(hostname: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  // www. abstreifen — Mail-Records hängen an der Hauptdomain.
  const domain = hostname.replace(/^www\./, "");

  // --- SPF ---
  const root = await txt(domain);
  const spf = root.find((r) => r.toLowerCase().startsWith("v=spf1"));
  if (spf) {
    const { anzahl, kette } = await zaehleSpfLookups(spf, domain);
    if (anzahl > 10) {
      findings.push({
        id: "security.spf-lookup-limit",
        category: "security",
        title: `SPF überschreitet das Lookup-Limit (${anzahl > 15 ? "über 15" : anzahl} statt maximal 10)`,
        status: "fail",
        severity: "high",
        description:
          "Ein SPF-Record darf höchstens zehn DNS-Abfragen auslösen. Diese Grenze ist überschritten — empfangende Server werten den Record dann als Ganzes als fehlerhaft (permerror), nicht etwa teilweise. Die Prüfung schlägt damit still fehl, obwohl im DNS ein sauber aussehender Eintrag steht. Typische Ursache: mehrere Dienste (Microsoft 365, Newsletter, CRM) sind gleichzeitig eingebunden.",
        recommendation:
          "Nicht mehr genutzte include-Einträge entfernen und die verbleibenden zusammenfassen (SPF-Flattening beim Anbieter oder feste IP-Bereiche statt verschachtelter includes).",
        legalRef: "RFC 7208 § 4.6.4",
        evidence: [`${anzahl} Lookups`, ...kette.slice(0, 8)],
      });
    } else {
      findings.push({
        id: "security.spf",
        category: "security",
        title: "SPF-Record vorhanden",
        status: "pass",
        severity: "info",
        description: `Ein SPF-Eintrag schützt vor E-Mail-Spoofing. Er löst ${anzahl} von maximal 10 erlaubten DNS-Abfragen aus.`,
      });
    }
  } else {
    findings.push({
      id: "security.no-spf",
      category: "security",
      title: "Kein SPF-Record",
      status: "warn",
      severity: "medium",
      description: "Ohne SPF können Dritte E-Mails im Namen dieser Domain versenden.",
      recommendation: "SPF-TXT-Record im DNS hinterlegen (v=spf1 ...).",
    });
  }

  // --- DMARC (mit Vererbung von der Organisationsdomain) ---
  const found = await findDmarc(domain);
  if (found) {
    const policy = /p=(none|quarantine|reject)/i.exec(found.record)?.[1]?.toLowerCase();
    const onOrgDomain = found.domain !== domain;
    const viaNote = onOrgDomain ? ` (geerbt von der Organisationsdomain ${found.domain})` : "";
    if (policy === "none") {
      findings.push({
        id: "security.dmarc-monitor",
        category: "security",
        title: "DMARC nur im Monitoring-Modus (p=none)",
        status: "warn",
        severity: "low",
        description: `DMARC ist gesetzt${viaNote}, aber ohne Schutzwirkung (p=none).`,
        recommendation: "Schrittweise auf p=quarantine bzw. p=reject erhöhen.",
      });
    } else {
      findings.push({
        id: "security.dmarc",
        category: "security",
        title: `DMARC aktiv (p=${policy})`,
        status: "pass",
        severity: "info",
        description: `DMARC schützt aktiv vor Spoofing${viaNote}.`,
      });
    }
  } else {
    findings.push({
      id: "security.no-dmarc",
      category: "security",
      title: "Kein DMARC-Record",
      status: "warn",
      severity: "medium",
      description: "Weder für diese Domain noch für die übergeordnete Organisationsdomain wurde ein DMARC-Record gefunden.",
      recommendation: "DMARC-TXT-Record unter _dmarc.<domain> anlegen.",
    });
  }

  // --- DKIM (häufige Selektoren testen, da selektorabhängig) ---
  const selectors = ["default", "google", "selector1", "selector2", "k1", "dkim", "mail"];
  let dkimFound = false;
  for (const sel of selectors) {
    const rec = await txt(`${sel}._domainkey.${domain}`);
    if (rec.some((r) => /v=dkim1|k=rsa|p=/i.test(r))) {
      dkimFound = true;
      break;
    }
  }
  if (dkimFound) {
    findings.push({
      id: "security.dkim",
      category: "security",
      title: "DKIM-Schlüssel gefunden",
      status: "pass",
      severity: "info",
      description: "DKIM signiert ausgehende Mails kryptografisch.",
    });
  } else {
    findings.push({
      id: "security.dkim-unknown",
      category: "security",
      title: "DKIM nicht eindeutig gefunden",
      status: "warn",
      severity: "low",
      description: "Über die gängigen Selektoren wurde kein DKIM-Schlüssel gefunden (kann an einem individuellen Selektor liegen).",
      recommendation: "DKIM für die Mail-Domain einrichten/prüfen.",
    });
  }

  // --- Transportverschlüsselung der Mail-Zustellung (MTA-STS, TLS-RPT) ---
  //
  // SPF/DKIM/DMARC sagen, WER senden darf. Sie sagen nichts darüber, ob die
  // Zustellung verschlüsselt läuft. SMTP fällt ohne MTA-STS bei einem Fehler
  // stillschweigend auf unverschlüsselt zurück — ein Angreifer in der Leitung
  // muss die TLS-Aushandlung nur stören ("downgrade"), und die Mail geht im
  // Klartext. MTA-STS verbietet genau das, TLS-RPT meldet Fehlversuche.
  const [mtaSts, tlsRpt] = await Promise.all([
    txt(`_mta-sts.${domain}`),
    txt(`_smtp._tls.${domain}`),
  ]);
  const hatMtaSts = mtaSts.some((r) => /v=STSv1/i.test(r));
  const hatTlsRpt = tlsRpt.some((r) => /v=TLSRPTv1/i.test(r));

  if (hatMtaSts) {
    findings.push({
      id: "security.mta-sts",
      category: "security",
      title: `MTA-STS aktiv${hatTlsRpt ? " (mit TLS-Berichten)" : ""}`,
      status: "pass",
      severity: "info",
      description: "Empfangende Server sind angewiesen, Mails an diese Domain nur verschlüsselt zuzustellen — ein Rückfall auf Klartext ist damit ausgeschlossen.",
    });
  } else {
    findings.push({
      id: "security.no-mta-sts",
      category: "security",
      title: "Kein MTA-STS",
      status: "warn",
      severity: "low",
      description:
        "Es gibt keine MTA-STS-Richtlinie. Die Zustellung an diese Domain kann dadurch unbemerkt unverschlüsselt erfolgen: Wer die Verbindung stört, zwingt den sendenden Server zum Rückfall auf Klartext, ohne dass jemand etwas bemerkt.",
      recommendation:
        "MTA-STS einrichten: TXT-Record unter _mta-sts.<domain> plus Richtliniendatei unter https://mta-sts.<domain>/.well-known/mta-sts.txt. Dazu TLS-RPT (_smtp._tls) für Fehlerberichte.",
    });
  }

  // --- CAA: wer darf überhaupt Zertifikate für diese Domain ausstellen? ---
  //
  // Ohne CAA darf JEDE der über 80 öffentlich vertrauten Zertifizierungs-
  // stellen ein gültiges Zertifikat für die Domain ausstellen. Ein CAA-Record
  // grenzt das auf die tatsächlich genutzten ein und macht Fehlausstellungen
  // technisch unmöglich statt nur unwahrscheinlich.
  try {
    const caa = await resolveCaa(domain);
    const issuer = caa.map((c) => c.issue || c.issuewild).filter(Boolean) as string[];
    if (issuer.length > 0) {
      findings.push({
        id: "security.caa",
        category: "security",
        title: "CAA-Record gesetzt",
        status: "pass",
        severity: "info",
        description: "Nur die hinterlegten Zertifizierungsstellen dürfen Zertifikate für diese Domain ausstellen.",
        evidence: issuer.slice(0, 5),
      });
    } else {
      throw new Error("kein issue-Tag");
    }
  } catch {
    findings.push({
      id: "security.no-caa",
      category: "security",
      title: "Kein CAA-Record",
      status: "warn",
      severity: "low",
      description:
        "Ohne CAA-Record darf jede der über 80 öffentlich vertrauten Zertifizierungsstellen ein gültiges Zertifikat für diese Domain ausstellen. Ein Fehler oder Missbrauch bei irgendeiner davon reicht dann für ein echtes, im Browser grün angezeigtes Zertifikat.",
      recommendation: 'CAA-Record anlegen, der nur die genutzte Stelle erlaubt (z. B. 0 issue "letsencrypt.org").',
    });
  }

  return findings;
}
