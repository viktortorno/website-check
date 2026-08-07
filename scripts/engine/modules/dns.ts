// DNS-Modul: E-Mail-Sicherheit (SPF, DMARC, DKIM).
// Fehlende Records bedeuten: Angreifer können im Namen der Domain Mails fälschen
// (Spoofing/Phishing) — relevant für Sicherheit UND Reputation.

import { resolveTxt } from "node:dns/promises";
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

export async function runDns(hostname: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  // www. abstreifen — Mail-Records hängen an der Hauptdomain.
  const domain = hostname.replace(/^www\./, "");

  // --- SPF ---
  const root = await txt(domain);
  const spf = root.find((r) => r.toLowerCase().startsWith("v=spf1"));
  if (spf) {
    findings.push({
      id: "security.spf",
      category: "security",
      title: "SPF-Record vorhanden",
      status: "pass",
      severity: "info",
      description: "Ein SPF-Eintrag schützt vor E-Mail-Spoofing.",
    });
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

  return findings;
}
