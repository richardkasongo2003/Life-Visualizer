// =========================
// Global state
// =========================
let fullDataset = null;   // { title, species: [...] }
let aiBusy = false;
let currentZoom = 1.0;    // 1 = 100%

// =========================
// Display rules
// =========================
const MAX_BULLETS = 10;
const BULLET_CHAR_LIMIT = 100000;

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
// 1D collision solver (STRONG, NO OVERLAP) for CARD CENTERS
// forward + backward passes enforce minDist, with boundary clamp + repeat
// =========================
function distributeCenters(items, minDist, minX, maxX) {
  const sorted = [...items].sort((a, b) => a.desiredCx - b.desiredCx);
  const out = new Map();
  if (!sorted.length) return out;

  const xs = sorted.map(it => clamp(it.desiredCx, minX, maxX));

  const passes = 6;
  for (let p = 0; p < passes; p++) {
    for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + minDist);

    const overflow = xs[xs.length - 1] - maxX;
    if (overflow > 0) for (let i = 0; i < xs.length; i++) xs[i] -= overflow;

    for (let i = xs.length - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - minDist);

    const under = minX - xs[0];
    if (under > 0) for (let i = 0; i < xs.length; i++) xs[i] += under;

    for (let i = 0; i < xs.length; i++) xs[i] = clamp(xs[i], minX, maxX);
  }

  for (let i = 0; i < sorted.length; i++) out.set(sorted[i].id, xs[i]);
  return out;
}

// =========================
// Bullet picking (priority order)
// =========================
function pickBullets(bullets, maxLines) {
  const list = Array.isArray(bullets) ? bullets.map(String) : [];
  const ordered = [];
  const used = new Set();

  BULLET_PRIORITY_PREFIX.forEach(prefix => {
    list.forEach(b => {
      if (!used.has(b) && b.startsWith(prefix)) {
        ordered.push(b);
        used.add(b);
      }
    });
  });

  list.forEach(b => {
    if (!used.has(b)) {
      ordered.push(b);
      used.add(b);
    }
  });

  return ordered.slice(0, maxLines);
}

