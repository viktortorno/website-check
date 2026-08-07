// Zentrale Datentypen der Scan-Engine.
// Jedes Prüf-Modul produziert Findings nach diesem Schema — dadurch kann
// die Scoring-Engine später kategorie-übergreifend gleich rechnen.

export type Category =
  | "dsgvo"
  | "security"
  | "ai-act"
  | "accessibility"
  | "seo"
  | "geo"
  | "psychology"
  | "performance";

export const CATEGORY_LABELS: Record<Category, string> = {
  dsgvo: "DSGVO / Datenschutz",
  security: "IT-Sicherheit",
  "ai-act": "EU AI Act",
  accessibility: "Barrierefreiheit (BFSG)",
  seo: "SEO / Sichtbarkeit",
  geo: "GEO / KI-Suche",
  psychology: "Psychologie / Conversion",
  performance: "Performance / Ladezeit",
};

// Kurzform für enge Stellen (Mono-Zeilen, Tabellen auf dem Telefon). Die
// langen Labels enthalten einen Schrägstrich ("SEO / Sichtbarkeit") und
// brechen dort um — mitten im Begriff, was in Versalien besonders unschön
// aussieht.
export const CATEGORY_SHORT: Record<Category, string> = {
  dsgvo: "DSGVO",
  security: "IT-Sicherheit",
  "ai-act": "EU AI Act",
  accessibility: "Barrierefreiheit",
  seo: "SEO",
  geo: "KI-Suche",
  psychology: "Conversion",
  performance: "Ladezeit",
};

// Was diese Prüfung in dem Bereich abdeckt — und was nicht.
//
// Grund: „DSGVO: Note B" liest sich wie ein Urteil über die Datenschutz-
// Konformität des Unternehmens. Geprüft werden aber neun technisch von außen
// sichtbare Dinge — keine Verträge, kein Verarbeitungsverzeichnis, kein
// Löschkonzept. Der Haftungsausschluss am Seitenende fängt das rechtlich ab,
// die Note im Kopf sagt trotzdem etwas anderes. Diese Zeile steht deshalb
// direkt unter der Kategorie-Überschrift, dort wo die Note steht.
export const CATEGORY_SCOPE: Record<Category, string> = {
  dsgvo:
    "Geprüft wird, was beim Seitenaufruf von außen messbar ist: Tracker, Cookies, fremde Einbettungen, Pflichtseiten. Nicht geprüft: Verträge zur Auftragsverarbeitung, Verarbeitungsverzeichnis, Löschkonzept, interne Abläufe — und ob der Betreiber im Geltungsbereich des deutschen Rechts sitzt. Die Befunde sind technische Signale, keine Feststellung eines Verstoßes.",
  security:
    "Geprüft werden Transportverschlüsselung, HTTP-Schutzheader und die E-Mail-Absicherung der Domain. Nicht geprüft: Server, Anwendungslogik, Zugänge — dafür wäre ein Penetrationstest nötig.",
  "ai-act":
    "Geprüft werden sichtbare Anzeichen für KI-Einsatz auf der Website (Chat-Systeme, eingebundene Dienste, Herkunftsspuren in Bildern). Nicht geprüft: welche KI-Systeme das Unternehmen intern nutzt und in welche Risikoklasse sie fallen.",
  accessibility:
    "Automatisch prüfbar ist rund ein Drittel der WCAG-Kriterien; Tastaturbedienung und Screenreader-Erlebnis brauchen einen manuellen Test. Ob das BFSG für diesen Betreiber überhaupt gilt, kann diese Prüfung nicht feststellen — es trifft bestimmte Verbraucherprodukte und -dienstleistungen, Kleinstunternehmen sind bei Dienstleistungen ausgenommen.",
  seo: "Geprüft werden die technischen On-Page-Signale dieser einen Seite. Nicht geprüft: Rankings, Suchvolumen, Backlinks und alle weiteren Unterseiten.",
  geo: "Geprüft wird, wie gut diese Seite für KI-Antwortsysteme lesbar und zitierbar ist. Die inhaltlichen Regeln (Absatzlänge, Faktendichte, Definitionssätze) sind Erfahrungswerte, keine belegte Wissenschaft. Nicht gemessen: ob die Marke in ChatGPT, Perplexity & Co. tatsächlich genannt wird.",
  psychology:
    "Geprüft werden wiederkehrende Muster erfolgreicher Seiten (Handlungsaufforderung, Vertrauenssignale, Struktur). Das ersetzt keinen A/B-Test mit echten Besuchern.",
  performance:
    "Ein einzelner Laborabruf aus einem Rechenzentrum in Deutschland — nicht das, woran Google misst. Die offiziellen Core Web Vitals (LCP, INP, CLS) werden am 75. Perzentil echter Besuche bewertet; INP lässt sich ohne Interaktion nicht erheben und fehlt hier.",
};

