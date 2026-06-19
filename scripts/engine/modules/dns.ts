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

  // --- DMARC ---
  const dmarc = (await txt(`_dmarc.${domain}`)).find((r) =>
    r.toLowerCase().startsWith("v=dmarc1")
  );
  if (dmarc) {
    const policy = /p=(none|quarantine|reject)/i.exec(dmarc)?.[1]?.toLowerCase();
    if (policy === "none") {
      findings.push({
        id: "security.dmarc-monitor",
        category: "security",
        title: "DMARC nur im Monitoring-Modus (p=none)",
        status: "warn",
        severity: "low",
        description: "DMARC ist gesetzt, aber ohne Schutzwirkung (p=none).",
        recommendation: "Schrittweise auf p=quarantine bzw. p=reject erhöhen.",
      });
    } else {
      findings.push({
        id: "security.dmarc",
        category: "security",
        title: `DMARC aktiv (p=${policy})`,
        status: "pass",
        severity: "info",
        description: "DMARC schützt aktiv vor Spoofing.",
      });
    }
  } else {
    findings.push({
      id: "security.no-dmarc",
      category: "security",
      title: "Kein DMARC-Record",
      status: "warn",
      severity: "medium",
      description: "Ohne DMARC fehlt die Durchsetzung von SPF/DKIM.",
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
