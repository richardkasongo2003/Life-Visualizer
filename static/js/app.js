// ==============================
// LifeViz - app.js (TIMELINE ONLY, SERIOUS CLEAN LAYOUT)
// What’s fixed (based on your screenshot + sketch):
// ✅ Month-span bubbles are ANCHORED at the earliest expected month (left edge fixed)
// ✅ If month-span bubbles overlap, they STACK into rows (no horizontal shoving)
// ✅ Card connectors originate from the bubble’s anchor (not seg midline) → no spaghetti
// ✅ Cards never overlap: adaptive lane spacing if the lane can’t fit full min distance
// ✅ Expand/Collapse REMOVED entirely (no button, no click toggle, no expanded state)
// ✅ Keeps your NO-TEXT-LEAK clipPath wrapping + improved bullet wrapping
// ==============================

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
  return getBulletValue(stage, ["timing:", "seasonal timing:", "date range:", "range:"]);
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

// =========================
// RENDERER: Timeline
// =========================
function renderTimeline(data) {
  const stages = data.stages || [];
  const n = stages.length;
  if (!n) return;

  const leftPad = 90;
  const rightPad = 90;

  const headerH = 26;
  const cardW = 380;
  const chipsRowH = 30;
  const sourcesFooterH = 22;

  const cardGap = 44;
  const cardMinDistTarget = cardW + cardGap;

  // Month-span bubbles
  const spanBubbleH = 26;
  const spanBubbleGap = 14;
  const spanRowGap = 10;

  const hasSubtitle = !!data.speciesName;
  const TITLE_TOP = 12;
  const TITLE_H = hasSubtitle ? 90 : 64;
  const TITLE_BOTTOM = TITLE_TOP + TITLE_H;

  const durationTexts = stages.map(s => getStageDurationText(s));
  const days = durationTexts.map(t => durationToDays(t));
  const weights = days.map(v => (typeof v === "number" && isFinite(v) && v > 0) ? v : 1);
  const total = weights.reduce((a, b) => a + b, 0);

  const topCount = Math.ceil(n / 2);
  const minUsableForCards = (topCount <= 1) ? 0 : (topCount - 1) * cardMinDistTarget;

  const minSegmentPx = 140;
  const minUsableForSegments = n * minSegmentPx;

  const baseWidth = 1500;
  const extraWidth = Math.max(0, n - 6) * 300;

  const usableW = Math.max(
    (baseWidth + extraWidth) - leftPad - rightPad,
    minUsableForCards,
    minUsableForSegments
  );

  const width = usableW + leftPad + rightPad;

  const svg = createSVG(width, 1200);
  const defs = ensureDefs(svg);

  // shadow
  const cardShadow = document.createElementNS(SVG_NS, "filter");
  cardShadow.setAttribute("id", "cardShadowTimeline");
  cardShadow.setAttribute("x", "-20%");
  cardShadow.setAttribute("y", "-20%");
  cardShadow.setAttribute("width", "140%");
  cardShadow.setAttribute("height", "140%");
  const feDrop = document.createElementNS(SVG_NS, "feDropShadow");
  feDrop.setAttribute("dx", "0");
  feDrop.setAttribute("dy", "2");
  feDrop.setAttribute("stdDeviation", "2");
  feDrop.setAttribute("flood-color", "#000000");
  feDrop.setAttribute("flood-opacity", "0.14");
  cardShadow.appendChild(feDrop);
  defs.appendChild(cardShadow);

  // Title
  const title = document.createElementNS(SVG_NS, "text");
  title.setAttribute("x", width / 2);
  title.setAttribute("y", 42);
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("font-size", 22);
  title.setAttribute("font-weight", "850");
  title.setAttribute("fill", "#0f172a");
  title.textContent = data.title || "Life history timeline";
  svg.appendChild(title);

  if (data.speciesName) {
    const subtitle = document.createElementNS(SVG_NS, "text");
    subtitle.setAttribute("x", width / 2);
    subtitle.setAttribute("y", 66);
    subtitle.setAttribute("text-anchor", "middle");
    subtitle.setAttribute("font-size", 13);
    subtitle.setAttribute("fill", "#475569");
    subtitle.textContent = data.speciesName;
    svg.appendChild(subtitle);
  }

  // Segments
  const segments = [];
  let cursor = leftPad;

  for (let i = 0; i < n; i++) {
    const segW = usableW * (weights[i] / total);
    const durationLabel = getStageDurationText(stages[i]);
    const rangeLabel = getStageRangeText(stages[i]);

    let yearsLabel = "";
    const d = durationToDays(durationLabel);
    if (typeof d === "number" && isFinite(d) && d >= 365) {
      const yrs = d / 365;
      yearsLabel = `~${(yrs >= 10 ? Math.round(yrs) : Math.round(yrs * 10) / 10)} yrs`;
    } else if ((durationLabel || "").toLowerCase().includes("year")) {
      yearsLabel = "years";
    }

    segments.push({
      i,
      x: cursor,
      w: segW,
      cx: cursor + segW / 2,
      durationLabel,
      rangeLabel,
      months: parseMonthRange(rangeLabel),
      sources: getStageSources(stages[i]),
      milestones: getStageMilestones(stages[i]),
      chips: extractKeyFacts(stages[i]),
      yearsLabel
    });

    cursor += segW;
  }

  // Card heights (based on wrapping)
  const speciesKey = data.speciesName || "Species";
  const bulletFont = 11.4;
  const bulletLine = 14.5;
  const bulletMaxW = (cardW - 24) - 6;

  const cardHeights = segments.map(seg => {
    const s = stages[seg.i];

    const bullets = pickBullets(s.bullets || [], MAX_BULLETS).filter(b => {
      const bl = String(b).toLowerCase();
      if (bl.startsWith("sources:") || bl.startsWith("source:")) return false;
      if (bl.startsWith("milestone:")) return false;
      return true;
    });

    const bulletH = estimateBulletHeight({
      svg,
      maxWidthPx: bulletMaxW,
      bullets,
      fontSize: bulletFont,
      lineHeight: bulletLine
    });

    const hasSources = seg.sources && seg.sources.length;
    const paddingTop = 8 + chipsRowH;
    const paddingBottom = 14;
    const footer = hasSources ? (sourcesFooterH + 10) : 0;

    const minCard = 190;
    return Math.max(minCard, headerH + paddingTop + bulletH + paddingBottom + footer);
  });

  const topIdx = segments.map(seg => seg.i).filter(i => i % 2 === 0);
  const botIdx = segments.map(seg => seg.i).filter(i => i % 2 === 1);

  const topMaxH = topIdx.length ? Math.max(...topIdx.map(i => cardHeights[i])) : 220;
  const botMaxH = botIdx.length ? Math.max(...botIdx.map(i => cardHeights[i])) : 220;

  const topCardYBase = TITLE_BOTTOM + 26;
  const midY = topCardYBase + topMaxH + 120;
  const bottomCardYBase = midY + 150;

  // Road background
  const roadBg = document.createElementNS(SVG_NS, "rect");
  roadBg.setAttribute("x", leftPad);
  roadBg.setAttribute("y", midY - 12);
  roadBg.setAttribute("width", usableW);
  roadBg.setAttribute("height", 24);
  roadBg.setAttribute("rx", 12);
  roadBg.setAttribute("fill", "#e2e8f0");
  roadBg.setAttribute("opacity", "0.85");
  svg.appendChild(roadBg);

  // Segments + labels
  segments.forEach(seg => {
    const color = heatColor(seg.i, n);

    const segRect = document.createElementNS(SVG_NS, "rect");
    segRect.setAttribute("x", seg.x);
    segRect.setAttribute("y", midY - 12);
    segRect.setAttribute("width", Math.max(10, seg.w));
    segRect.setAttribute("height", 24);
    segRect.setAttribute("rx", 12);
    segRect.setAttribute("fill", color);
    svg.appendChild(segRect);

    if (seg.durationLabel && seg.w >= 140) {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", seg.cx);
      label.setAttribute("y", midY + 7);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", 12);
      label.setAttribute("font-weight", 900);
      label.setAttribute("fill", "#0b1220");
      label.textContent = seg.durationLabel;
      svg.appendChild(label);
    }

    if (seg.yearsLabel) {
      const yl = document.createElementNS(SVG_NS, "text");
      yl.setAttribute("x", seg.cx);
      yl.setAttribute("y", midY - 18);
      yl.setAttribute("text-anchor", "middle");
      yl.setAttribute("font-size", 11);
      yl.setAttribute("font-weight", 900);
      yl.setAttribute("fill", "#0f172a");
      yl.setAttribute("opacity", "0.9");
      yl.textContent = seg.yearsLabel;
      svg.appendChild(yl);
    }
  });

  // Months band
  const monthsY = midY + 32;
  const monthBandH = 24;
  const monthBand = document.createElementNS(SVG_NS, "g");

  const bandBg = document.createElementNS(SVG_NS, "rect");
  bandBg.setAttribute("x", leftPad);
  bandBg.setAttribute("y", monthsY);
  bandBg.setAttribute("width", usableW);
  bandBg.setAttribute("height", monthBandH);
  bandBg.setAttribute("rx", 10);
  bandBg.setAttribute("fill", "#f8fafc");
  bandBg.setAttribute("stroke", "#e2e8f0");
  bandBg.setAttribute("stroke-width", 1);
  monthBand.appendChild(bandBg);

  const monthW = usableW / 12;
  for (let m = 0; m < 12; m++) {
    const x = leftPad + m * monthW;

    const tick = document.createElementNS(SVG_NS, "line");
    tick.setAttribute("x1", x);
    tick.setAttribute("x2", x);
    tick.setAttribute("y1", monthsY);
    tick.setAttribute("y2", monthsY + monthBandH);
    tick.setAttribute("stroke", "#e2e8f0");
    tick.setAttribute("stroke-width", 1);
    monthBand.appendChild(tick);

    const lab = document.createElementNS(SVG_NS, "text");
    lab.setAttribute("x", x + monthW / 2);
    lab.setAttribute("y", monthsY + 16);
    lab.setAttribute("text-anchor", "middle");
    lab.setAttribute("font-size", 11);
    lab.setAttribute("font-weight", 800);
    lab.setAttribute("fill", "#334155");
    lab.textContent = MONTHS[m].name;
    monthBand.appendChild(lab);
  }

  // subtle spans behind month band
  segments.forEach(seg => {
    if (!seg.months) return;
    const { start, end, wraps } = seg.months;

    const drawSpan = (s, e) => {
      const x = leftPad + s * monthW;
      const w = (e - s + 1) * monthW;

      const span = document.createElementNS(SVG_NS, "rect");
      span.setAttribute("x", x);
      span.setAttribute("y", monthsY);
      span.setAttribute("width", w);
      span.setAttribute("height", monthBandH);
      span.setAttribute("rx", 10);
      span.setAttribute("fill", heatColor(seg.i, n));
      span.setAttribute("opacity", "0.18");
      monthBand.appendChild(span);
    };

    if (!wraps) drawSpan(start, end);
    else { drawSpan(start, 11); drawSpan(0, end); }
  });

  svg.appendChild(monthBand);

  // =========================
  // Month-span bubbles (clean + serious)
  // - anchored to earliest month
  // - overlaps stack into rows (no moving)
  // - record a PRIMARY anchor (earliest-start bubble) per stage for card connectors
  // =========================
  const spanMinX = leftPad;
  const spanMaxX = leftPad + usableW;

  const spanItemsTop = [];
  const spanItemsBot = [];

  // stagePrimarySpan.get(stageIndex) -> { itemId, startM, lane, cx, row }
  const stagePrimarySpan = new Map();

  const addSpanItem = (stageIndex, startM, endM, suffix) => {
    const w = (endM - startM + 1) * monthW;
    const desiredX = leftPad + startM * monthW;

    const item = {
      id: `${stageIndex}${suffix || ""}`,
      stageIndex,
      desiredX,
      w,
      startM,
      endM,
      suffix: suffix || ""
    };

    if (stageIndex % 2 === 0) spanItemsTop.push(item);
    else spanItemsBot.push(item);

    const existing = stagePrimarySpan.get(stageIndex);
    if (!existing || startM < existing.startM) {
      stagePrimarySpan.set(stageIndex, { itemId: item.id, startM });
    }
  };

  segments.forEach(seg => {
    if (!seg.months) return;
    const { start, end, wraps } = seg.months;

    if (!wraps) {
      addSpanItem(seg.i, start, end, "");
    } else {
      // split across year boundary
      addSpanItem(seg.i, start, 11, "_a"); // earliest part
      addSpanItem(seg.i, 0, end, "_b");
    }
  });

  const placedTop = spanItemsTop.length
    ? assignRowsFixedX(spanItemsTop, spanBubbleGap, spanMinX, spanMaxX)
    : { placed: [], rowCount: 0 };

  const placedBot = spanItemsBot.length
    ? assignRowsFixedX(spanItemsBot, spanBubbleGap, spanMinX, spanMaxX)
    : { placed: [], rowCount: 0 };

  const spanTopBaseY = monthsY - (spanBubbleH + 14);
  const spanBotBaseY = monthsY + monthBandH + 18;

  const drawSpanBubble = (placement, lane) => {
    const item = placement.item;
    const x = placement.x;
    const row = placement.row;

    const y = lane === "top"
      ? (spanTopBaseY - row * (spanBubbleH + spanRowGap))
      : (spanBotBaseY + row * (spanBubbleH + spanRowGap));

    const color = heatColor(item.stageIndex, n);
    const w = item.w;
    const cx = x + w / 2;

    const bandEdgeY = lane === "top" ? monthsY : (monthsY + monthBandH);

    // connector from bubble center to month band edge (short + clean)
    const tick = document.createElementNS(SVG_NS, "line");
    tick.setAttribute("x1", cx);
    tick.setAttribute("x2", cx);
    tick.setAttribute("y1", lane === "top" ? (y + spanBubbleH) : y);
    tick.setAttribute("y2", bandEdgeY);
    tick.setAttribute("stroke", color);
    tick.setAttribute("stroke-width", 2.2);
    tick.setAttribute("opacity", "0.65");
    svg.appendChild(tick);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", w);
    rect.setAttribute("height", spanBubbleH);
    rect.setAttribute("rx", 13);
    rect.setAttribute("fill", "#ffffff");
    rect.setAttribute("stroke", color);
    rect.setAttribute("stroke-width", 2);
    rect.setAttribute("filter", "url(#cardShadowTimeline)");
    svg.appendChild(rect);

    const stageTitle = safeText(stages[item.stageIndex]?.title || "");
    const label = w < 110 ? shorten(stageTitle, 10) : (w < 160 ? shorten(stageTitle, 16) : shorten(stageTitle, 28));

    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", cx);
    t.setAttribute("y", y + 17);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", 11.2);
    t.setAttribute("font-weight", 900);
    t.setAttribute("fill", "#0f172a");
    t.textContent = label;
    svg.appendChild(t);

    // record primary anchor for card connectors
    const primary = stagePrimarySpan.get(item.stageIndex);
    if (primary && primary.itemId === item.id) {
      stagePrimarySpan.set(item.stageIndex, {
        ...primary,
        lane,
        cx,
        row
      });
    }
  };

  placedTop.placed.forEach(p => drawSpanBubble(p, "top"));
  placedBot.placed.forEach(p => drawSpanBubble(p, "bottom"));

  // shift cards down/up if bubble stacks are deep so visuals don’t crash
  const extraTopBubbleSpace = placedTop.rowCount > 1 ? (placedTop.rowCount - 1) * (spanBubbleH + spanRowGap) : 0;
  const extraBotBubbleSpace = placedBot.rowCount > 1 ? (placedBot.rowCount - 1) * (spanBubbleH + spanRowGap) : 0;

  const topCardY = topCardYBase + extraTopBubbleSpace;
  const bottomCardY = bottomCardYBase + extraBotBubbleSpace;

  // =========================
  // Cards (never overlap): adaptive lane spacing
  // =========================
  const minCardCx = leftPad + cardW / 2;
  const maxCardCx = leftPad + usableW - cardW / 2;

  const topSegs = segments.filter(seg => seg.i % 2 === 0).map(seg => ({ id: seg.i, desiredCx: seg.cx }));
  const botSegs = segments.filter(seg => seg.i % 2 === 1).map(seg => ({ id: seg.i, desiredCx: seg.cx }));

  function laneMinDist(count) {
    if (count <= 1) return cardMinDistTarget;
    const laneW = (maxCardCx - minCardCx);
    const maxPossible = laneW / (count - 1);
    return Math.min(cardMinDistTarget, Math.max(60, maxPossible));
  }

  const topCxMap = topSegs.length
    ? distributeCenters(topSegs, laneMinDist(topSegs.length), minCardCx, maxCardCx)
    : new Map();

  const botCxMap = botSegs.length
    ? distributeCenters(botSegs, laneMinDist(botSegs.length), minCardCx, maxCardCx)
    : new Map();

  // =========================
  // Draw cards + connectors
  // Connector starts at the PRIMARY bubble anchor for that stage (clean!)
  // =========================
  segments.forEach(seg => {
    const s = stages[seg.i];
    const isTop = seg.i % 2 === 0;
    const color = heatColor(seg.i, n);

    const cardCenterX = isTop ? (topCxMap.get(seg.i) ?? seg.cx) : (botCxMap.get(seg.i) ?? seg.cx);
    const cardX = cardCenterX - cardW / 2;
    const cardY = isTop ? topCardY : bottomCardY;
    const cardH = cardHeights[seg.i];

    // card connector anchor: bubble center (earliest month) → month band edge
    const primary = stagePrimarySpan.get(seg.i);
    let anchorX = seg.cx;
    let anchorY = midY;

    if (primary && typeof primary.cx === "number") {
      anchorX = primary.cx;
      anchorY = (primary.lane === "top") ? monthsY : (monthsY + monthBandH);
    }

    const connector = document.createElementNS(SVG_NS, "path");
    const endY = isTop ? (cardY + cardH) : cardY;
    const dx = cardCenterX - anchorX;

    const c1x = anchorX + (dx * 0.30);
    const c2x = cardCenterX - (dx * 0.20);
    const c1y = isTop ? (anchorY - 26) : (anchorY + 26);
    const c2y = isTop ? (endY + 34) : (endY - 34);

    connector.setAttribute(
      "d",
      `M ${anchorX} ${anchorY}
       C ${c1x} ${c1y} ${c2x} ${c2y} ${cardCenterX} ${endY}`
    );
    connector.setAttribute("stroke", color);
    connector.setAttribute("stroke-width", 3);
    connector.setAttribute("fill", "none");
    connector.setAttribute("opacity", "0.75");
    connector.setAttribute("stroke-linecap", "round");
    svg.appendChild(connector);

    const cardG = document.createElementNS(SVG_NS, "g");

    const card = document.createElementNS(SVG_NS, "rect");
    card.setAttribute("x", cardX);
    card.setAttribute("y", cardY);
    card.setAttribute("width", cardW);
    card.setAttribute("height", cardH);
    card.setAttribute("rx", 14);
    card.setAttribute("fill", "#ffffff");
    card.setAttribute("stroke", "#e2e8f0");
    card.setAttribute("stroke-width", 1);
    card.setAttribute("filter", "url(#cardShadowTimeline)");
    cardG.appendChild(card);

    const header = document.createElementNS(SVG_NS, "rect");
    header.setAttribute("x", cardX);
    header.setAttribute("y", cardY);
    header.setAttribute("width", cardW);
    header.setAttribute("height", headerH);
    header.setAttribute("rx", 14);
    header.setAttribute("fill", color);
    cardG.appendChild(header);

    const titleText = document.createElementNS(SVG_NS, "text");
    titleText.setAttribute("x", cardX + 12);
    titleText.setAttribute("y", cardY + 18);
    titleText.setAttribute("font-size", 12.6);
    titleText.setAttribute("font-weight", 900);
    titleText.setAttribute("fill", "#ffffff");
    titleText.textContent = `${seg.i + 1}. ${safeText(s.title)}`;
    cardG.appendChild(titleText);

    // Chips
    const chipsY = cardY + headerH + 8;
    let chipX = cardX + 12;
    const chipMaxX = cardX + cardW - 10;

    (seg.chips || []).forEach(ch => {
      const chipText = `${ch.icon} ${ch.label}`;
      const chipW = Math.min(150, 18 + chipText.length * 6.2);
      if (chipX + chipW > chipMaxX) return;

      const chip = document.createElementNS(SVG_NS, "rect");
      chip.setAttribute("x", chipX);
      chip.setAttribute("y", chipsY);
      chip.setAttribute("width", chipW);
      chip.setAttribute("height", 22);
      chip.setAttribute("rx", 11);
      chip.setAttribute("fill", "#f1f5f9");
      chip.setAttribute("stroke", "#e2e8f0");
      chip.setAttribute("stroke-width", 1);
      cardG.appendChild(chip);

      const chipT = document.createElementNS(SVG_NS, "text");
      chipT.setAttribute("x", chipX + 10);
      chipT.setAttribute("y", chipsY + 15);
      chipT.setAttribute("font-size", 11);
      chipT.setAttribute("font-weight", 850);
      chipT.setAttribute("fill", "#0f172a");
      chipT.textContent = chipText;
      cardG.appendChild(chipT);

      chipX += chipW + 8;
    });

    const bullets = pickBullets(s.bullets || [], MAX_BULLETS).filter(b => {
      const bl = String(b).toLowerCase();
      if (bl.startsWith("sources:") || bl.startsWith("source:")) return false;
      if (bl.startsWith("milestone:")) return false;
      return true;
    });

    const bulletAreaX = cardX + 12;
    const bulletAreaY = chipsY + chipsRowH;
    const bulletAreaW = cardW - 24;

    const clipId = `clip_${speciesKey.replace(/\s+/g, "_")}_${seg.i}`;
    const clipUrl = makeClipPathRect(
      svg,
      clipId,
      cardX + 10,
      cardY + headerH + 6,
      cardW - 20,
      cardH - headerH - 12,
      10
    );

    const bulletsG = document.createElementNS(SVG_NS, "g");
    bulletsG.setAttribute("clip-path", clipUrl);
    cardG.appendChild(bulletsG);

    addWrappedBullets({
      svg,
      parentG: bulletsG,
      x: bulletAreaX + 2,
      y: bulletAreaY,
      maxWidthPx: bulletAreaW - 6,
      bullets,
      fontSize: bulletFont,
      lineHeight: bulletLine
    });

    // Sources footer (wrapped)
    const hasSources = seg.sources && seg.sources.length;
    if (hasSources) {
      const footerY = cardY + cardH - sourcesFooterH - 10;

      const divider = document.createElementNS(SVG_NS, "line");
      divider.setAttribute("x1", cardX + 12);
      divider.setAttribute("x2", cardX + cardW - 12);
      divider.setAttribute("y1", footerY - 6);
      divider.setAttribute("y2", footerY - 6);
      divider.setAttribute("stroke", "#e2e8f0");
      divider.setAttribute("stroke-width", 1);
      cardG.appendChild(divider);

      const srcLabel = document.createElementNS(SVG_NS, "text");
      srcLabel.setAttribute("x", cardX + 12);
      srcLabel.setAttribute("y", footerY + 12);
      srcLabel.setAttribute("font-size", 10.7);
      srcLabel.setAttribute("font-weight", 900);
      srcLabel.setAttribute("fill", "#334155");
      srcLabel.textContent = "Sources:";
      cardG.appendChild(srcLabel);

      const srcLinesG = document.createElementNS(SVG_NS, "g");
      srcLinesG.setAttribute("clip-path", clipUrl);
      cardG.appendChild(srcLinesG);

      const srcText = seg.sources.join("; ");
      addWrappedBullets({
        svg,
        parentG: srcLinesG,
        x: cardX + 70,
        y: footerY - 10,
        maxWidthPx: (cardW - 82),
        bullets: [srcText],
        fontSize: 10.7,
        lineHeight: 12.8
      });
    }

    svg.appendChild(cardG);
  });

  const height = bottomCardY + botMaxH + 90;
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
