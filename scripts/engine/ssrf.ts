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
  // IPv6-Literale stehen in URLs in Klammern ([::1]) — die versteht dns.lookup nicht.
  const host = hostname.replace(/^\[|\]$/g, "");

  let addrs;
  try {
    addrs = await lookup(host, { all: true });
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

// Wie assertPublicHost, aber für eine komplette URL: prüft zusätzlich das Schema.
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Ungültige URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http/https-URLs sind erlaubt.");
  }
  await assertPublicHost(parsed.hostname);
}

const MAX_REDIRECTS = 5;

// fetch mit SSRF-sicherem Redirect-Handling.
//
// Warum nicht redirect: "follow"? Dann prüft nur der Aufrufer den START-Host —
// eine öffentliche Seite kann per 30x auf 127.0.0.1 oder 169.254.169.254
// (Cloud-Metadaten) zeigen und undici folgt ungefragt. Deshalb: manuell folgen
// und VOR JEDEM Hop erneut die tatsächliche Ziel-IP prüfen.
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = MAX_REDIRECTS
): Promise<Response> {
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current); // wirft bei interner IP / fremdem Schema
    const res = await fetch(current, { ...init, redirect: "manual" });

    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res; // 30x ohne Ziel → wie eine normale Antwort behandeln

    current = new URL(location, current).toString(); // relative Ziele auflösen
  }

  throw new Error("Zu viele Weiterleitungen.");
}
