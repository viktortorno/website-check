// Security-Modul: HTTP-Header, HTTPS-Redirect, TLS-Zertifikat.
// Nutzt Node-Bordmittel (fetch + tls), kein Browser nötig → schnell.

import tls from "node:tls";
import { Finding } from "../types";

// --- Security-Header, die wir erwarten ---
// name → [Anzeigename, Schweregrad wenn fehlt, Empfehlung]
const EXPECTED_HEADERS: Record<
  string,
  { label: string; severity: Finding["severity"]; rec: string }
> = {
  "strict-transport-security": {
    label: "HSTS (Strict-Transport-Security)",
    severity: "high",
    rec: "Header setzen: erzwingt HTTPS und schützt vor Downgrade-Angriffen.",
  },
  "content-security-policy": {
    label: "Content-Security-Policy",
    severity: "medium",
    rec: "CSP definieren: stärkster Schutz gegen XSS und Code-Injection.",
  },
  "x-content-type-options": {
    label: "X-Content-Type-Options",
    severity: "low",
    rec: "Auf 'nosniff' setzen — verhindert MIME-Sniffing-Angriffe.",
  },
  "x-frame-options": {
    label: "X-Frame-Options",
    severity: "medium",
    rec: "Auf 'SAMEORIGIN' oder 'DENY' setzen — schützt vor Clickjacking.",
  },
  "referrer-policy": {
    label: "Referrer-Policy",
    severity: "low",
    rec: "Setzen (z.B. 'strict-origin-when-cross-origin') — vermeidet Datenabfluss über Referrer.",
  },
  "permissions-policy": {
    label: "Permissions-Policy",
    severity: "low",
    rec: "Setzen — schränkt Browser-Features (Kamera, Mikrofon, Geolocation) ein.",
  },
};

// TLS-Zertifikat + Protokollversion prüfen.
function checkTls(hostname: string): Promise<Finding[]> {
  return new Promise((resolve) => {
    const findings: Finding[] = [];
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: 10000 },
      () => {
        const cert = socket.getPeerCertificate();
        const protocol = socket.getProtocol(); // z.B. "TLSv1.3"

        // Zertifikat-Ablauf
        if (cert && cert.valid_to) {
          const expiry = new Date(cert.valid_to);
          const daysLeft = Math.round(
            (expiry.getTime() - Date.now()) / 86400000
          );
          if (daysLeft < 0) {
            findings.push({
              id: "security.tls-expired",
              category: "security",
              title: "SSL-Zertifikat abgelaufen",
              status: "fail",
              severity: "critical",
              description: `Das Zertifikat ist seit ${Math.abs(daysLeft)} Tagen abgelaufen.`,
              recommendation: "Zertifikat sofort erneuern (z.B. Let's Encrypt Auto-Renew).",
            });
          } else if (daysLeft < 14) {
            findings.push({
              id: "security.tls-expiring",
              category: "security",
              title: "SSL-Zertifikat läuft bald ab",
              status: "warn",
              severity: "medium",
              description: `Das Zertifikat läuft in ${daysLeft} Tagen ab.`,
              recommendation: "Erneuerung prüfen / automatisieren.",
            });
          } else {
            findings.push({
              id: "security.tls-valid",
              category: "security",
              title: "SSL-Zertifikat gültig",
              status: "pass",
              severity: "info",
              description: `Gültig bis ${expiry.toLocaleDateString("de-DE")} (${daysLeft} Tage).`,
            });
          }
        }

        // Veraltete TLS-Version
        if (protocol && (protocol === "TLSv1" || protocol === "TLSv1.1")) {
          findings.push({
            id: "security.tls-old",
            category: "security",
            title: "Veraltete TLS-Version",
            status: "fail",
            severity: "high",
            description: `Verbindung nutzt ${protocol}. Veraltet und unsicher.`,
            recommendation: "Server auf TLS 1.2 / 1.3 umstellen, alte Versionen deaktivieren.",
          });
        } else if (protocol) {
          findings.push({
            id: "security.tls-version",
            category: "security",
            title: "Moderne TLS-Version",
            status: "pass",
            severity: "info",
            description: `Verbindung nutzt ${protocol}.`,
          });
        }

        socket.end();
        resolve(findings);
      }
    );

    socket.on("error", () => {
      findings.push({
        id: "security.tls-error",
        category: "security",
        title: "TLS-Verbindung fehlgeschlagen",
        status: "fail",
        severity: "critical",
        description: "Es konnte keine sichere HTTPS-Verbindung aufgebaut werden.",
        recommendation: "SSL-Konfiguration des Servers prüfen.",
      });
      resolve(findings);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(findings);
    });
  });
}