// =========================
// Text wrapping inside SVG (NO overflow)
// - split on spaces AND on hyphens/slashes/dashes
// - char-break fallback if needed
// =========================
function tokenizeForWrap(text) {
  const normalized = String(text || "")
    .replace(/([\-\/|–—])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.split(" ") : [];
}

function splitToLinesByWidth(text, measureFn, maxWidthPx) {
  const tokens = tokenizeForWrap(text);
  const lines = [];
  let current = "";

  const pushLine = (s) => {
    const t = String(s || "").trim();
    if (t) lines.push(t);
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const test = current ? `${current} ${tok}` : tok;

    if (measureFn(test) <= maxWidthPx) {
      current = test;
      continue;
    }

    pushLine(current);
    current = "";

    if (measureFn(tok) > maxWidthPx) {
      let chunk = "";
      for (const ch of tok) {
        const t = chunk + ch;
        if (measureFn(t) <= maxWidthPx) chunk = t;
        else {
          pushLine(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    } else {
      current = tok;
    }
  }

  pushLine(current);
  return lines;
}

function ensureDefs(svg) {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    svg.appendChild(defs);
  }
  return defs;
}

function makeClipPathRect(svg, id, x, y, w, h, rx = 10) {
  const defs = ensureDefs(svg);

  const old = defs.querySelector(`#${CSS.escape(id)}`);
  if (old && old.parentNode) old.parentNode.removeChild(old);

  const cp = document.createElementNS(SVG_NS, "clipPath");
  cp.setAttribute("id", id);

  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", x);
  r.setAttribute("y", y);
  r.setAttribute("width", w);
  r.setAttribute("height", h);
  r.setAttribute("rx", rx);
  cp.appendChild(r);

  defs.appendChild(cp);
  return `url(#${id})`;
}

function addWrappedBullets({
  svg,
  parentG,
  x,
  y,
  maxWidthPx,
  bullets,
  fontSize = 11.2,
  lineHeight = 14
}) {
  const measurer = document.createElementNS(SVG_NS, "text");
  measurer.setAttribute("x", -9999);
  measurer.setAttribute("y", -9999);
  measurer.setAttribute("font-size", fontSize);
  measurer.setAttribute("visibility", "hidden");
  svg.appendChild(measurer);

  const measureFn = (t) => {
    measurer.textContent = t;
    return measurer.getComputedTextLength();
  };

  let usedHeight = 0;

  for (const b of (bullets || [])) {
    const raw = "• " + safeText(b);
    const lines = splitToLinesByWidth(raw, measureFn, maxWidthPx);

    for (const line of lines) {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", x);
      t.setAttribute("y", y + usedHeight + lineHeight);
      t.setAttribute("font-size", fontSize);
      t.setAttribute("fill", "#334155");
      t.textContent = shorten(line, BULLET_CHAR_LIMIT);

      parentG.appendChild(t);
      usedHeight += lineHeight;
    }
  }

  svg.removeChild(measurer);
  return usedHeight;
}

function estimateBulletHeight({
  svg,
  maxWidthPx,
  bullets,
  fontSize = 11.2,
  lineHeight = 14
}) {
  const measurer = document.createElementNS(SVG_NS, "text");
  measurer.setAttribute("x", -9999);
  measurer.setAttribute("y", -9999);
  measurer.setAttribute("font-size", fontSize);
  measurer.setAttribute("visibility", "hidden");
  svg.appendChild(measurer);

  const measureFn = (t) => {
    measurer.textContent = t;
    return measurer.getComputedTextLength();
  };

  let linesCount = 0;

  for (const b of (bullets || [])) {
    const raw = "• " + safeText(b);
    const lines = splitToLinesByWidth(raw, measureFn, maxWidthPx);
    linesCount += lines.length;
  }

  svg.removeChild(measurer);
  return linesCount * lineHeight;
}

// =========================
// Parsing helpers
// =========================
function getBulletValue(stage, prefixesLower) {
  const bullets = Array.isArray(stage.bullets) ? stage.bullets : [];
  const found = bullets.find(b => prefixesLower.some(p => String(b).toLowerCase().startsWith(p)));
  if (!found) return "";
  return String(found).split(":").slice(1).join(":").trim();
}

function getStageRangeText(stage) {
  const bullets = Array.isArray(stage.bullets) ? stage.bullets.map(b => String(b)) : [];

  // First: strict prefixes
  const strict = getBulletValue(stage, ["timing:", "seasonal timing:", "date range:", "range:"]);
  if (strict) return strict;

  // Fallback: detect month names anywhere
  const monthRegex = /(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i;
  const candidate = bullets.find(b => monthRegex.test(b));

  return candidate || "";
}

function getStageDurationText(stage) {
  return getBulletValue(stage, ["duration:", "incubation duration:", "period:", "time in stage:"]);
}

function getStageSources(stage) {
  const raw = getBulletValue(stage, ["sources:", "source:"]);
  if (!raw) return [];
  return raw.split(/[;|]/).map(s => s.trim()).filter(Boolean);
}

function getStageMilestones(stage) {
  const bullets = Array.isArray(stage.bullets) ? stage.bullets.map(String) : [];
  const milestones = [];

  bullets.forEach(b => {
    if (b.toLowerCase().startsWith("milestone:")) {
      const v = b.split(":").slice(1).join(":").trim();
      if (v) milestones.push(v);
    }
  });

  const blob = bullets.join(" ").toLowerCase();
  const keywordMap = [
    { k: "hatch", label: "Hatching" },
    { k: "spawn", label: "Spawning" },
    { k: "metamorph", label: "Metamorphosis" },
    { k: "migrate", label: "Migration" },
    { k: "settle", label: "Settlement" },
    { k: "sexual matur", label: "Sexual maturity" }
  ];

  keywordMap.forEach(({ k, label }) => {
    if (blob.includes(k) && !milestones.some(m => m.toLowerCase() === label.toLowerCase())) {
      milestones.push(label);
    }
  });

  return [...new Set(milestones)].slice(0, 3);
}

function extractKeyFacts(stage) {
  const habitat = getBulletValue(stage, ["habitat:"]);
  const diet = getBulletValue(stage, ["food:", "diet:"]);
  const movement = getBulletValue(stage, ["movement:"]);
  const reproduction = getBulletValue(stage, ["reproduction:"]);
  const traits = getBulletValue(stage, ["physical:", "traits:"]);
  const threats = getBulletValue(stage, ["threats:", "risk:"]);

  const chips = [];
  if (habitat) chips.push({ icon: "🏞️", label: "Habitat", value: habitat });
  if (diet) chips.push({ icon: "🍽️", label: "Diet", value: diet });
  if (movement) chips.push({ icon: "🧭", label: "Movement", value: movement });
  if (reproduction) chips.push({ icon: "🥚", label: "Repro", value: reproduction });
  if (traits) chips.push({ icon: "🧬", label: "Traits", value: traits });
  if (threats) chips.push({ icon: "⚠️", label: "Threats", value: threats });

  return chips.slice(0, 4);
}

function durationToDays(durationText) {
  if (!durationText) return null;
  const t = durationText.toLowerCase();

  const rangeMatch = t.match(/(\d+(\.\d+)?)\s*(?:-|–|to)\s*(\d+(\.\d+)?)/);
  const singleMatch = t.match(/(\d+(\.\d+)?)/);

  let minVal, maxVal;
  if (rangeMatch) {
    minVal = parseFloat(rangeMatch[1]);
    maxVal = parseFloat(rangeMatch[3]);
  } else if (singleMatch) {
    minVal = maxVal = parseFloat(singleMatch[1]);
  } else {
    return null;
  }

  const avg = (minVal + maxVal) / 2;

  if (t.includes("day")) return avg;
  if (t.includes("week")) return avg * 7;
  if (t.includes("month")) return avg * 30;
  if (t.includes("year")) return avg * 365;

  return null;
}

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

function findMonthIndex(text) {
  const t = (text || "").toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    for (const key of MONTHS[i].k) {
      if (t.includes(key)) return i;
    }
  }
  return null;
}

function parseMonthRange(rangeText) {
  if (!rangeText) return null;
  const lower = rangeText.toLowerCase();
  const normalized = lower.replace(/—|–/g, "-").replace(/\s+to\s+/g, "-");

  let start = null, end = null;

  if (normalized.includes("-")) {
    const parts = normalized.split("-").map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      start = findMonthIndex(parts[0]);
      end = findMonthIndex(parts[parts.length - 1]);
    }
  }

  if (start === null) start = findMonthIndex(normalized);
  if (end === null) end = findMonthIndex(normalized);

  if (start === null && end === null) return null;
  if (start !== null && end === null) end = start;
  if (start === null && end !== null) start = end;

  return { start, end, wraps: end < start };
}

// =========================
// Color helpers
// =========================
function blendHex(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `#${rr.toString(16).padStart(2, "0")}${rg.toString(16).padStart(2, "0")}${rb.toString(16).padStart(2, "0")}`;
}

function heatColor(i, n) {
  if (n <= 1) return "#3b82f6";
  const ratio = i / (n - 1);
  if (ratio < 0.5) return blendHex("#3b82f6", "#10b981", ratio / 0.5);
  return blendHex("#10b981", "#ef4444", (ratio - 0.5) / 0.5);
}

// =========================
// SVG container helpers
// =========================
function createSVG(width, height) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.style.background = "transparent";
  return svg;
}

function clearContainer() {
  const scaler = document.getElementById("svgScaler");
  if (scaler) scaler.innerHTML = "";
}

function showStatus(message) {
  const scaler = document.getElementById("svgScaler");
  if (!scaler) return;
  scaler.innerHTML = "";
  const p = document.createElement("div");
  p.className = "status";
  p.textContent = message;
  scaler.appendChild(p);
}

function applyZoom() {
  const scaler = document.getElementById("svgScaler");
  if (!scaler) return;
  scaler.style.transform = `scale(${currentZoom})`;
  scaler.style.transformOrigin = "0 0";
}

// =========================
// FIXED-X stacking row assigner for span bubbles
// - X stays anchored at earliest month
// - overlaps create additional rows
// =========================
function assignRowsFixedX(items, minGap, minX, maxX) {
  const sorted = [...items].sort((a, b) => a.desiredX - b.desiredX);

  const rows = []; // rows[rowIndex] = [{x,w}, ...]
  const placed = []; // [{ item, x, row }]

  const overlaps = (aX, aW, bX, bW, gap) => {
    const aL = aX, aR = aX + aW;
    const bL = bX, bR = bX + bW;
    return !(aR + gap <= bL || bR + gap <= aL);
  };

  for (const it of sorted) {
    const x = clamp(it.desiredX, minX, maxX - it.w);

    let rowIndex = 0;
    while (true) {
      if (!rows[rowIndex]) rows[rowIndex] = [];

      const rowIntervals = rows[rowIndex];
      let conflict = false;
      for (const iv of rowIntervals) {
        if (overlaps(x, it.w, iv.x, iv.w, minGap)) {
          conflict = true;
          break;
        }
      }

      if (!conflict) {
        rowIntervals.push({ x, w: it.w });
        placed.push({ item: it, x, row: rowIndex });
        break;
      }

      rowIndex++;
      if (rowIndex > 60) {
        if (!rows[rowIndex]) rows[rowIndex] = [];
        rows[rowIndex].push({ x, w: it.w });
        placed.push({ item: it, x, row: rowIndex });
        break;
      }
    }
  }

  return { placed, rowCount: rows.length };
}

function renderTimeline(data) {
  const stages = data.stages || [];
  const n = stages.length;
  if (!n) return;

  const width = 1200;
  const padding = 80;
  const usableW = width - 2 * padding;
  
  const titleY = 50;
  const monthBandY = 130;
  let monthBandH = 80;
  const cardSpacing = 280;
  const cardW = 340;

  // DEFINE MONTHS_SHORT AT TOP LEVEL (used throughout function)
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const svg = createSVG(width, 1200); // Start with larger height, adjust later
  const defs = ensureDefs(svg);

  // ===== TITLE =====
  const title = document.createElementNS(SVG_NS, "text");
  title.setAttribute("x", width / 2);
  title.setAttribute("y", titleY);
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("font-size", 24);
  title.setAttribute("font-weight", "bold");
  title.setAttribute("fill", "#1a1a1a");
  title.textContent = data.title || "Life History";
  svg.appendChild(title);

  if (data.speciesName) {
    const subtitle = document.createElementNS(SVG_NS, "text");
    subtitle.setAttribute("x", width / 2);
    subtitle.setAttribute("y", titleY + 25);
    subtitle.setAttribute("text-anchor", "middle");
    subtitle.setAttribute("font-size", 14);
    subtitle.setAttribute("fill", "#666");
    subtitle.textContent = data.speciesName;
    svg.appendChild(subtitle);
  }

  // ===== MONTHS BAND WITH STAGE INDICATORS =====
  const monthBandBg = document.createElementNS(SVG_NS, "rect");
  monthBandBg.setAttribute("x", padding);
  monthBandBg.setAttribute("y", monthBandY);
  monthBandBg.setAttribute("width", usableW);
  monthBandBg.setAttribute("height", monthBandH);
  monthBandBg.setAttribute("rx", 8);
  monthBandBg.setAttribute("fill", "#f5f5f5");
  monthBandBg.setAttribute("stroke", "#ccc");
  monthBandBg.setAttribute("stroke-width", 2);
  svg.appendChild(monthBandBg);

  const monthW = usableW / 12;

  // === Build stage month ranges for drawing spanning bars ===
  const stageMonthRanges = [];

  stages.forEach((stage, i) => {
    const rangeText = getStageRangeText(stage);
    const monthRange = parseMonthRange(rangeText);

    if (monthRange && monthRange.start !== null && monthRange.end !== null) {
      const { start, end, wraps } = monthRange;
      const color = heatColor(i, n);
      const stageNum = i + 1;
      
      stageMonthRanges.push({ 
        start, 
        end, 
        stageNum, 
        title: stage.title || `Stage ${stageNum}`, 
        color, 
        wraps 
      });
    }
  });

  // === Draw colored bars for each stage across months ===
  const barRowHeight = 20;
  const barGapY = 4;
  let nextBarY = monthBandY + 12;

  stageMonthRanges.forEach((range) => {
    const { start, end, stageNum, title, color, wraps } = range;
    
    const drawStageBar = (startM, endM) => {
      const x1 = padding + startM * monthW;
      const x2 = padding + (endM + 1) * monthW;
      const barW = x2 - x1;
      
      const barRect = document.createElementNS(SVG_NS, "rect");
      barRect.setAttribute("x", x1);
      barRect.setAttribute("y", nextBarY);
      barRect.setAttribute("width", barW);
      barRect.setAttribute("height", barRowHeight);
      barRect.setAttribute("rx", 4);
      barRect.setAttribute("fill", color);
      barRect.setAttribute("opacity", "0.85");
      barRect.setAttribute("stroke", "#fff");
      barRect.setAttribute("stroke-width", 2);
      
      // Add tooltip on hover
      const tooltip = document.createElementNS(SVG_NS, "title");
      const monthNames = MONTHS_SHORT.slice(startM, endM + 1).join(" - ");
      tooltip.textContent = `Stage ${stageNum}: ${title}\nMonths: ${monthNames}`;
      barRect.appendChild(tooltip);
      
      svg.appendChild(barRect);
      
      // Add stage number label centered in the bar
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", x1 + barW / 2);
      label.setAttribute("y", nextBarY + barRowHeight / 2 + 6);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "bold");
      label.setAttribute("fill", "#fff");
      label.setAttribute("pointer-events", "none");
      label.textContent = `${stageNum}`;
      svg.appendChild(label);

      // Add stage title if bar is wide enough
      if (barW > 100) {
        const titleLabel = document.createElementNS(SVG_NS, "text");
        titleLabel.setAttribute("x", x1 + 10);
        titleLabel.setAttribute("y", nextBarY + barRowHeight / 2 + 6);
        titleLabel.setAttribute("font-size", "10");
        titleLabel.setAttribute("fill", "#fff");
        titleLabel.setAttribute("pointer-events", "none");
        const truncated = title.length > 18 ? title.substring(0, 15) + "..." : title;
        titleLabel.textContent = truncated;
        svg.appendChild(titleLabel);
      }
    };

    if (!wraps) {
      drawStageBar(start, end);
    } else {
      // Split into two bars for wrapping ranges
      drawStageBar(start, 11);
      drawStageBar(0, end);
    }

    nextBarY += barRowHeight + barGapY;
  });

  // Update month band height based on number of stages
  const totalBarsHeight = stageMonthRanges.length * (barRowHeight + barGapY) + 12;
  const finalMonthBandH = Math.max(monthBandH, totalBarsHeight + 20);
  monthBandBg.setAttribute("height", finalMonthBandH);

  // Month divider lines and labels (at bottom)
  for (let m = 0; m < 12; m++) {
    const x = padding + m * monthW;

    // Month divider line
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.setAttribute("y1", monthBandY);
    line.setAttribute("y2", monthBandY + finalMonthBandH);
    line.setAttribute("stroke", "#ddd");
    line.setAttribute("stroke-width", 1);
    svg.appendChild(line);

    // Month label at bottom
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", x + monthW / 2);
    label.setAttribute("y", monthBandY + finalMonthBandH - 6);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "12");
    label.setAttribute("font-weight", "bold");
    label.setAttribute("fill", "#333");
    label.textContent = MONTHS_SHORT[m];
    svg.appendChild(label);
  }

  // ===== TIMELINE LINE & STAGE CARDS =====
  const cardsStartY = monthBandY + finalMonthBandH + 40;
  const timelineX = padding + 30;
  const timelineLine = document.createElementNS(SVG_NS, "line");
  timelineLine.setAttribute("x1", timelineX);
  timelineLine.setAttribute("x2", timelineX);
  timelineLine.setAttribute("y1", cardsStartY);
  timelineLine.setAttribute("y2", cardsStartY + (n * cardSpacing));
  timelineLine.setAttribute("stroke", "#ddd");
  timelineLine.setAttribute("stroke-width", 3);
  svg.appendChild(timelineLine);

  // Draw each stage card
  stages.forEach((stage, i) => {
    const cardY = cardsStartY + i * cardSpacing;
    const color = heatColor(i, n);

    // Stage dot on timeline
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", timelineX);
    circle.setAttribute("cy", cardY + 40);
    circle.setAttribute("r", 12);
    circle.setAttribute("fill", color);
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", 3);
    svg.appendChild(circle);

    const stageNum = document.createElementNS(SVG_NS, "text");
    stageNum.setAttribute("x", timelineX);
    stageNum.setAttribute("y", cardY + 45);
    stageNum.setAttribute("text-anchor", "middle");
    stageNum.setAttribute("font-size", 11);
    stageNum.setAttribute("font-weight", "bold");
    stageNum.setAttribute("fill", "#fff");
    stageNum.textContent = i + 1;
    svg.appendChild(stageNum);

    // Card background
    const cardX = padding + 80;

    const card = document.createElementNS(SVG_NS, "rect");
    card.setAttribute("x", cardX);
    card.setAttribute("y", cardY);
    card.setAttribute("width", cardW);
    card.setAttribute("height", 220);
    card.setAttribute("rx", 8);
    card.setAttribute("fill", "#fff");
    card.setAttribute("stroke", "#ddd");
    card.setAttribute("stroke-width", 1);
    svg.appendChild(card);

    // Card header
    const header = document.createElementNS(SVG_NS, "rect");
    header.setAttribute("x", cardX);
    header.setAttribute("y", cardY);
    header.setAttribute("width", cardW);
    header.setAttribute("height", 40);
    header.setAttribute("rx", 8);
    header.setAttribute("fill", color);
    svg.appendChild(header);

    // Stage title
    const cardTitle = document.createElementNS(SVG_NS, "text");
    cardTitle.setAttribute("x", cardX + 12);
    cardTitle.setAttribute("y", cardY + 25);
    cardTitle.setAttribute("font-size", 15);
    cardTitle.setAttribute("font-weight", "bold");
    cardTitle.setAttribute("fill", "#fff");
    cardTitle.textContent = stage.title || `Stage ${i + 1}`;
    svg.appendChild(cardTitle);

    // Duration info
    const durationText = getStageDurationText(stage);
    let bulletStartY = cardY + 60;

    if (durationText) {
      const duration = document.createElementNS(SVG_NS, "text");
      duration.setAttribute("x", cardX + 12);
      duration.setAttribute("y", bulletStartY);
      duration.setAttribute("font-size", 11);
      duration.setAttribute("font-weight", "bold");
      duration.setAttribute("fill", color);
      duration.textContent = `⏱ Duration: ${durationText}`;
      svg.appendChild(duration);
      bulletStartY += 18;
    }

    // Season/Month range info
    const rangeText = getStageRangeText(stage);
    const monthRange = parseMonthRange(rangeText);
    
    if (monthRange && typeof monthRange.start === "number" && typeof monthRange.end === "number") {
      const startName = MONTHS_SHORT[monthRange.start];
      const endName = MONTHS_SHORT[monthRange.end];
      const monthLabel = monthRange.start === monthRange.end 
        ? startName 
        : `${startName} – ${endName}`;

      const season = document.createElementNS(SVG_NS, "text");
      season.setAttribute("x", cardX + 12);
      season.setAttribute("y", bulletStartY);
      season.setAttribute("font-size", 11);
      season.setAttribute("font-weight", "bold");
      season.setAttribute("fill", color);
      season.setAttribute("text-decoration", "underline");
      season.textContent = `📅 Months: ${monthLabel}`;
      svg.appendChild(season);
      bulletStartY += 18;
    }

    // Other bullet points
    const bullets = pickBullets(stage.bullets || [], 3);
    let bulletY = bulletStartY + 8;
    
    bullets.forEach(bullet => {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", cardX + 12);
      text.setAttribute("y", bulletY);
      text.setAttribute("font-size", 10);
      text.setAttribute("fill", "#333");
      text.textContent = "• " + shorten(String(bullet), 45);
      svg.appendChild(text);
      bulletY += 15;
    });
  });

  const height = cardsStartY + (n * cardSpacing) + 100;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("height", height);

  const scaler = document.getElementById("svgScaler");
  scaler.appendChild(svg);
}

