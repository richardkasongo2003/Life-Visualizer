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

function splitWordsIntoChunks(text, maxWordsPerLine = 6) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];

  const chunks = [];
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    chunks.push(words.slice(i, i + maxWordsPerLine).join(" "));
  }
  return chunks;
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
  maxHeight = Infinity,
  fontSize = 11.2,
  lineHeight = 14,
  maxWordsPerLine = 6
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
  let lastTextEl = null;

  const fitWithEllipsis = (rawText) => {
    let candidate = String(rawText || "").replace(/\.\.\.$/, "").trim();
    if (!candidate) return "...";

    while (candidate.length > 1 && measureFn(candidate + "...") > maxWidthPx) {
      candidate = candidate.slice(0, -1).trimEnd();
    }

    return candidate + "...";
  };

  for (const b of (bullets || [])) {
    const logicalLines = splitWordsIntoChunks(safeText(b), maxWordsPerLine);
    const lines = [];

    logicalLines.forEach((chunk, idx) => {
      const raw = `${idx === 0 ? "- " : ""}${chunk}`;
      const wrapped = splitToLinesByWidth(raw, measureFn, maxWidthPx);
      lines.push(...wrapped);
    });

    for (const line of lines) {
      if (usedHeight + lineHeight > maxHeight) {
        if (lastTextEl) lastTextEl.textContent = fitWithEllipsis(lastTextEl.textContent);
        svg.removeChild(measurer);
        return usedHeight;
      }

      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", x);
      t.setAttribute("y", y + usedHeight + lineHeight);
      t.setAttribute("font-size", fontSize);
      t.setAttribute("fill", "#334155");
      t.textContent = shorten(line, BULLET_CHAR_LIMIT);

      parentG.appendChild(t);
      lastTextEl = t;
      usedHeight += lineHeight;
    }
  }

  svg.removeChild(measurer);
  return usedHeight;
}

function addWrappedTextLines({
  svg,
  parentG,
  text,
  x,
  y,
  maxWidthPx,
  fontSize = 12,
  lineHeight = 14,
  maxLines = 2,
  fill = "#111827",
  fontWeight = null
}) {
  const measurer = document.createElementNS(SVG_NS, "text");
  measurer.setAttribute("x", -9999);
  measurer.setAttribute("y", -9999);
  measurer.setAttribute("font-size", fontSize);
  if (fontWeight !== null) measurer.setAttribute("font-weight", fontWeight);
  measurer.setAttribute("visibility", "hidden");
  svg.appendChild(measurer);

  const measureFn = (t) => {
    measurer.textContent = t;
    return measurer.getComputedTextLength();
  };

  const rawLines = splitToLinesByWidth(safeText(text), measureFn, maxWidthPx);
  const lines = rawLines.slice(0, Math.max(1, maxLines));

  if (rawLines.length > lines.length) {
    let tail = lines[lines.length - 1];
    while (tail.length > 1 && measureFn(tail + "...") > maxWidthPx) {
      tail = tail.slice(0, -1);
    }
    lines[lines.length - 1] = tail + "...";
  }

  lines.forEach((line, i) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", x);
    t.setAttribute("y", y + i * lineHeight);
    t.setAttribute("font-size", fontSize);
    t.setAttribute("fill", fill);
    if (fontWeight !== null) t.setAttribute("font-weight", fontWeight);
    t.textContent = line;
    parentG.appendChild(t);
  });

  svg.removeChild(measurer);
  return lines.length * lineHeight;
}

