// Netzgrenze der Scan-Engine.
//
// Dieses Werkzeug ruft auf Zuruf beliebiger Fremder eine beliebige Adresse ab.
// Ohne Grenze wäre es ein offener Proxy in das Netz, in dem es steht. Vier
// Grenzen zusammen halten es davon ab:
//
//   1. ZIEL-IP statt Hostname. Eine öffentliche Domain darf per A-Record auf
//      169.254.169.254 (Cloud-Metadaten) zeigen; ein Hostnamen-Regex sähe das
//      nicht. Deshalb wird immer aufgelöst und die echte IP geprüft.
//   2. PORT. Nur 80 und 443. Sonst wird aus dem Scanner ein Portscanner für
//      fremde Netze — mit der IP dieses Servers als Absender.
//   3. JEDER HOP. Redirects werden von Hand verfolgt und vor jedem Sprung neu
//      geprüft, statt sie fetch zu überlassen.
//   4. GRÖSSE. Antworten werden im Strom gelesen und abgebrochen, statt sie
//      erst vollständig in den Speicher zu holen und dann zu kürzen.

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

// Nur die beiden Web-Ports.
//
// Ohne diese Grenze ist jede Prüfung eine Portsonde: https://ziel.de:6379
// besteht die IP-Prüfung anstandslos, denn die IP IST öffentlich. Was dann
// antwortet, ist ein Redis auf einem fremden Server — angefragt von diesem
// Server, mit dessen IP im Log des Fremden. Der Unterschied zwischen "wir
// prüfen Websites" und "wir klopfen Ports ab" ist genau diese Zeile.
const ERLAUBTE_PORTS = new Set(["", "80", "443"]);

// Ergebnis einer Zielprüfung: die aufgelösten Adressen werden zurückgegeben,
// damit der Aufrufer sie festnageln kann (siehe pinneHost in browser.ts).
export interface ZielPruefung {
  hostname: string;
  adressen: string[];
}

// Wirft, wenn der Hostname nicht auflösbar ist oder auf eine interne IP zeigt.
export async function assertPublicHost(hostname: string): Promise<ZielPruefung> {
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
  return { hostname: host, adressen: addrs.map((a) => a.address) };
}

// Wie assertPublicHost, aber für eine komplette URL: prüft zusätzlich Schema
// und Port.
export async function assertPublicUrl(rawUrl: string): Promise<ZielPruefung> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Ungültige URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http/https-URLs sind erlaubt.");
  }
  if (!ERLAUBTE_PORTS.has(parsed.port)) {
    throw new Error("Nur die Standard-Ports 80 und 443 werden abgerufen.");
  }
  return assertPublicHost(parsed.hostname);
}

// Prüfung mit Kurzzeit-Gedächtnis, für den Browser-Interceptor.
//
// Eine Seite lädt schnell 40 Ressourcen von 15 Hosts. Ein DNS-Lookup pro
// Request wäre teuer genug, dass die Prüfung irgendwann "aus Performance-
// gründen" wieder herausfliegt — deshalb wird je Host einmal aufgelöst.
//
// Die Lebensdauer ist bewusst kurz: Ein gecachtes "erlaubt" ist genau das
// Fenster, in dem DNS-Rebinding wirken könnte. 30 Sekunden decken einen
// Seitenaufbau ab und überleben ihn nicht.
const HOST_CACHE_TTL_MS = 30_000;
const hostCache = new Map<string, { erlaubt: boolean; at: number }>();

export async function hostErlaubt(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!ERLAUBTE_PORTS.has(parsed.port)) return false;

  const key = parsed.hostname;
  const now = Date.now();
  const treffer = hostCache.get(key);
  if (treffer && now - treffer.at < HOST_CACHE_TTL_MS) return treffer.erlaubt;

  let erlaubt = false;
  try {
    await assertPublicHost(key);
    erlaubt = true;
  } catch {
    erlaubt = false;
  }
  hostCache.set(key, { erlaubt, at: now });
  if (hostCache.size > 2000) {
    for (const [k, v] of hostCache) if (now - v.at >= HOST_CACHE_TTL_MS) hostCache.delete(k);
  }
  return erlaubt;
}

// Nur für Tests: das Kurzzeit-Gedächtnis leeren.
export function _leereHostCache(): void {
  hostCache.clear();
}

const MAX_REDIRECTS = 5;

// Obergrenze für eine einzelne Antwort, wenn der Aufrufer keine nennt.
// 2 MB reichen für robots.txt, Sitemaps und jede Rechtsseite.
const MAX_BYTES_DEFAULT = 2_000_000;

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
    await assertPublicUrl(current); // wirft bei interner IP / fremdem Port / Schema
    const res = await fetch(current, { ...init, redirect: "manual" });

    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res; // 30x ohne Ziel → wie eine normale Antwort behandeln

    current = new URL(location, current).toString(); // relative Ziele auflösen
  }

  throw new Error("Zu viele Weiterleitungen.");
}

// Antwort als Text lesen — mit harter Obergrenze IM STROM.
//
// `await res.text()` holt erst alles in den Speicher und kürzt danach. Bei
// einer Antwort ohne Content-Length, die einfach nicht aufhört (Zip-Bombe,
// endloser Stream, schlicht ein 4-GB-Download), ist der Prozess vorher tot.
// Die Kürzung hinterher schützt die Auswertung, nicht den Server.
//
// Deshalb: Stück für Stück lesen, mitzählen, beim Erreichen der Grenze den
// Body abbrechen. `gekappt` sagt dem Aufrufer, dass er ein Fragment hat — das
// ist wichtig, weil "Text kürzer als erwartet" sonst als inhaltlicher Mangel
// der fremden Seite gewertet würde.
export async function leseBegrenzt(
  res: Response,
  maxBytes = MAX_BYTES_DEFAULT
): Promise<{ text: string; gekappt: boolean }> {
  const { bytes, gekappt } = await leseRohBegrenzt(res, maxBytes);
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), gekappt };
}

// Dasselbe für binäre Antworten (Bild-Header, in denen C2PA/XMP steckt).
//
// Wichtig, weil ein Range-Header nur eine BITTE ist: Ein Server darf ihn
// ignorieren und die ganze Datei schicken. `res.arrayBuffer()` würde sie
// vollständig annehmen — die Obergrenze stünde dann nur im Request, nicht in
// unserem Speicher.
export async function leseRohBegrenzt(
  res: Response,
  maxBytes = MAX_BYTES_DEFAULT
): Promise<{ bytes: Uint8Array; gekappt: boolean }> {
  // Wenn der Server die Größe selbst nennt und sie über der Grenze liegt,
  // brauchen wir gar nicht erst zu lesen.
  const angekuendigt = Number(res.headers.get("content-length") || 0);
  if (angekuendigt > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return { bytes: new Uint8Array(0), gekappt: true };
  }

  if (!res.body) return { bytes: new Uint8Array(await res.arrayBuffer()), gekappt: false };

  const reader = res.body.getReader();
  const teile: Uint8Array[] = [];
  let gelesen = 0;
  let gekappt = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      gelesen += value.byteLength;
      if (gelesen > maxBytes) {
        // Den Rest des erlaubten Fensters noch mitnehmen, dann Schluss.
        teile.push(value.subarray(0, value.byteLength - (gelesen - maxBytes)));
        gekappt = true;
        break;
      }
      teile.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const gesamt = new Uint8Array(teile.reduce((n, t) => n + t.byteLength, 0));
  let off = 0;
  for (const t of teile) { gesamt.set(t, off); off += t.byteLength; }

  return { bytes: gesamt, gekappt };
}
