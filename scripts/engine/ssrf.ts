// SSRF-Härtung: löst den Hostnamen per DNS auf und prüft die TATSÄCHLICHE IP.
// Nötig, weil eine öffentliche Domain per A-Record auf eine interne Adresse
// zeigen kann (z.B. 169.254.169.254 = Cloud-Metadaten) — ein reiner
// Hostnamen-Regex würde das übersehen.

import { lookup } from "node:dns/promises";

export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) → auf die IPv4 reduzieren
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];

  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    return (
      v6 === "::1" || // loopback
      v6 === "::" ||
      v6.startsWith("fc") || // ULA fc00::/7
      v6.startsWith("fd") ||
      v6.startsWith("fe80") // link-local
    );
  }

  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // im Zweifel blocken
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local / Cloud-Metadaten
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // Multicast / reserviert
  );
}

// Wirft, wenn der Hostname nicht auflösbar ist oder auf eine interne IP zeigt.
export async function assertPublicHost(hostname: string): Promise<void> {
  let addrs;
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new Error("Domain konnte nicht aufgelöst werden.");
  }
  if (!addrs.length) throw new Error("Domain konnte nicht aufgelöst werden.");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error("Diese Domain zeigt auf eine interne/reservierte Adresse und wird nicht gescannt.");
    }
  }
}