// Gruppierung für die UI: rechtliche Pflichtbereiche vs. Wachstum/Marketing.
// (Compliance = Risiko-Vermeidung, Growth = Sichtbarkeit & Umsatz.)
export type CategoryGroup = "compliance" | "growth";

export const CATEGORY_GROUP: Record<Category, CategoryGroup> = {
  dsgvo: "compliance",
  security: "compliance",
  "ai-act": "compliance",
  accessibility: "compliance",
  seo: "growth",
  geo: "growth",
  psychology: "growth",
  performance: "growth",
};

export const GROUP_LABELS: Record<CategoryGroup, string> = {
  compliance: "Rechtssicherheit & Risiko",
  growth: "Sichtbarkeit & Conversion",
};

// --- Rechtliche Anwendbarkeit (Logik in kontext.ts) ---------------------
//
// Freiwillige Angaben des Nutzers über den Betreiber. Sie ändern nicht, WAS
// gemessen wird, sondern ob ein Messwert für ihn eine Rechtspflicht ist.
export type Betreiberland = "de" | "eu" | "ausserhalb" | "unbekannt";
// b2b = ausschließlich Geschäftskunden, b2c = (auch) Verbraucher
export type Zielgruppe = "b2b" | "b2c" | "unbekannt";
// kleinst = < 10 Beschäftigte UND ≤ 2 Mio. € Jahresumsatz/Bilanzsumme
export type Groesse = "kleinst" | "ab10" | "unbekannt";
// Was die Seite tut: nur informieren oder auch abschließen/verkaufen
export type Angebot = "nur-info" | "online-abschluss" | "unbekannt";

export interface ScanKontext {
  land: Betreiberland;
  zielgruppe: Zielgruppe;
  groesse: Groesse;
  angebot: Angebot;
}

// gilt      — die Pflicht trifft diesen Betreiber
// gilt-nicht— sie trifft ihn nachweislich nicht; keine Note, nur Hinweise
// unklar    — von außen nicht feststellbar; es wird bewertet, mit Vorbehalt
export type Geltung = "gilt" | "gilt-nicht" | "unklar";

export interface GeltungsUrteil {
  geltung: Geltung;
  grund: string;
}

// status  = Ergebnis der Einzelprüfung (Ampel)
// severity = Gewicht des Verstoßes für die Bewertung
export type Status = "pass" | "warn" | "fail";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  id: string; // stabil, z.B. "dsgvo.pre-consent-tracking"
  category: Category;
  title: string;
  status: Status;
  severity: Severity;
  description: string; // was wurde konkret gefunden
  recommendation?: string; // was der Betreiber tun sollte
  legalRef?: string; // Rechtsgrundlage / Urteil
  evidence?: string[]; // Belege, z.B. geladene Tracker-URLs
}

