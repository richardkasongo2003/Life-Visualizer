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
  if (data?.lifespan) return safeText(data.lifespan);

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

  let linesCount = 0;

  for (const b of (bullets || [])) {
    const logicalLines = splitWordsIntoChunks(safeText(b), maxWordsPerLine);
    logicalLines.forEach((chunk, idx) => {
      const raw = `${idx === 0 ? "- " : ""}${chunk}`;
      const lines = splitToLinesByWidth(raw, measureFn, maxWidthPx);
      linesCount += lines.length;
    });
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
  if (reproduction) chips.push({ icon: "🥚", label: "Reproductive strategy", value: reproduction });
  if (traits) chips.push({ icon: "🧬", label: "Traits", value: traits });
  if (threats) chips.push({ icon: "⚠️", label: "Threats", value: threats });

  return chips.slice(0, 4);
}

function getStageResourceNeeds(stage) {
  const raw = getBulletValue(stage, ["resource needs:"]);
  if (!raw) return [];

  return raw
    .split(";")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const parts = item.split(":");
      if (parts.length < 2) {
        return { label: "Need", value: item };
      }
      return {
        label: parts.shift().trim(),
        value: parts.join(":").trim()
      };
    })
    .filter(item => item.value);
}

function getSpeciesResourceSummary(stages) {
  const resourceMap = new Map();

  (stages || []).forEach(stage => {
    getStageResourceNeeds(stage).forEach(item => {
      const key = `${item.label}::${item.value}`.toLowerCase();
      if (!resourceMap.has(key)) {
        resourceMap.set(key, {
          label: item.label,
          value: item.value,
          stages: []
        });
      }

      const entry = resourceMap.get(key);
      const stageTitle = stage.title || "Stage";
      if (!entry.stages.includes(stageTitle)) entry.stages.push(stageTitle);
    });
  });

  return [...resourceMap.values()];
}

function summarizeResourceStory(stages) {
  const buckets = new Map();

  (stages || []).forEach((stage, index) => {
    const group = inferLifeStageGroup(stage.title);
    const resources = getStageResourceNeeds(stage);
    if (!resources.length) return;

    if (!buckets.has(group)) {
      buckets.set(group, { group, labels: new Set(), stages: [] });
    }

    const bucket = buckets.get(group);
    resources.forEach(item => bucket.labels.add(item.label));
    bucket.stages.push(getStageHeadingText(stage, index));
  });

  return [...buckets.values()].map(bucket => ({
    group: bucket.group,
    message: `${bucket.group} depends mainly on ${[...bucket.labels].slice(0, 3).join(", ").toLowerCase()}.`,
    stages: bucket.stages
  }));
}

function getStageHeadingText(stage, index) {
  return stage?.title || `Stage ${index + 1}`;
}

function getStageDetailBullets(stage, stageCount, template = "circular") {
  const bulletLimit = Math.min(CARD_SUMMARY_BULLETS, getAdaptiveBulletLimit(template, stageCount));
  return getStageSummaryBullets(stage, Math.max(1, bulletLimit));
}

function getStageFocusSummary(stage) {
  const duration = getStageDurationText(stage);
  const timing = getStageRangeText(stage);
  const resources = getStageResourceNeeds(stage);
  const habitat = getBulletValue(stage, ["habitat:"]);
  const reproduction = getBulletValue(stage, ["reproduction:"]);
  const resourceFocus = getBulletValue(stage, ["resource focus:"]);

  return {
    duration,
    timing,
    habitat,
    reproduction,
    resources,
    resourceFocus
  };
}

