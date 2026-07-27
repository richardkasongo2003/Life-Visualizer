// =========================
// Global state
// =========================
let fullDataset = null;   // { title, species: [...] }
let aiBusy = false;
let currentZoom = 1.0;    // 1 = 100%
let selectedStageIndex = null;
let currentRenderContext = null;

// =========================
// Display rules
// =========================
const MAX_BULLETS = 10;
const BULLET_CHAR_LIMIT = 100000;
const CARD_SUMMARY_BULLETS = 2;

const BULLET_PRIORITY_PREFIX = [
  "Duration:",
  "Timing:",
  "Seasonal timing:",
  "Date range:",
  "Range:",
  "Habitat:",
  "Food:",
  "Diet:",
  "Movement:",
  "Physical:",
  "Traits:",
  "Reproduction:",
  "Threats:",
  "Risk:",
  "Lifespan:",
  "Notes:",
  "Milestone:",
  "Sources:",
  "Source:"
];

// =========================
// Small helpers
// =========================
const SVG_NS = "http://www.w3.org/2000/svg";

function safeText(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function shorten(text, maxChars) {
  if (!text) return "";
  const s = String(text);
  return s.length > maxChars ? s.slice(0, Math.max(0, maxChars - 1)) + "…" : s;
}

// =========================
// =========================
// Month parsing
// =========================
const MONTHS = [
  { k: ["jan", "january"], name: "Jan" },
  { k: ["feb", "february"], name: "Feb" },
  { k: ["mar", "march"], name: "Mar" },
  { k: ["apr", "april"], name: "Apr" },
  { k: ["may"], name: "May" },
  { k: ["jun", "june"], name: "Jun" },
  { k: ["jul", "july"], name: "Jul" },
  { k: ["aug", "august"], name: "Aug" },
  { k: ["sep", "sept", "september"], name: "Sep" },
  { k: ["oct", "october"], name: "Oct" },
  { k: ["nov", "november"], name: "Nov" },
  { k: ["dec", "december"], name: "Dec" }
];

const MONTHS_SHORT = MONTHS.map(m => m.name);