// =========================
// Render flow
// =========================
function renderTemplateTimelineOnly(data) {
  clearContainer();

  if (!data || !data.stages || data.stages.length === 0) {
    showStatus("No stages found. Check your data or upload another file.");
    return;
  }

  renderTimeline(data);
  applyZoom();
}

// =========================
// Dataset helpers
// =========================
function normalizeDataset(raw) {
  if (raw.species && Array.isArray(raw.species)) {
    raw.species.forEach(sp => {
      if (typeof sp.aiEnhanced === "undefined") sp.aiEnhanced = false;
    });
    return raw;
  }

  return {
    title: raw.title || "Life history",
    species: [
      {
        name: raw.speciesName || "Species",
        title: raw.title || "Life history",
        imageFile: raw.imageFile || null,
        imageUrl: raw.imageUrl || null,
        stages: raw.stages || [],
        aiEnhanced: false
      }
    ]
  };
}

function populateSpeciesSelect(dataset) {
  const select = document.getElementById("speciesSelect");
  if (!select) return;

  select.innerHTML = "";
  dataset.species.forEach((sp, idx) => {
    const opt = document.createElement("option");
    opt.value = sp.name || `species_${idx}`;
    opt.textContent = sp.name || sp.title || `Species ${idx + 1}`;
    select.appendChild(opt);
  });
}