function getAnnualWindowSummary(stages) {
  const mapped = (stages || []).map((stage, index) => {
    const timing = getStageRangeText(stage);
    const duration = getStageDurationText(stage);
    return {
      index,
      title: stage.title || `Stage ${index + 1}`,
      timing,
      duration
    };
  });

  return mapped.filter(item => item.timing || item.duration);
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

function inferLifeStageGroup(stageTitle) {
  const title = String(stageTitle || "").toLowerCase();

  if (/(egg|embryo|fertiliz|incubat|nest)/.test(title)) return "Early life";
  if (/(larva|chick|fledg|juvenile|young|immature)/.test(title)) return "Juvenile";
  if (/(adult|mature|breeding|reproduct)/.test(title)) return "Adult";

  return "Other";
}

function getLifeStageGroups(stages) {
  const groups = [];
  let current = null;

  stages.forEach((stage, i) => {
    const label = stage.lifeStageGroup || stage.group || inferLifeStageGroup(stage.title);
    if (!current || current.label !== label) {
      current = {
        label,
        startIndex: i,
        endIndex: i,
        color: heatColor(i, stages.length)
      };
      groups.push(current);
    } else {
      current.endIndex = i;
    }
  });

  return groups.filter(group => group.label && group.label !== "Other");
}

function isContainerStageTitle(title) {
  return /^(nest|brood|early life|egg mass|larval period|larval stage|juvenile period|juvenile stage|adult|adult stage|reproductive adult|breeding adult|breeding season|reproductive period|spawning period)$/i.test(String(title || "").trim());
}

function childBelongsToContainer(containerLabel, childTitle) {
  const label = String(containerLabel || "").toLowerCase();
  const title = String(childTitle || "").toLowerCase();

  if (label.includes("nest") || label.includes("brood")) {
    return /(egg|chick|nestling|hatch|incubat)/.test(title);
  }

  if (label.includes("early") || label.includes("egg mass")) {
    return /(egg|embryo|larva|larvae|chick|hatch|incubat|nestling)/.test(title);
  }

  if (label.includes("larval")) {
    return /(larva|larvae|alevin|fry|tadpole|metamorph)/.test(title);
  }

  if (label.includes("juvenile")) {
    return /(fledg|juvenile|young|immature|subadult|yearling|smolt|parr)/.test(title);
  }

  if (label.includes("adult") || label.includes("reproductive") || label.includes("breeding") || label.includes("spawning")) {
    return /(adult|mature|breeding|reproduct|spawn|mate|nest|incubat|brood|migrat|forag|roost|dispers|shelter)/.test(title);
  }

  return true;
}

function stageHasDrawableSubstance(stage) {
  return Boolean(getStageDurationText(stage) || getStageSummaryBullets(stage, 1).length);
}

function stageHasSpecificDetails(stage) {
  const bullets = Array.isArray(stage?.bullets) ? stage.bullets.map(String) : [];
  return bullets.some(b => !/^(duration|timing|seasonal timing|date range|range|lifespan|sources?)\s*:/i.test(b));
}

function cloneStageWithInheritedTiming(stage, containerStage) {
  const child = {
    ...stage,
    bullets: Array.isArray(stage.bullets) ? [...stage.bullets] : []
  };

  const childTiming = getStageRangeText(child);
  const containerTiming = getStageRangeText(containerStage);
  if (!childTiming && containerTiming) {
    child.bullets.push(`Timing: ${containerTiming}`);
  }

  return child;
}

function buildCircularStageModel(rawStages) {
  const displayStages = [];
  const containerGroups = [];
  let activeContainer = null;

  const closeActiveContainer = () => {
    if (activeContainer && activeContainer.startIndex !== null && activeContainer.endIndex !== null) {
      containerGroups.push({
        label: activeContainer.label,
        startIndex: activeContainer.startIndex,
        endIndex: activeContainer.endIndex,
        color: activeContainer.color
      });
    }
    activeContainer = null;
  };

  (rawStages || []).forEach((stage, sourceIndex) => {
    const title = stage.title || `Stage ${sourceIndex + 1}`;
    const isEmptyContainer = isContainerStageTitle(title) && !stageHasSpecificDetails(stage);
    const hasDrawableSubstance = stageHasDrawableSubstance(stage);

    if (isEmptyContainer) {
      closeActiveContainer();
      activeContainer = {
        label: title,
        sourceStage: stage,
        startIndex: null,
        endIndex: null,
        color: heatColor(sourceIndex, rawStages.length || 1)
      };
      return;
    }

    if (!hasDrawableSubstance) {
      return;
    }

    if (activeContainer && !childBelongsToContainer(activeContainer.label, title)) {
      closeActiveContainer();
    }

    const displayStage = activeContainer
      ? cloneStageWithInheritedTiming(stage, activeContainer.sourceStage)
      : stage;

    displayStages.push(displayStage);

    if (activeContainer) {
      const displayIndex = displayStages.length - 1;
      if (activeContainer.startIndex === null) activeContainer.startIndex = displayIndex;
      activeContainer.endIndex = displayIndex;
    }
  });

  closeActiveContainer();

  return {
    stages: displayStages.length ? displayStages : rawStages,
    groups: containerGroups
  };
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

function getAdultRemainderStageIndex(stages) {
  const scored = (stages || []).map((stage, index) => {
    const title = String(stage?.title || "").toLowerCase();
    let score = 0;

    if (/\badult\b/.test(title)) score += 100;
    if (/reproductive\s*adult|breeding\s*adult|adult\s*stage/.test(title)) score += 40;
    if (/\bmature\b/.test(title)) score += 25;
    if (/\breproduct/.test(title)) score += 20;
    if (/\bbreeding\b/.test(title)) score += 10;
    if (/\bspawning\b/.test(title)) score += 4;
    if (/\bburrow\b|\bforaging\b|\broosting\b|\bmigration\b/.test(title)) score -= 8;

    return { index, score };
  });

  const best = scored.reduce((top, current) => {
    if (!top || current.score > top.score) return current;
    return top;
  }, null);

  return best && best.score > 0 ? best.index : -1;
}

function calculatePieDurationWeights(stages, lifespanText) {
  const YEAR_DAYS = 365;
  const MIN_VISIBLE_SHARE = 0.055;
  const READABILITY_EXPONENT = 0.58;

  function getMonthSpanDays(stage) {
    const rangeText = getStageRangeText(stage);
    const monthRange = parseMonthRange(rangeText);
    if (!monthRange || monthRange.start === null || monthRange.end === null) return null;

    const monthCount = monthRange.wraps
      ? (12 - monthRange.start) + (monthRange.end + 1)
      : (monthRange.end - monthRange.start + 1);

    return Math.max(1, monthCount) * (YEAR_DAYS / 12);
  }

  function getAnnualPresenceDays(stage) {
    const durationDays = durationToDays(getStageDurationText(stage));
    const monthSpanDays = getMonthSpanDays(stage);

    if (durationDays && monthSpanDays) return Math.min(durationDays, monthSpanDays);
    if (durationDays) return Math.min(durationDays, YEAR_DAYS);
    if (monthSpanDays) return Math.min(monthSpanDays, YEAR_DAYS);
    return null;
  }

  const rawAnnualDays = stages.map(getAnnualPresenceDays);
  const knownDurations = rawAnnualDays.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);

  let fallbackDuration = 21;
  if (knownDurations.length) {
    const mid = Math.floor(knownDurations.length / 2);
    fallbackDuration = knownDurations.length % 2
      ? knownDurations[mid]
      : (knownDurations[mid - 1] + knownDurations[mid]) / 2;
  }

  const baseDays = rawAnnualDays.map(v => (Number.isFinite(v) && v > 0) ? v : fallbackDuration);
  const normalizedShares = baseDays.map(days => clamp(days / YEAR_DAYS, 0.005, 1));
  const readableWeights = normalizedShares.map(share => Math.pow(share, READABILITY_EXPONENT));

  let finalWeights = [...readableWeights];
  const totalWeight = finalWeights.reduce((sum, v) => sum + v, 0) || 1;
  const minWeight = totalWeight * MIN_VISIBLE_SHARE;

  finalWeights = finalWeights.map(weight => Math.max(weight, minWeight));

  const adjustedTotal = finalWeights.reduce((sum, v) => sum + v, 0) || 1;
  return finalWeights.map(weight => weight / adjustedTotal);
}

// =========================
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