export interface CategoryResult {
  category: Category;
  // null = NICHT GEPRÜFT. Der wichtigste Wert in diesem Typ.
  //
  // Vorher war score immer eine Zahl, und eine Kategorie ohne jede ausgeführte
  // Prüfung landete bei 100 — weil das Scoring bei 100 startet und nur abzieht.
  // Fiel der Browser aus, meldete das Werkzeug sechs Kategorien mit „A" und
  // eine Gesamtnote von 100/100. „Nicht gemessen" wurde damit zu „einwandfrei".
  // Ein Audit-Werkzeug darf diesen Zustand nicht kennen; deshalb null.
  score: number | null;
  grade: string | null;
  findings: Finding[];
  checks: number; // tatsächlich ausgeführte Prüfungen (0 = nicht geprüft)
  // 0–1: wie belastbar die Aussage ist (Prüfdichte gegen den Sollwert).
  confidence: number;
  // Trifft die geprüfte Pflicht diesen Betreiber überhaupt?
  //
  // Zusammen mit score = null ergeben sich drei unterscheidbare Zustände, die
  // vorher alle gleich aussahen:
  //   score = Zahl, geltung "gilt"        → gemessen und verbindlich
  //   score = null, geltung "gilt-nicht"  → gemessen, aber nicht anwendbar
  //   score = null, geltung beliebig      → gar nicht gemessen
  geltung: Geltung;
  geltungGrund: string;
}

// Wie vollständig ist dieser Scan?
//   complete — alle Module liefen
//   partial  — einzelne Module fielen aus; Teilaussagen gelten, Gesamtnote nicht
//   failed   — der Browser-Scan scheiterte; es gibt praktisch keine Aussage
export type ScanStatus = "complete" | "partial" | "failed";

// Zwei getrennte Bewertungen statt einer gemeinsamen Note.
//
// Eine gemeinsame Note über Recht und Marketing ist inhaltlich falsch: Gute
// SEO-Werte können fehlende Pflichtangaben rechnerisch ausgleichen, und genau
// das darf nicht passieren. Rechtliches Risiko und Wachstum sind verschiedene
// Fragen an verschiedene Adressaten.
export interface GruppenErgebnis {
  gruppe: CategoryGroup;
  score: number | null;
  grade: string | null;
  // true = ein kritischer Befund deckelt die Note (siehe scoring.ts).
  gedeckelt: boolean;
}

// Einordnung gegenüber allen bisher geprüften Seiten. Optional, weil sie erst
// ab genügend Messungen berechnet wird — und weil ältere gespeicherte Reports
// sie nicht enthalten.
export interface ReportVergleich {
  gesamt: { besserAls: number; grundlage: number } | null;
  kategorien: Partial<Record<Category, { besserAls: number; grundlage: number }>>;
}

export interface ScanReport {
  id: string; // eindeutig je Scan — Basis für den teilbaren Permalink /r/<id>
  url: string; // eingegebene URL
  finalUrl: string; // nach Redirects
  scannedAt: string; // ISO-Timestamp
  durationMs: number;
  scanStatus: ScanStatus;
  // Getrennt nach Rechtssicherheit und Wachstum. Bei einem unvollständigen
  // Scan bleiben die betroffenen Werte null statt geschätzt zu werden.
  gruppen: GruppenErgebnis[];
  categories: CategoryResult[];
  // Die Angaben, unter denen dieser Report gilt. Gehört in den gespeicherten
  // Report, weil ein Permalink sonst nicht nachvollziehbar wäre: Dieselbe URL
  // mit anderen Angaben ergibt zu Recht ein anderes Urteil.
  kontext?: ScanKontext;
  cached?: boolean; // true = Ergebnis kam aus dem Kurz-Cache
  error?: string;
  // Einordnung im Vergleich zu allen bisher geprüften Seiten (optional).
  vergleich?: ReportVergleich;
}

// Fehler, dessen Text dem Nutzer gezeigt werden darf (falsche Eingabe,
// interne Zieladresse, nicht auflösbare Domain). Alles andere ist ein
// interner Fehler und wird nach außen generisch gemeldet — Stacktraces und
// Bibliotheks-Meldungen verraten sonst Details über den Server.
export class ScanInputError extends Error {
  readonly userFacing = true;
}

// Was ein einzelnes Modul an den Runner zurückgibt:
// nur Findings, das Scoring passiert zentral.
export interface ModuleResult {
  findings: Finding[];
}