function getCurrentSpeciesObj() {
  if (!fullDataset || !fullDataset.species || !fullDataset.species.length) return null;
  const select = document.getElementById("speciesSelect");
  if (!select) return fullDataset.species[0];

  const chosenName = select.value;
  return fullDataset.species.find(s => s.name === chosenName) || fullDataset.species[0];
}

function speciesToRenderData(sp) {
  if (!sp) return null;
  return {
    title: sp.title || `${fullDataset.title} – ${sp.name}`,
    stages: sp.stages || [],
    imageFile: sp.imageFile || null,
    imageUrl: sp.imageUrl || null,
    speciesName: sp.name || null
  };
}

function loadDatasetFromInput(callback) {
  const fileEl = document.getElementById("fileInput");
  const txt = document.getElementById("jsonInput")?.value?.trim() || "";

  if (fileEl && fileEl.files && fileEl.files.length) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const raw = JSON.parse(e.target.result);
        callback(null, normalizeDataset(raw));
      } catch (err) {
        callback(err);
      }
    };
    reader.readAsText(fileEl.files[0]);
    return;
  }

  if (txt) {
    try {
      const raw = JSON.parse(txt);
      callback(null, normalizeDataset(raw));
    } catch (err) {
      callback(err);
    }
    return;
  }

  callback(null, normalizeDataset({
    title: "Life history",
    stages: [
      {
        title: "Egg",
        bullets: [
          "Duration: 7–14 days",
          "Timing: May–Aug",
          "Reproductive strategy: asynchronous egg laying with oldest chick near fledging when youngest hatches",
          "Embryonic development duration: 9–11 days",
          "Initial clutch size: 1–5 eggs"
        ]
      },
      {
        title: "Adult",
        bullets: [
          "Duration: 1–3 years",
          "Timing: Year-round",
          "Sexually mature stage",
          "Capable of reproduction",
          "Seasonality: year-round presence",
          "Engages in breeding activities"
        ]
      }
    ]
  }));
}

