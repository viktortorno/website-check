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
  score: number; // 0–100
  grade: string; // A–F (von der Scoring-Engine)
  findings: Finding[];
}

export interface ScanReport {
  url: string; // eingegebene URL
  finalUrl: string; // nach Redirects
  scannedAt: string; // ISO-Timestamp
  durationMs: number;
  overallScore: number; // 0–100
  overallGrade: string;
  categories: CategoryResult[];
  cached?: boolean; // true = Ergebnis kam aus dem Kurz-Cache
  error?: string;
}

// Was ein einzelnes Modul an den Runner zurückgibt:
// nur Findings, das Scoring passiert zentral.
export interface ModuleResult {
  findings: Finding[];
}
