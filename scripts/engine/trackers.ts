// Bekannte Tracker, Analytics-Dienste und Drittanbieter mit DSGVO-Relevanz.
// Wir matchen Netzwerk-Requests (Hostnamen) gegen diese Muster.
//
// Quelle der Einordnung: gängige DSK-Hinweise + bekannte Gerichtsurteile.
// Die Liste ist bewusst pragmatisch gehalten — sie deckt die häufigsten
// Verstöße auf KMU-Websites ab, nicht jede exotische Edge-Case-Domain.

export interface TrackerSignature {
  id: string;
  name: string;
  // Substrings, die im Request-Hostname (oder URL) vorkommen
  patterns: string[];
  category: "analytics" | "ads" | "social" | "fonts" | "maps" | "video" | "cdn" | "consent" | "tagmanager";
  // Werden bei diesem Dienst typischerweise Daten in die USA übertragen?
  usTransfer: boolean;
  // true = arbeitet nachweislich ohne Cookies/Endgeräte-Speicher.
  //
  // Der Unterschied ist rechtlich entscheidend und wurde vorher nicht gemacht:
  // § 25 TDDDG betrifft das SPEICHERN VON INFORMATIONEN AUF DEM ENDGERÄT und
  // den Zugriff darauf — Cookies, localStorage, Fingerprinting. Die bloße
  // Übertragung einer IP-Adresse beim Laden einer Ressource fällt NICHT
  // darunter; sie ist eine Verarbeitung nach Art. 6 DSGVO. Ein cookieloses
  // Analytics-Werkzeug und ein Werbepixel in denselben Befund zu werfen, ist
  // fachlich falsch und beschädigt die Glaubwürdigkeit des ganzen Berichts.
  cookielos?: boolean;
  // Kurzbegründung für den Report
  note: string;
}

export const TRACKERS: TrackerSignature[] = [
  // --- Analytics ---
  { id: "google-analytics", name: "Google Analytics", patterns: ["google-analytics.com", "googletagmanager.com/gtag", "analytics.google.com", "/g/collect", "region1.google-analytics.com"], category: "analytics", usTransfer: true, note: "Setzt Tracking-Cookies & überträgt Daten an Google (USA). Nur mit Einwilligung zulässig." },
  { id: "google-tag-manager", name: "Google Tag Manager", patterns: ["googletagmanager.com/gtm.js", "googletagmanager.com/gtag/js"], category: "tagmanager", usTransfer: true, note: "Lädt weitere Skripte nach — oft Einfallstor für Tracker vor Einwilligung." },
  { id: "matomo", name: "Matomo", patterns: ["matomo.php", "piwik.php", "matomo.js", "piwik.js"], category: "analytics", usTransfer: false, note: "Analytics. DSGVO-freundlicher, aber bei Cookie-Nutzung einwilligungspflichtig." },
  { id: "hotjar", name: "Hotjar", patterns: ["hotjar.com", "hotjar.io", "static.hj"], category: "analytics", usTransfer: true, note: "Session-Recording / Heatmaps. Einwilligungspflichtig." },
  { id: "plausible", name: "Plausible", patterns: ["plausible.io"], category: "analytics", usTransfer: false, cookielos: true, note: "Cookieloses Analytics (EU). Meist ohne Einwilligung nutzbar." },

  // --- Ads ---
  { id: "google-ads", name: "Google Ads / DoubleClick", patterns: ["googleadservices.com", "doubleclick.net", "googlesyndication.com", "google.com/ads", "/pagead/"], category: "ads", usTransfer: true, note: "Werbe-Tracking. Strikt einwilligungspflichtig." },
  { id: "meta-pixel", name: "Meta / Facebook Pixel", patterns: ["connect.facebook.net", "facebook.com/tr", "fbevents.js"], category: "ads", usTransfer: true, note: "Conversion-Tracking an Meta (USA). Einwilligungspflichtig." },
  { id: "linkedin-insight", name: "LinkedIn Insight Tag", patterns: ["snap.licdn.com", "px.ads.linkedin.com"], category: "ads", usTransfer: true, note: "B2B-Tracking an LinkedIn (USA). Einwilligungspflichtig." },
  { id: "tiktok-pixel", name: "TikTok Pixel", patterns: ["analytics.tiktok.com", "tiktok.com/i18n/pixel"], category: "ads", usTransfer: true, note: "Tracking an TikTok. Einwilligungspflichtig." },
  { id: "microsoft-clarity", name: "Microsoft Clarity", patterns: ["clarity.ms"], category: "analytics", usTransfer: true, note: "Session-Recording von Microsoft. Einwilligungspflichtig." },

  // --- Fonts (das berühmte Google-Fonts-Thema) ---
  { id: "google-fonts", name: "Google Fonts (CDN)", patterns: ["fonts.googleapis.com", "fonts.gstatic.com"], category: "fonts", usTransfer: true, note: "Dynamisch eingebundene Google Fonts übertragen die IP an Google. LG München I, Az. 3 O 17493/20 — abmahnfähig. Lokal hosten!" },

  // --- Maps / Video / Social Embeds ---
  { id: "google-maps", name: "Google Maps", patterns: ["maps.googleapis.com", "maps.google.com", "maps.gstatic.com"], category: "maps", usTransfer: true, note: "Eingebettete Karte lädt Google-Daten. Erst nach Einwilligung laden (2-Klick-Lösung)." },
  { id: "youtube", name: "YouTube Embed", patterns: ["youtube.com/embed", "youtube-nocookie.com", "ytimg.com"], category: "video", usTransfer: true, note: "Eingebettetes Video. youtube-nocookie.com nutzen oder 2-Klick-Lösung." },
  { id: "vimeo", name: "Vimeo", patterns: ["player.vimeo.com", "vimeocdn.com"], category: "video", usTransfer: true, note: "Eingebettetes Video, setzt Tracking-Cookies." },

  // --- Sonstiges mit Datenfluss ---
  { id: "recaptcha", name: "Google reCAPTCHA", patterns: ["google.com/recaptcha", "gstatic.com/recaptcha", "recaptcha.net"], category: "cdn", usTransfer: true, note: "Überträgt Nutzerdaten an Google. Im Datenschutztext nennen; ggf. Alternative (hCaptcha/Friendly Captcha)." },
  { id: "jsdelivr", name: "jsDelivr CDN", patterns: ["cdn.jsdelivr.net"], category: "cdn", usTransfer: false, note: "Externes CDN — IP wird an Dritte übertragen. Im Datenschutztext erwähnen." },
  { id: "cloudflare-cdn", name: "Cloudflare CDN", patterns: ["cdnjs.cloudflare.com"], category: "cdn", usTransfer: true, note: "Externes CDN — IP-Übertragung. Im Datenschutztext erwähnen." },
];