// =========================
// AI enhancement helper
// =========================
function renderCurrentSpeciesWithAI(options = { force: false }) {
  if (!fullDataset) return;

  const sp = getCurrentSpeciesObj();
  if (!sp) return;

  const aiButton = document.getElementById("aiEnhanceBtn");

  const disableButtons = (disabled) => {
    aiBusy = disabled;
    if (aiButton) aiButton.disabled = disabled;
  };

  if (sp.aiEnhanced && !options.force) {
    renderTemplateTimelineOnly(speciesToRenderData(sp));
    return;
  }

  disableButtons(true);
  showStatus("Enhancing diagram with AI...");

  fetch("/ai_enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: sp.title || fullDataset.title || sp.name,
      stages: sp.stages || []
    })
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        console.error("AI error:", data.error);
        showStatus("AI enhancement failed – showing original layout.");
        renderTemplateTimelineOnly(speciesToRenderData(sp));
        return;
      }

      sp.stages = data.stages || sp.stages;
      if (data.title) sp.title = data.title;
      sp.aiEnhanced = true;

      const toRender = speciesToRenderData(sp);
      renderTemplateTimelineOnly(toRender);

      const jsonOut = { title: toRender.title, stages: toRender.stages };
      const jsonInput = document.getElementById("jsonInput");
      if (jsonInput) jsonInput.value = JSON.stringify(jsonOut, null, 2);
    })
    .catch(err => {
      console.error("AI enhancement failed:", err);
      showStatus("AI enhancement failed – showing original layout.");
      renderTemplateTimelineOnly(speciesToRenderData(sp));
    })
    .finally(() => disableButtons(false));
}