function getSpeciesLifespanText(data) {
  const stages = Array.isArray(data?.stages) ? data.stages : [];

  for (const stage of stages) {
    const value = getBulletValue(stage, ["lifespan:"]);
    if (value) return value;
  }

  return "";
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

function estimateWrappedTextHeight({
  svg,
  text,
  maxWidthPx,
  fontSize = 12,
  lineHeight = 14,
  maxLines = Infinity,
  fontWeight = null
}) {
  const measurer = document.createElementNS(SVG_NS, "text");
  measurer.setAttribute("x", -9999);
  measurer.setAttribute("y", -9999);
  measurer.setAttribute("font-size", fontSize);
  if (fontWeight !== null) measurer.setAttribute("font-weight", fontWeight);
  measurer.setAttribute("visibility", "hidden");
  svg.appendChild(measurer);

  const measureFn = (t) => {
    measurer.textContent = t;
    return measurer.getComputedTextLength();
  };

  const rawLines = splitToLinesByWidth(safeText(text), measureFn, maxWidthPx);
  const lineCount = Math.min(rawLines.length, Math.max(1, maxLines));

  svg.removeChild(measurer);
  return lineCount * lineHeight;
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

function getStageSummaryBullets(stage, maxItems = 2) {
  const facts = extractKeyFacts(stage).map(chip => `${chip.label}: ${chip.value}`);
  const milestones = getStageMilestones(stage).map(m => `Milestone: ${m}`);
  const notes = pickBullets(stage.bullets || [], 6).filter(
    b => !/^(duration|timing|seasonal timing|date range|range|lifespan|habitat|food|diet|movement|reproduction|physical|traits|threats|risk|sources?|milestone)\s*:/i.test(String(b))
  );

  return [...facts, ...milestones, ...notes].slice(0, maxItems);
}

function getAdaptiveBulletLimit(template, stageCount) {
  if (template === "circular") {
    if (stageCount <= 4) return 3;
    if (stageCount <= 7) return 2;
    return 1;
  }

  if (stageCount <= 5) return 3;
  if (stageCount <= 8) return 2;
  return 1;
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
function parseDurationForRing(durationText) {
  if (!durationText) return { days: null, bucket: "unknown" };
  const t = String(durationText).toLowerCase();
  const days = durationToDays(durationText);
  if (!Number.isFinite(days) || days <= 0) return { days: null, bucket: "unknown" };

  if (t.includes("year")) return { days, bucket: "year" };
  if (t.includes("month")) return { days, bucket: "month" };
  if (t.includes("week")) return { days, bucket: "week" };
  if (t.includes("day")) return { days, bucket: "day" };
  return { days, bucket: "unknown" };
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

const MONTHS_SHORT = MONTHS.map(m => m.name);

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
  const bulletLimit = getAdaptiveBulletLimit("timeline", n);

  const width = 1200;
  const padding = 80;
  const usableW = width - 2 * padding;

  const titleY = 50;
  const monthBandY = 130;
  let monthBandH = 80;
  const cardSpacing = 280;
  const cardW = 340;

  const svg = createSVG(width, 1200);

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
  const stageMonthRanges = [];

  stages.forEach((stage, i) => {
    const rangeText = getStageRangeText(stage);
    const monthRange = parseMonthRange(rangeText);

    if (monthRange && monthRange.start !== null && monthRange.end !== null) {
      stageMonthRanges.push({
        start: monthRange.start,
        end: monthRange.end,
        stageNum: i + 1,
        title: stage.title || `Stage ${i + 1}`,
        color: heatColor(i, n),
        wraps: monthRange.wraps
      });
    }
  });

  const barRowHeight = 20;
  const barGapY = 4;
  let nextBarY = monthBandY + 12;

  stageMonthRanges.forEach((range) => {
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
      barRect.setAttribute("fill", range.color);
      barRect.setAttribute("opacity", "0.85");
      barRect.setAttribute("stroke", "#fff");
      barRect.setAttribute("stroke-width", 2);

      const tooltip = document.createElementNS(SVG_NS, "title");
      const monthNames = MONTHS_SHORT.slice(startM, endM + 1).join(" - ");
      tooltip.textContent = `Stage ${range.stageNum}: ${range.title}\nMonths: ${monthNames}`;
      barRect.appendChild(tooltip);
      svg.appendChild(barRect);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", x1 + barW / 2);
      label.setAttribute("y", nextBarY + barRowHeight / 2 + 6);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "bold");
      label.setAttribute("fill", "#fff");
      label.textContent = `${range.stageNum}`;
      svg.appendChild(label);
    };

    if (!range.wraps) {
      drawStageBar(range.start, range.end);
    } else {
      drawStageBar(range.start, 11);
      drawStageBar(0, range.end);
    }

    nextBarY += barRowHeight + barGapY;
  });

  const totalBarsHeight = stageMonthRanges.length * (barRowHeight + barGapY) + 12;
  const finalMonthBandH = Math.max(monthBandH, totalBarsHeight + 20);
  monthBandBg.setAttribute("height", finalMonthBandH);

  for (let m = 0; m < 12; m++) {
    const x = padding + m * monthW;

    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.setAttribute("y1", monthBandY);
    line.setAttribute("y2", monthBandY + finalMonthBandH);
    line.setAttribute("stroke", "#ddd");
    line.setAttribute("stroke-width", 1);
    svg.appendChild(line);

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

  const cardsStartY = monthBandY + finalMonthBandH + 40;
  const timelineX = padding + 30;
  let cursorY = cardsStartY;

  const timelineLine = document.createElementNS(SVG_NS, "line");
  timelineLine.setAttribute("x1", timelineX);
  timelineLine.setAttribute("x2", timelineX);
  timelineLine.setAttribute("y1", cardsStartY);
  timelineLine.setAttribute("stroke", "#ddd");
  timelineLine.setAttribute("stroke-width", 3);
  svg.appendChild(timelineLine);

  stages.forEach((stage, i) => {
    const titleHeight = estimateWrappedTextHeight({
      svg,
      text: stage.title || `Stage ${i + 1}`,
      maxWidthPx: cardW - 24,
      fontSize: 13,
      lineHeight: 13,
      maxLines: 2,
      fontWeight: "bold"
    });

    const durationText = getStageDurationText(stage);
    const durationHeight = durationText ? estimateWrappedTextHeight({
      svg,
      text: `Duration: ${durationText}`,
      maxWidthPx: cardW - 24,
      fontSize: 11,
      lineHeight: 13,
      maxLines: 2,
      fontWeight: "bold"
    }) : 0;

    const bullets = getStageSummaryBullets(stage, bulletLimit);
    const bulletHeight = estimateBulletHeight({
      svg,
      maxWidthPx: cardW - 24,
      bullets,
      fontSize: 10,
      lineHeight: 13
    });

    const cardH = Math.max(220, 40 + 12 + titleHeight + 12 + durationHeight + (durationText ? 6 : 0) + bulletHeight + 20);
    const cardY = cursorY;
    const color = heatColor(i, n);

    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", timelineX);
    dot.setAttribute("cy", cardY + 40);
    dot.setAttribute("r", 12);
    dot.setAttribute("fill", color);
    dot.setAttribute("stroke", "#fff");
    dot.setAttribute("stroke-width", 3);
    svg.appendChild(dot);

    const dotNum = document.createElementNS(SVG_NS, "text");
    dotNum.setAttribute("x", timelineX);
    dotNum.setAttribute("y", cardY + 45);
    dotNum.setAttribute("text-anchor", "middle");
    dotNum.setAttribute("font-size", 11);
    dotNum.setAttribute("font-weight", "bold");
    dotNum.setAttribute("fill", "#fff");
    dotNum.textContent = i + 1;
    svg.appendChild(dotNum);

    const cardX = padding + 80;

    const card = document.createElementNS(SVG_NS, "rect");
    card.setAttribute("x", cardX);
    card.setAttribute("y", cardY);
    card.setAttribute("width", cardW);
    card.setAttribute("height", cardH);
    card.setAttribute("rx", 8);
    card.setAttribute("fill", "#fff");
    card.setAttribute("stroke", "#ddd");
    card.setAttribute("stroke-width", 1);
    svg.appendChild(card);

    const header = document.createElementNS(SVG_NS, "rect");
    header.setAttribute("x", cardX);
    header.setAttribute("y", cardY);
    header.setAttribute("width", cardW);
    header.setAttribute("height", 40);
    header.setAttribute("rx", 8);
    header.setAttribute("fill", color);
    svg.appendChild(header);

    const headerClipId = `timeline-card-head-${i}`;
    const bodyClipId = `timeline-card-body-${i}`;
    const headerClip = makeClipPathRect(svg, headerClipId, cardX + 8, cardY + 4, cardW - 16, 30, 6);
    const bodyClip = makeClipPathRect(svg, bodyClipId, cardX + 8, cardY + 44, cardW - 16, cardH - 54, 6);

    const headerTextGroup = document.createElementNS(SVG_NS, "g");
    headerTextGroup.setAttribute("clip-path", headerClip);
    svg.appendChild(headerTextGroup);

    const bodyTextGroup = document.createElementNS(SVG_NS, "g");
    bodyTextGroup.setAttribute("clip-path", bodyClip);
    svg.appendChild(bodyTextGroup);

    addWrappedTextLines({
      svg,
      parentG: headerTextGroup,
      text: stage.title || `Stage ${i + 1}`,
      x: cardX + 12,
      y: cardY + 20,
      maxWidthPx: cardW - 24,
      fontSize: 13,
      lineHeight: 13,
      maxLines: 2,
      fill: "#fff",
      fontWeight: "bold"
    });

    let bulletStartY = cardY + 60;

    if (durationText) {
      const used = addWrappedTextLines({
        svg,
        parentG: bodyTextGroup,
        text: `Duration: ${durationText}`,
        x: cardX + 12,
        y: bulletStartY,
        maxWidthPx: cardW - 24,
        fontSize: 11,
        lineHeight: 13,
        maxLines: 2,
        fill: color,
        fontWeight: "bold"
      });
      bulletStartY += Math.max(16, used + 2);
    }

    addWrappedBullets({
      svg,
      parentG: bodyTextGroup,
      x: cardX + 12,
      y: bulletStartY - 6,
      maxWidthPx: cardW - 24,
      bullets,
      maxHeight: Math.max(0, (cardY + cardH) - bulletStartY - 12),
      fontSize: 10,
      lineHeight: 13
    });

    cursorY += cardH + 60;
  });

  timelineLine.setAttribute("y2", Math.max(cardsStartY, cursorY - 60 + 40));

  const height = cursorY + 40;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("height", height);

  const scaler = document.getElementById("svgScaler");
  scaler.appendChild(svg);
}

function renderCircular(data) {
  const stages = data.stages || [];
  const n = stages.length;
  if (!n) return;
  const bulletLimit = getAdaptiveBulletLimit("circular", n);

  const width = 1300;
  const padding = 80;
  const usableW = width - 2 * padding;

  const titleY = 50;
  const monthBandY = 130;
  const monthBandH = 80;

  const svg = createSVG(width, 1700);

  const title = document.createElementNS(SVG_NS, "text");
  title.setAttribute("x", width / 2);
  title.setAttribute("y", titleY);
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("font-size", 24);
  title.setAttribute("font-weight", "bold");
  title.setAttribute("fill", "#111827");
  title.textContent = data.title || "Life History";
  svg.appendChild(title);

  if (data.speciesName) {
    const subtitle = document.createElementNS(SVG_NS, "text");
    subtitle.setAttribute("x", width / 2);
    subtitle.setAttribute("y", titleY + 24);
    subtitle.setAttribute("text-anchor", "middle");
    subtitle.setAttribute("font-size", 14);
    subtitle.setAttribute("fill", "#6b7280");
    subtitle.textContent = data.speciesName;
    svg.appendChild(subtitle);
  }

  const monthBandBg = document.createElementNS(SVG_NS, "rect");
  monthBandBg.setAttribute("x", padding);
  monthBandBg.setAttribute("y", monthBandY);
  monthBandBg.setAttribute("width", usableW);
  monthBandBg.setAttribute("height", monthBandH);
  monthBandBg.setAttribute("rx", 10);
  monthBandBg.setAttribute("fill", "#f8fafc");
  monthBandBg.setAttribute("stroke", "#cbd5e1");
  monthBandBg.setAttribute("stroke-width", 1.5);
  svg.appendChild(monthBandBg);

  const monthW = usableW / 12;
  const stageMonthRanges = [];

  stages.forEach((stage, i) => {
    const rangeText = getStageRangeText(stage);
    const monthRange = parseMonthRange(rangeText);
    if (monthRange && monthRange.start !== null && monthRange.end !== null) {
      stageMonthRanges.push({
        start: monthRange.start,
        end: monthRange.end,
        wraps: monthRange.wraps,
        stageNum: i + 1,
        title: stage.title || `Stage ${i + 1}`,
        color: heatColor(i, n)
      });
    }
  });

  const barRowHeight = 20;
  const barGapY = 4;
  let nextBarY = monthBandY + 10;

  stageMonthRanges.forEach((range) => {
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
      barRect.setAttribute("fill", range.color);
      barRect.setAttribute("opacity", "0.88");
      barRect.setAttribute("stroke", "#fff");
      barRect.setAttribute("stroke-width", 1.5);
      svg.appendChild(barRect);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", x1 + barW / 2);
      label.setAttribute("y", nextBarY + barRowHeight / 2 + 4);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", 10);
      label.setAttribute("font-weight", "bold");
      label.setAttribute("fill", "#ffffff");
      label.textContent = `${range.stageNum}`;
      svg.appendChild(label);
    };

    if (!range.wraps) {
      drawStageBar(range.start, range.end);
    } else {
      drawStageBar(range.start, 11);
      drawStageBar(0, range.end);
    }

    nextBarY += barRowHeight + barGapY;
  });

  const totalBarsHeight = stageMonthRanges.length * (barRowHeight + barGapY) + 12;
  const finalMonthBandH = Math.max(monthBandH, totalBarsHeight + 20);
  monthBandBg.setAttribute("height", finalMonthBandH);

  for (let m = 0; m < 12; m++) {
    const x = padding + m * monthW;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.setAttribute("y1", monthBandY);
    line.setAttribute("y2", monthBandY + finalMonthBandH);
    line.setAttribute("stroke", "#e2e8f0");
    line.setAttribute("stroke-width", 1);
    svg.appendChild(line);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", x + monthW / 2);
    label.setAttribute("y", monthBandY + finalMonthBandH - 6);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", 12);
    label.setAttribute("font-weight", "bold");
    label.setAttribute("fill", "#334155");
    label.textContent = MONTHS_SHORT[m];
    svg.appendChild(label);
  }

  const cardW = 290;
  const baseCardH = 170;
  const centerX = width / 2;
  const outerR = 260;
  const nodeOrbitR = outerR - 6;
  const cardOrbitR = outerR + Math.min(310, Math.max(220, n * 20));

  const estimatedCardHeights = stages.map((stage, i) => {
    const durationText = getStageDurationText(stage);
    const detailBullets = getStageSummaryBullets(stage, bulletLimit);
    const durationHeight = durationText ? estimateWrappedTextHeight({
      svg,
      text: `Duration: ${durationText}`,
      maxWidthPx: cardW - 18,
      fontSize: 10.5,
      lineHeight: 12,
      maxLines: 2,
      fontWeight: "bold"
    }) : 0;
    const bulletHeight = estimateBulletHeight({
      svg,
      maxWidthPx: cardW - 18,
      bullets: detailBullets,
      fontSize: 10,
      lineHeight: 12
    });
    return Math.max(baseCardH, 48 + durationHeight + (durationText ? 4 : 0) + bulletHeight + 18);
  });
  const maxCardH = estimatedCardHeights.reduce((max, h) => Math.max(max, h), baseCardH);

  const sectionGap = 56;
  const safeTopY = monthBandY + finalMonthBandH + sectionGap;
  const minCenterYForCards = safeTopY + cardOrbitR + (maxCardH / 2);
  const centerY = Math.max(monthBandY + finalMonthBandH + 390, minCenterYForCards);

  const ringBackdrop = document.createElementNS(SVG_NS, "circle");
  ringBackdrop.setAttribute("cx", centerX);
  ringBackdrop.setAttribute("cy", centerY);
  ringBackdrop.setAttribute("r", outerR + 30);
  ringBackdrop.setAttribute("fill", "#f8fafc");
  ringBackdrop.setAttribute("stroke", "#e2e8f0");
  ringBackdrop.setAttribute("stroke-width", 1);
  svg.appendChild(ringBackdrop);

  const mainRing = document.createElementNS(SVG_NS, "circle");
  mainRing.setAttribute("cx", centerX);
  mainRing.setAttribute("cy", centerY);
  mainRing.setAttribute("r", outerR);
  mainRing.setAttribute("fill", "none");
  mainRing.setAttribute("stroke", "#94a3b8");
  mainRing.setAttribute("stroke-width", 2);
  mainRing.setAttribute("stroke-dasharray", "6 6");
  svg.appendChild(mainRing);

  const durationPieOuterR = 124;
  const durationPieInnerR = 60;

  const toArcPoint = (cx, cy, r, deg) => {
    const rad = deg * Math.PI / 180;
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
  };

  const donutSlicePath = (cx, cy, outerRadius, innerRadius, startDeg, endDeg) => {
    const outerStart = toArcPoint(cx, cy, outerRadius, startDeg);
    const outerEnd = toArcPoint(cx, cy, outerRadius, endDeg);
    const innerEnd = toArcPoint(cx, cy, innerRadius, endDeg);
    const innerStart = toArcPoint(cx, cy, innerRadius, startDeg);
    const delta = Math.abs(endDeg - startDeg);
    const largeArc = delta > 180 ? "1" : "0";

    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
      "Z"
    ].join(" ");
  };

  const durationValues = stages.map((stage) => {
    const days = durationToDays(getStageDurationText(stage));
    return (Number.isFinite(days) && days > 0) ? days : null;
  });

  const knownDurations = durationValues.filter(v => v !== null).sort((a, b) => a - b);
  let fallbackDuration = 14;
  if (knownDurations.length) {
    const mid = Math.floor(knownDurations.length / 2);
    fallbackDuration = knownDurations.length % 2
      ? knownDurations[mid]
      : (knownDurations[mid - 1] + knownDurations[mid]) / 2;
  }

  const durationWeights = durationValues.map(v => v ?? fallbackDuration);

  const totalDuration = durationWeights.reduce((sum, v) => sum + v, 0) || 1;
  const gapDeg = n > 2 ? 1.6 : 0.9;
  let cursorDeg = -90;
  const pieSlices = [];

  durationWeights.forEach((weight, i) => {
    const sweepDeg = (weight / totalDuration) * 360;
    const visibleSweep = Math.max(2.8, sweepDeg - gapDeg);
    const startDeg = cursorDeg + (gapDeg / 2);
    const endDeg = startDeg + visibleSweep;

    pieSlices.push({
      stageNum: i + 1,
      startDeg,
      endDeg,
      sweepDeg: visibleSweep,
      color: heatColor(i, n)
    });
    cursorDeg += sweepDeg;
  });

  pieSlices.forEach((slice) => {
    const wedge = document.createElementNS(SVG_NS, "path");
    wedge.setAttribute("d", donutSlicePath(centerX, centerY, durationPieOuterR, durationPieInnerR, slice.startDeg, slice.endDeg));
    wedge.setAttribute("fill", slice.color);
    wedge.setAttribute("opacity", "0.94");
    wedge.setAttribute("stroke", "#ffffff");
    wedge.setAttribute("stroke-width", 2);

    const durationText = getStageDurationText(stages[slice.stageNum - 1]) || "Duration unavailable";
    const tip = document.createElementNS(SVG_NS, "title");
    tip.textContent = `Stage ${slice.stageNum}: ${durationText}`;
    wedge.appendChild(tip);

    svg.appendChild(wedge);

    if (slice.sweepDeg >= 12) {
      const midDeg = (slice.startDeg + slice.endDeg) / 2;
      const labelPoint = toArcPoint(centerX, centerY, (durationPieOuterR + durationPieInnerR) / 2, midDeg);
      const pieLabel = document.createElementNS(SVG_NS, "text");
      pieLabel.setAttribute("x", labelPoint.x);
      pieLabel.setAttribute("y", labelPoint.y + 4);
      pieLabel.setAttribute("text-anchor", "middle");
      pieLabel.setAttribute("font-size", 10);
      pieLabel.setAttribute("font-weight", "bold");
      pieLabel.setAttribute("fill", "#ffffff");
      pieLabel.textContent = `${slice.stageNum}`;
      svg.appendChild(pieLabel);
    }
  });

  const core = document.createElementNS(SVG_NS, "circle");
  core.setAttribute("cx", centerX);
  core.setAttribute("cy", centerY);
  core.setAttribute("r", 56);
  core.setAttribute("fill", "#ffffff");
  core.setAttribute("stroke", "#cbd5e1");
  core.setAttribute("stroke-width", 1.5);
  svg.appendChild(core);

  const lifespanText = getSpeciesLifespanText(data) || "Not provided";

  const coreLabel = document.createElementNS(SVG_NS, "text");
  coreLabel.setAttribute("x", centerX);
  coreLabel.setAttribute("y", centerY - 12);
  coreLabel.setAttribute("text-anchor", "middle");
  coreLabel.setAttribute("font-size", 11);
  coreLabel.setAttribute("font-weight", "bold");
  coreLabel.setAttribute("fill", "#0f172a");
  coreLabel.textContent = "Lifespan";
  svg.appendChild(coreLabel);

  addWrappedTextLines({
    svg,
    parentG: svg,
    text: lifespanText,
    x: centerX - 38,
    y: centerY + 4,
    maxWidthPx: 76,
    fontSize: 10,
    lineHeight: 10.5,
    maxLines: 3,
    fill: "#334155",
    fontWeight: "bold"
  });

  let maxCardBottom = centerY + outerR;

  stages.forEach((stage, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI / n);
    const nodeX = centerX + Math.cos(angle) * nodeOrbitR;
    const nodeY = centerY + Math.sin(angle) * nodeOrbitR;
    const color = heatColor(i, n);

    const spoke = document.createElementNS(SVG_NS, "line");
    spoke.setAttribute("x1", centerX + Math.cos(angle) * 120);
    spoke.setAttribute("y1", centerY + Math.sin(angle) * 120);
    spoke.setAttribute("x2", nodeX);
    spoke.setAttribute("y2", nodeY);
    spoke.setAttribute("stroke", "#cbd5e1");
    spoke.setAttribute("stroke-width", 1.2);
    svg.appendChild(spoke);

    const node = document.createElementNS(SVG_NS, "circle");
    node.setAttribute("cx", nodeX);
    node.setAttribute("cy", nodeY);
    node.setAttribute("r", 16);
    node.setAttribute("fill", color);
    node.setAttribute("stroke", "#ffffff");
    node.setAttribute("stroke-width", 3);
    svg.appendChild(node);

    const nodeLabel = document.createElementNS(SVG_NS, "text");
    nodeLabel.setAttribute("x", nodeX);
    nodeLabel.setAttribute("y", nodeY + 4);
    nodeLabel.setAttribute("text-anchor", "middle");
    nodeLabel.setAttribute("font-size", 11);
    nodeLabel.setAttribute("font-weight", "bold");
    nodeLabel.setAttribute("fill", "#ffffff");
    nodeLabel.textContent = `${i + 1}`;
    svg.appendChild(nodeLabel);

    const rawCardX = centerX + Math.cos(angle) * cardOrbitR - cardW / 2;
    const cardH = estimatedCardHeights[i];
    const rawCardY = centerY + Math.sin(angle) * cardOrbitR - cardH / 2;
    const cardX = clamp(rawCardX, 20, width - cardW - 20);
    const cardY = rawCardY;

    const anchorX = clamp(nodeX, cardX, cardX + cardW);
    const anchorY = clamp(nodeY, cardY, cardY + cardH);

    const connector = document.createElementNS(SVG_NS, "line");
    connector.setAttribute("x1", nodeX);
    connector.setAttribute("y1", nodeY);
    connector.setAttribute("x2", anchorX);
    connector.setAttribute("y2", anchorY);
    connector.setAttribute("stroke", color);
    connector.setAttribute("stroke-width", 1.6);
    connector.setAttribute("opacity", 0.8);
    svg.appendChild(connector);

    const card = document.createElementNS(SVG_NS, "rect");
    card.setAttribute("x", cardX);
    card.setAttribute("y", cardY);
    card.setAttribute("width", cardW);
    card.setAttribute("height", cardH);
    card.setAttribute("rx", 12);
    card.setAttribute("fill", "#ffffff");
    card.setAttribute("stroke", "#cbd5e1");
    card.setAttribute("stroke-width", 1.2);
    svg.appendChild(card);

    const cardHead = document.createElementNS(SVG_NS, "rect");
    cardHead.setAttribute("x", cardX);
    cardHead.setAttribute("y", cardY);
    cardHead.setAttribute("width", cardW);
    cardHead.setAttribute("height", 34);
    cardHead.setAttribute("rx", 12);
    cardHead.setAttribute("fill", color);
    svg.appendChild(cardHead);

    const headerClipId = `circular-card-head-${i}`;
    const bodyClipId = `circular-card-body-${i}`;
    const headerClip = makeClipPathRect(svg, headerClipId, cardX + 8, cardY + 4, cardW - 16, 26, 8);
    const bodyClip = makeClipPathRect(svg, bodyClipId, cardX + 8, cardY + 38, cardW - 16, cardH - 48, 8);

    const headerTextGroup = document.createElementNS(SVG_NS, "g");
    headerTextGroup.setAttribute("clip-path", headerClip);
    svg.appendChild(headerTextGroup);

    const bodyTextGroup = document.createElementNS(SVG_NS, "g");
    bodyTextGroup.setAttribute("clip-path", bodyClip);
    svg.appendChild(bodyTextGroup);

    addWrappedTextLines({
      svg,
      parentG: headerTextGroup,
      text: stage.title || `Stage ${i + 1}`,
      x: cardX + 10,
      y: cardY + 18,
      maxWidthPx: cardW - 18,
      fontSize: 12,
      lineHeight: 12,
      maxLines: 2,
      fill: "#ffffff",
      fontWeight: "bold"
    });

    let infoY = cardY + 48;

    const durationText = getStageDurationText(stage);
    if (durationText) {
      const used = addWrappedTextLines({
        svg,
        parentG: bodyTextGroup,
        text: `Duration: ${durationText}`,
        x: cardX + 10,
        y: infoY,
        maxWidthPx: cardW - 18,
        fontSize: 10.5,
        lineHeight: 12,
        maxLines: 2,
        fill: color,
        fontWeight: "bold"
      });
      infoY += Math.max(13, used);
    }

    const detailBullets = getStageSummaryBullets(stage, bulletLimit);

    addWrappedBullets({
      svg,
      parentG: bodyTextGroup,
      x: cardX + 10,
      y: infoY - 12,
      maxWidthPx: cardW - 18,
      bullets: detailBullets,
      maxHeight: Math.max(0, (cardY + cardH) - infoY - 10),
      fontSize: 10,
      lineHeight: 12
    });

    maxCardBottom = Math.max(maxCardBottom, cardY + cardH);
  });

  const height = Math.max(centerY + outerR + 120, maxCardBottom + 70);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("height", height);

  const scaler = document.getElementById("svgScaler");
  scaler.appendChild(svg);
}
function getSelectedTemplate() {
  return document.getElementById("templateSelect")?.value || "timeline";
}