// Bekannte Consent-Management-Plattformen (CMP).
// Ihre Anwesenheit ist ein gutes Zeichen — heißt aber nicht, dass sie korrekt
// konfiguriert ist (z.B. Tracker trotzdem vor Klick aktiv).
export const CMP_SIGNATURES: { id: string; name: string; patterns: string[] }[] = [
  { id: "cookiebot", name: "Cookiebot", patterns: ["consent.cookiebot.com", "cookiebot.com"] },
  { id: "usercentrics", name: "Usercentrics", patterns: ["usercentrics.eu", "app.usercentrics.eu"] },
  { id: "borlabs", name: "Borlabs Cookie", patterns: ["borlabs-cookie"] },
  { id: "onetrust", name: "OneTrust", patterns: ["cdn.cookielaw.org", "onetrust.com"] },
  { id: "cookieyes", name: "CookieYes", patterns: ["cookie-script.com", "cookieyes.com"] },
  { id: "complianz", name: "Complianz", patterns: ["complianz"] },
  // Sourcepoint steckt hinter vielen großen deutschen Verlagsseiten und rendert
  // sein Banner in einem eigenen iframe (cmp.<domain>, privacy-mgmt.com).
  { id: "sourcepoint", name: "Sourcepoint", patterns: ["privacy-mgmt.com", "sourcepoint.mgr.consensu.org", "_sp_"] },
  { id: "didomi", name: "Didomi", patterns: ["didomi.io", "privacy-center.org"] },
  { id: "iubenda", name: "iubenda", patterns: ["iubenda.com"] },
  { id: "consentmanager", name: "consentmanager", patterns: ["consentmanager.net", "delivery.consentmanager.net"] },
];

// Hilfsfunktion: matcht eine URL/Host gegen eine Pattern-Liste.
export function matchesAny(haystack: string, patterns: string[]): boolean {
  const h = haystack.toLowerCase();
  return patterns.some((p) => h.includes(p.toLowerCase()));
}