// =========================
// SVG -> PNG
// =========================
function svgToPngBase64(svgEl, width = 1700, height = 1150, callback) {
  const serializer = new XMLSerializer();
  let svgStr = serializer.serializeToString(svgEl);

  if (!svgStr.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
    svgStr = svgStr.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  img.onload = function () {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;

    ctx.drawImage(img, x, y, w, h);

    const dataUrl = canvas.toDataURL("image/png");
    URL.revokeObjectURL(url);
    callback(null, dataUrl);
  };

  img.onerror = function (e) {
    callback(e, null);
  };

  img.src = url;
}

// =========================
// Event listeners
// =========================
document.getElementById("renderBtn")?.addEventListener("click", () => {
  loadDatasetFromInput((err, dataset) => {
    if (err) return alert("Invalid JSON");
    fullDataset = dataset;
    populateSpeciesSelect(fullDataset);
    renderCurrentSpeciesWithAI({ force: true });
  });
});

document.getElementById("speciesSelect")?.addEventListener("change", () => {
  if (!fullDataset) return;
  renderCurrentSpeciesWithAI({ force: false });
});

document.getElementById("downloadPngBtn")?.addEventListener("click", () => {
  const svg = document.querySelector("#svgScaler svg");
  if (!svg) return alert("Render first");

  svgToPngBase64(svg, 1800, 1250, (err, pngDataUrl) => {
    if (err) return alert("Failed to convert");
    const a = document.createElement("a");
    a.href = pngDataUrl;
    a.download = "lifeviz_timeline_clean.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
});

document.getElementById("exportPptxBtn")?.addEventListener("click", () => {
  const svg = document.querySelector("#svgScaler svg");
  if (!svg) return alert("Render first");

  svgToPngBase64(svg, 1800, 1250, (err, pngDataUrl) => {
    if (err) return alert("Failed to convert to png");

    const sp = getCurrentSpeciesObj();
    const title = (sp && sp.title) || "LifeViz Timeline";

    fetch("/generate_pptx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title, image_b64: pngDataUrl })
    })
      .then(r => {
        if (!r.ok) throw new Error("Server error creating PPTX");
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title}.pptx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(e => alert("Error: " + e.message));
  });
});

document.getElementById("uploadExcelFullBtn")?.addEventListener("click", () => {
  const excelFile = document.getElementById("excelInput")?.files?.[0];
  if (!excelFile) return alert("Choose an Excel (.xlsx) workbook first.");

  const formData = new FormData();
  formData.append("file", excelFile);

  fetch("/upload_excel_full", { method: "POST", body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.error) return alert("Error: " + data.error);

      fullDataset = normalizeDataset(data);
      populateSpeciesSelect(fullDataset);
      renderCurrentSpeciesWithAI({ force: true });

      const jsonInput = document.getElementById("jsonInput");
      if (jsonInput) jsonInput.value = JSON.stringify(data, null, 2);
    })
    .catch(err => alert("Upload failed: " + err));
});

document.getElementById("uploadExcelSimpleBtn")?.addEventListener("click", () => {
  const excelFile = document.getElementById("excelInput")?.files?.[0];
  if (!excelFile) return alert("Choose an Excel (.xlsx) template first.");

  const formData = new FormData();
  formData.append("file", excelFile);

  fetch("/upload_excel_simple", { method: "POST", body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.error) return alert("Error: " + data.error);

      fullDataset = normalizeDataset(data);
      populateSpeciesSelect(fullDataset);
      renderCurrentSpeciesWithAI({ force: true });

      const jsonInput = document.getElementById("jsonInput");
      if (jsonInput) jsonInput.value = JSON.stringify(data, null, 2);
    })
    .catch(err => alert("Upload failed: " + err));
});

document.getElementById("aiEnhanceBtn")?.addEventListener("click", () => {
  if (!fullDataset) return alert("Load data first (Excel or JSON), then try AI.");
  renderCurrentSpeciesWithAI({ force: true });
});

document.getElementById("zoomRange")?.addEventListener("input", (e) => {
  const value = Number(e.target.value);
  currentZoom = value / 100.0;
  const zl = document.getElementById("zoomLabel");
  if (zl) zl.textContent = `${value}%`;
  applyZoom();
});

window.addEventListener("DOMContentLoaded", () => {
  fetch("/static/data/sample.json")
    .then(res => (res.ok ? res.json() : null))
    .then(raw => {
      if (!raw) return;
      fullDataset = normalizeDataset(raw);
      populateSpeciesSelect(fullDataset);
      renderCurrentSpeciesWithAI({ force: true });

      const jsonInput = document.getElementById("jsonInput");
      if (jsonInput) jsonInput.value = JSON.stringify(raw, null, 2);
    })
    .catch(() => {});
});