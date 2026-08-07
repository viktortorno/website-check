// Domain-Modul: prüft das Ablaufdatum der Domain via RDAP (Registration Data
// Access Protocol — der moderne, JSON-basierte WHOIS-Nachfolger, ohne API-Key).
//
// Warum wichtig: Eine vergessene Domain-Verlängerung legt die komplette Seite
// (und E-Mail!) lahm — ein realer Totalausfall, der regelmäßig passiert.
//
// Grenze: Manche Registrare/Registries veröffentlichen kein Ablaufdatum
// (u. a. DENIC für .de-Domains, aus Datenschutzgründen). Dann geben wir einen
// neutralen Hinweis statt einer Bewertung.

import { Finding } from "../types";

interface RdapEvent { eventAction?: string; eventDate?: string }
interface RdapResponse { events?: RdapEvent[]; ldhName?: string }

// Registrierbare Domain grob ableiten (www. & Subdomains entfernen).
// Naiv: die letzten zwei Labels. Für .co.uk u. ä. nicht perfekt, aber RDAP
// folgt Redirects und toleriert das meist.
function registrableDomain(hostname: string): string {
  const parts = hostname.replace(/^www\./i, "").split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : parts.join(".");
}

async function fetchRdap(domain: string): Promise<RdapResponse | null> {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/rdap+json, application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as RdapResponse;
  } catch {
    return null;
  }
}

// Domains, die nach RFC 2606 / RFC 6761 für Beispiele und Tests reserviert
// sind. Sie haben ein echtes Ablaufdatum in der Registry, das die IANA
// routinemäßig verlängert.
//
// Anlass: Ein Reviewer scannte example.com und bekam "Domain läuft in X Tagen
// ab" als Mangel gemeldet. Das Datum war korrekt — die Schlussfolgerung war
// wertlos. Eine formal richtige Warnung, die niemand umsetzen kann, ist keine
// Prüfung, sondern Rauschen.
const RESERVIERTE_DOMAIN = /(^|\.)(example\.(com|net|org)|test|invalid|localhost|example)$/i;

export async function runDomain(hostname: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const domain = registrableDomain(hostname);

  // Erst die volle Domain, bei Misserfolg die registrierbare Variante.
  let data = await fetchRdap(hostname.replace(/^www\./i, ""));
  if (!data) data = await fetchRdap(domain);

  const expiry = data?.events?.find((e) => e.eventAction === "expiration")?.eventDate;

  if (!expiry) {
    // Kein öffentliches Ablaufdatum (z. B. .de/DENIC) — neutraler Hinweis,
    // kein Punktabzug.
    findings.push({
      id: "security.domain-expiry-unknown",
      category: "security",
      title: "Domain-Ablaufdatum nicht öffentlich abrufbar",
      status: "pass",
      severity: "info",
      description: "Das Ablaufdatum der Domain ist nicht öffentlich einsehbar (bei .de-Domains z. B. veröffentlicht die DENIC es aus Datenschutzgründen nicht).",
      recommendation: "Im Konto deines Domain-Anbieters prüfen, ob die Domain automatisch verlängert wird — eine abgelaufene Domain legt Website UND E-Mail lahm.",
    });
    return findings;
  }

  const days = Math.round((new Date(expiry).getTime() - Date.now()) / 86400000);
  const dateStr = new Date(expiry).toLocaleDateString("de-DE");

  if (RESERVIERTE_DOMAIN.test(hostname)) {
    findings.push({
      id: "security.domain-reserved",
      category: "security",
      title: "Reservierte Beispiel-/Testdomain",
      status: "pass",
      severity: "info",
      description: `Diese Domain ist nach RFC 2606 für Beispiele und Tests reserviert und wird von der IANA verwaltet. Das Ablaufdatum (${dateStr}) ist echt, aber ohne Aussagekraft — es wird routinemäßig verlängert.`,
    });
    return findings;
  }

  if (days < 0) {
    findings.push({ id: "security.domain-expired", category: "security", title: "Domain ist abgelaufen", status: "fail", severity: "critical", description: `Die Domain ist laut Registry seit ${Math.abs(days)} Tagen abgelaufen (${dateStr}). Website und E-Mail können jederzeit ausfallen oder die Domain von Dritten übernommen werden.`, recommendation: "Domain SOFORT beim Anbieter verlängern.", evidence: [`Ablauf: ${dateStr}`] });
  } else if (days < 14) {
    findings.push({ id: "security.domain-expiring-urgent", category: "security", title: `Domain läuft in ${days} Tagen ab`, status: "fail", severity: "high", description: `Die Domain läuft am ${dateStr} ab. Ohne Verlängerung fallen Website und E-Mail aus.`, recommendation: "Verlängerung sofort sicherstellen, idealerweise Auto-Renew aktivieren.", evidence: [`Ablauf: ${dateStr}`] });
  } else if (days < 45) {
    // severity low statt medium: Ob eine automatische Verlängerung aktiv ist,
    // steht in keiner Registry-Auskunft. Bei aktiviertem Auto-Renew — dem
    // Normalfall — ist eine Restlaufzeit von sechs Wochen kein Mangel. Zehn
    // Punkte Abzug für einen Zustand, der meistens völlig in Ordnung ist,
    // wäre eine erfundene Dringlichkeit.
    findings.push({ id: "security.domain-expiring", category: "security", title: `Domain läuft in ${days} Tagen ab`, status: "warn", severity: "low", description: `Die Domain läuft am ${dateStr} ab. Ist beim Anbieter eine automatische Verlängerung aktiv, ist das kein Mangel — von außen lässt sich das nicht feststellen.`, recommendation: "Auto-Renew beim Anbieter prüfen; falls nicht aktiv, rechtzeitig verlängern.", evidence: [`Ablauf: ${dateStr}`] });
  } else {
    findings.push({ id: "security.domain-ok", category: "security", title: "Domain-Registrierung gültig", status: "pass", severity: "info", description: `Die Domain ist noch ${days} Tage registriert (bis ${dateStr}).` });
  }

  return findings;
}