function renderSelectedTemplate(data) {
  clearContainer();

  if (!data || !data.stages || data.stages.length === 0) {
    showStatus("No stages found. Check your data or upload another file.");
    return;
  }

  const template = getSelectedTemplate();
  if (template === "circular") {
    renderCircular(data);
  } else {
    renderTimeline(data);
  }

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
    renderSelectedTemplate(speciesToRenderData(sp));
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
        renderSelectedTemplate(speciesToRenderData(sp));
        return;
      }

      sp.stages = data.stages || sp.stages;
      if (data.title) sp.title = data.title;
      sp.aiEnhanced = true;

      const toRender = speciesToRenderData(sp);
      renderSelectedTemplate(toRender);

      const jsonOut = { title: toRender.title, stages: toRender.stages };
      const jsonInput = document.getElementById("jsonInput");
      if (jsonInput) jsonInput.value = JSON.stringify(jsonOut, null, 2);
    })
    .catch(err => {
      console.error("AI enhancement failed:", err);
      showStatus("AI enhancement failed – showing original layout.");
      renderSelectedTemplate(speciesToRenderData(sp));
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
document.getElementById("templateSelect")?.addEventListener("change", () => {
  if (!fullDataset) return;
  const sp = getCurrentSpeciesObj();
  if (!sp) return;
  renderSelectedTemplate(speciesToRenderData(sp));
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

function applyUploadedDataset(data) {
  fullDataset = normalizeDataset(data);
  populateSpeciesSelect(fullDataset);
  const sp = getCurrentSpeciesObj();
  if (sp) renderSelectedTemplate(speciesToRenderData(sp));

  const jsonInput = document.getElementById("jsonInput");
  if (jsonInput) jsonInput.value = JSON.stringify(data, null, 2);
}

document.getElementById("uploadExcelMultiBtn")?.addEventListener("click", () => {
  const excelFiles = Array.from(document.getElementById("excelMultiInput")?.files || []);
  if (!excelFiles.length) return alert("Choose one or more Excel (.xlsx) worksheets first.");

  const formData = new FormData();
  excelFiles.forEach(file => formData.append("files", file));

  fetch("/upload_excel_multi", { method: "POST", body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.error) return alert("Error: " + data.error);
      applyUploadedDataset(data);
    })
    .catch(err => alert("Upload failed: " + err));
});

document.getElementById("uploadExcelSingleBtn")?.addEventListener("click", () => {
  const excelFile = document.getElementById("excelSingleInput")?.files?.[0];
  if (!excelFile) return alert("Choose an Excel (.xlsx) worksheet first.");

  const formData = new FormData();
  formData.append("file", excelFile);

  fetch("/upload_excel_single", { method: "POST", body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.error) return alert("Error: " + data.error);
      applyUploadedDataset(data);
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

























