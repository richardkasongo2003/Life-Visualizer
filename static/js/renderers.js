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
  const circularModel = buildCircularStageModel(data.stages || []);
  const stages = circularModel.stages || [];
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
  const cardOrbitR = outerR + Math.min(360, Math.max(260, n * 22));

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

  const durationPieOuterR = outerR - 18;
  const durationPieInnerR = 60;

  const toArcPoint = (cx, cy, r, deg) => {
    const rad = deg * Math.PI / 180;
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
  };

  const arcPath = (cx, cy, r, startDeg, endDeg) => {
    const start = toArcPoint(cx, cy, r, startDeg);
    const end = toArcPoint(cx, cy, r, endDeg);
    const delta = Math.abs(endDeg - startDeg);
    const largeArc = delta > 180 ? "1" : "0";
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
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

  const lifespanText = getSpeciesLifespanText(data) || "Not provided";
  const durationWeights = calculatePieDurationWeights(stages, lifespanText);

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

  const groupArcR = outerR + 22;
  const lifeStageGroups = circularModel.groups.length ? circularModel.groups : getLifeStageGroups(stages);
  lifeStageGroups.forEach((group) => {
    const firstSlice = pieSlices[group.startIndex];
    const lastSlice = pieSlices[group.endIndex];
    if (!firstSlice || !lastSlice) return;

    const startDeg = firstSlice.startDeg;
    const endDeg = lastSlice.endDeg;
    const midDeg = (startDeg + endDeg) / 2;
    const groupColor = group.color;

    const groupArc = document.createElementNS(SVG_NS, "path");
    groupArc.setAttribute("d", arcPath(centerX, centerY, groupArcR, startDeg, endDeg));
    groupArc.setAttribute("fill", "none");
    groupArc.setAttribute("stroke", groupColor);
    groupArc.setAttribute("stroke-width", 11);
    groupArc.setAttribute("stroke-linecap", "round");
    groupArc.setAttribute("opacity", "0.5");
    svg.appendChild(groupArc);

    const labelPoint = toArcPoint(centerX, centerY, groupArcR + 22, midDeg);
    const groupLabel = document.createElementNS(SVG_NS, "text");
    groupLabel.setAttribute("x", labelPoint.x);
    groupLabel.setAttribute("y", labelPoint.y);
    groupLabel.setAttribute("text-anchor", "middle");
    groupLabel.setAttribute("font-size", 12);
    groupLabel.setAttribute("font-weight", "bold");
    groupLabel.setAttribute("fill", "#334155");
    groupLabel.textContent = group.label;
    svg.appendChild(groupLabel);
  });

  const core = document.createElementNS(SVG_NS, "circle");
  core.setAttribute("cx", centerX);
  core.setAttribute("cy", centerY);
  core.setAttribute("r", 56);
  core.setAttribute("fill", "#ffffff");
  core.setAttribute("stroke", "#cbd5e1");
  core.setAttribute("stroke-width", 1.5);
  svg.appendChild(core);

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
  const placedRects = [];
  const circleExclusionR = outerR + 42;
  const minCardY = safeTopY + 18;
  const maxCardY = centerY + outerR + maxCardH + 180;

  const normalizeAngle = (rad) => {
    let a = rad;
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
  };

  const angularDistance = (a, b) => Math.abs(normalizeAngle(a - b));

  const rectsOverlap = (a, b, pad = 18) => (
    a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
  );

  const rectIntersectsCircle = (rect, cx, cy, r) => {
    const closestX = clamp(cx, rect.x, rect.x + rect.w);
    const closestY = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx * dx + dy * dy) < (r * r);
  };

  const fitsRect = (rect) => (
    !rectIntersectsCircle(rect, centerX, centerY, circleExclusionR) &&
    !placedRects.some(existing => rectsOverlap(rect, existing)) &&
    rect.y >= minCardY &&
    rect.y + rect.h <= maxCardY
  );

  const makeRectForPolar = (angle, radius, cardH) => {
    const rawX = centerX + Math.cos(angle) * radius - cardW / 2;
    const rawY = centerY + Math.sin(angle) * radius - cardH / 2;
    return {
      x: clamp(rawX, 20, width - cardW - 20),
      y: clamp(rawY, minCardY, maxCardY - cardH),
      w: cardW,
      h: cardH
    };
  };

  const findStackedRect = (placement) => {
    const dx = Math.cos(placement.angle);
    const dy = Math.sin(placement.angle);
    const shifts = [0, -170, 170, -340, 340, -510, 510];

    if (Math.abs(dx) >= Math.abs(dy)) {
      const x = dx >= 0 ? width - cardW - 24 : 24;
      for (const shift of shifts) {
        const rect = {
          x,
          y: clamp(placement.nodeY - placement.cardH / 2 + shift, minCardY, maxCardY - placement.cardH),
          w: cardW,
          h: placement.cardH
        };
        if (fitsRect(rect)) return rect;
      }
    } else {
      const y = dy < 0 ? minCardY + 10 : centerY + outerR + 90;
      for (const shift of shifts) {
        const rect = {
          x: clamp(placement.nodeX - cardW / 2 + shift, 20, width - cardW - 20),
          y: clamp(y, minCardY, maxCardY - placement.cardH),
          w: cardW,
          h: placement.cardH
        };
        if (fitsRect(rect)) return rect;
      }
    }

    return {
      x: clamp(placement.nodeX - cardW / 2, 20, width - cardW - 20),
      y: clamp(centerY + outerR + 90, minCardY, maxCardY - placement.cardH),
      w: cardW,
      h: placement.cardH
    };
  };

  const cardinalAngles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

  const placements = stages.map((stage, i) => {
    const slice = pieSlices[i];
    const angleDeg = slice ? (slice.startDeg + slice.endDeg) / 2 : (-90 + (i * 360 / n));
    const angle = angleDeg * Math.PI / 180;
    const nodeX = centerX + Math.cos(angle) * nodeOrbitR;
    const nodeY = centerY + Math.sin(angle) * nodeOrbitR;
    const cardH = estimatedCardHeights[i];
    const placement = {
      stage,
      index: i,
      angle,
      angleDeg,
      nodeX,
      nodeY,
      cardH,
      color: heatColor(i, n)
    };

    const nearestCardinals = [...cardinalAngles].sort((a, b) => angularDistance(angle, a) - angularDistance(angle, b));
    const angleCandidates = [
      angle,
      angle - 0.35,
      angle + 0.35,
      angle - 0.7,
      angle + 0.7,
      ...nearestCardinals
    ].map(normalizeAngle);
    const radiusCandidates = [cardOrbitR, cardOrbitR + 90, cardOrbitR + 170];

    let chosenRect = null;
    for (const radius of radiusCandidates) {
      for (const angleCandidate of angleCandidates) {
        const rect = makeRectForPolar(angleCandidate, radius, cardH);
        if (fitsRect(rect)) {
          chosenRect = rect;
          placement.cardAngle = angleCandidate;
          break;
        }
      }
      if (chosenRect) break;
    }

    if (!chosenRect) {
      chosenRect = findStackedRect(placement);
      placement.cardAngle = angle;
    }

    placement.cardX = chosenRect.x;
    placement.cardY = chosenRect.y;
    placement.anchorX = clamp(placement.nodeX, placement.cardX, placement.cardX + cardW);
    placement.anchorY = clamp(placement.nodeY, placement.cardY, placement.cardY + placement.cardH);
    placedRects.push(chosenRect);
    maxCardBottom = Math.max(maxCardBottom, placement.cardY + placement.cardH);
    return placement;
  });

  placements.forEach((placement) => {
    const { stage, index: i, angle, nodeX, nodeY, color, cardH, cardX, cardY, anchorX, anchorY } = placement;

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