export async function runSecurity(finalUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const target = new URL(finalUrl);

  // 1. HTTPS erzwungen? HTTP-Variante abrufen und auf Redirect prüfen.
  if (target.protocol !== "https:") {
    findings.push({
      id: "security.no-https",
      category: "security",
      title: "Keine HTTPS-Verschlüsselung",
      status: "fail",
      severity: "critical",
      description: "Die Seite wird unverschlüsselt über HTTP ausgeliefert.",
      recommendation: "SSL-Zertifikat einrichten und auf HTTPS umleiten.",
      legalRef: "Art. 32 DSGVO (Sicherheit der Verarbeitung)",
    });
  } else {
    try {
      const httpUrl = "http://" + target.host + target.pathname;
      const res = await fetch(httpUrl, { redirect: "manual", signal: AbortSignal.timeout(10000) });
      const loc = res.headers.get("location") || "";
      if (res.status >= 300 && res.status < 400 && loc.startsWith("https://")) {
        findings.push({
          id: "security.https-redirect",
          category: "security",
          title: "HTTP→HTTPS-Weiterleitung aktiv",
          status: "pass",
          severity: "info",
          description: "Unverschlüsselte Aufrufe werden korrekt auf HTTPS umgeleitet.",
        });
      } else {
        findings.push({
          id: "security.no-https-redirect",
          category: "security",
          title: "Keine HTTP→HTTPS-Weiterleitung",
          status: "warn",
          severity: "medium",
          description: "Die Seite ist auch unverschlüsselt erreichbar (keine Zwangs-Umleitung).",
          recommendation: "Permanente 301-Weiterleitung von HTTP auf HTTPS einrichten.",
        });
      }
    } catch {
      // HTTP nicht erreichbar = i.d.R. gut (Port 80 zu)
    }
  }

  // 2. Security-Header der finalen Antwort prüfen.
  let headers: Headers | null = null;
  try {
    const res = await fetch(finalUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 ComplianceChecker/1.0" },
    });
    headers = res.headers;

    // Server-Version-Leak
    const server = headers.get("server");
    if (server && /\d/.test(server)) {
      findings.push({
        id: "security.server-leak",
        category: "security",
        title: "Server-Version im Header sichtbar",
        status: "warn",
        severity: "low",
        description: `Der Server verrät seine Version: "${server}". Erleichtert gezielte Angriffe.`,
        recommendation: "Versionsangabe im Server-Header ausblenden.",
      });
    }
  } catch {
    findings.push({
      id: "security.unreachable",
      category: "security",
      title: "Seite nicht erreichbar",
      status: "fail",
      severity: "high",
      description: "Die HTTPS-Antwort konnte nicht geladen werden.",
    });
  }

  if (headers) {
    for (const [key, cfg] of Object.entries(EXPECTED_HEADERS)) {
      if (headers.has(key)) {
        // CSP-Qualität bewerten: vorhanden ist gut, aber unsafe-* hebeln den Schutz aus.
        if (key === "content-security-policy") {
          const csp = (headers.get(key) || "").toLowerCase();
          if (csp.includes("unsafe-inline") || csp.includes("unsafe-eval")) {
            findings.push({
              id: "security.csp-weak",
              category: "security",
              title: "Content-Security-Policy mit Schwachstellen",
              status: "warn",
              severity: "low",
              description: "Eine CSP ist gesetzt, erlaubt aber 'unsafe-inline' und/oder 'unsafe-eval'. Das untergräbt den XSS-Schutz, den die CSP eigentlich bieten soll.",
              recommendation: "Inline-Skripte per Nonce/Hash erlauben statt 'unsafe-inline'; 'unsafe-eval' vermeiden.",
            });
            continue;
          }
        }
        findings.push({
          id: `security.header-${key}`,
          category: "security",
          title: `${cfg.label} gesetzt`,
          status: "pass",
          severity: "info",
          description: "Header ist vorhanden.",
        });
      } else {
        findings.push({
          id: `security.missing-${key}`,
          category: "security",
          title: `${cfg.label} fehlt`,
          status: "fail",
          severity: cfg.severity,
          description: `Der Header "${key}" ist nicht gesetzt.`,
          recommendation: cfg.rec,
        });
      }
    }
  }

  // 3. TLS-Zertifikat (nur bei HTTPS).
  if (target.protocol === "https:") {
    const tlsFindings = await checkTls(target.hostname);
    findings.push(...tlsFindings);
  }

  return findings;
}
