let hoveredStageIndex = null;

function normalizeStageTitleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalStageKey(title) {
  const key = normalizeStageTitleKey(title);
  if (!key) return "";
  if (/(^| )egg( |$)|embryo|fertiliz/.test(key)) return "egg";
  if (/nest|brood|incubat/.test(key)) return "nest";
  if (/larva|larvae|tadpole|fry|alevin/.test(key)) return "larva";
  if (/chick|nestling|fledgling/.test(key)) return "chick";
  if (/juvenile|juveniles|young|immature|subadult|yearling|smolt|parr/.test(key)) return "juvenile";
  if (/reproductive adult|breeding adult/.test(key)) return "reproductive adult";
  if (/adult|mature/.test(key)) return "adult";
  if (/spawn|burrow/.test(key)) return "spawning";
  return key.replace(/\b(stage|period)\b/g, "").replace(/\s+/g, " ").trim();
}

function mergePreservedStageBullets(originalStages, enhancedStages) {
  const originalByTitle = new Map();
  const originalByCanonical = new Map();

  (originalStages || []).forEach(stage => {
    const key = normalizeStageTitleKey(stage?.title);
    if (key && !originalByTitle.has(key)) {
      originalByTitle.set(key, stage);
    }

    const canonicalKey = canonicalStageKey(stage?.title);
    if (canonicalKey && !originalByCanonical.has(canonicalKey)) {
      originalByCanonical.set(canonicalKey, stage);
    }
  });

  return (enhancedStages || []).map(stage => {
    const key = normalizeStageTitleKey(stage?.title);
    const canonicalKey = canonicalStageKey(stage?.title);
    const original = originalByTitle.get(key) || originalByCanonical.get(canonicalKey);
    if (!original) return stage;

    const mergedBullets = Array.isArray(stage?.bullets) ? [...stage.bullets] : [];
    const originalBullets = Array.isArray(original?.bullets) ? original.bullets.map(String) : [];

    const preservedPrefixes = [
      "timing:",
      "seasonal timing:",
      "date range:",
      "range:",
      "duration:",
      "incubation duration:",
      "period:",
      "time in stage:",
      "lifespan:"
    ];

    preservedPrefixes.forEach(prefix => {
      const hasCurrent = mergedBullets.some(b => String(b).toLowerCase().startsWith(prefix));
      if (hasCurrent) return;

      const originalMatch = originalBullets.find(b => b.toLowerCase().startsWith(prefix));
      if (originalMatch) mergedBullets.unshift(originalMatch);
    });

    return {
      ...stage,
      timingRange: stage?.timingRange || original?.timingRange || "",
      timingMonths: Array.isArray(stage?.timingMonths) && stage.timingMonths.length
        ? [...stage.timingMonths]
        : (Array.isArray(original?.timingMonths) ? [...original.timingMonths] : []),
      bullets: [...new Set(mergedBullets)]
    };
  });
}

function enhanceSpeciesWithAI(sp) {
  if (!sp) return Promise.resolve(sp);
  if (sp.aiEnhanced) return Promise.resolve(sp);

  const originalStages = Array.isArray(sp.stages)
    ? sp.stages.map(stage => ({
        ...stage,
        bullets: Array.isArray(stage.bullets) ? [...stage.bullets] : []
      }))
    : [];

  return fetch("/ai_enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: sp.title || sp.name || "Life history",
      stages: sp.stages || []
    })
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      const enhancedStages = Array.isArray(data.stages) ? data.stages : sp.stages;
      sp.stages = mergePreservedStageBullets(originalStages, enhancedStages);
      if (data.title) sp.title = data.title;
      sp.aiEnhanced = true;
      return sp;
    });
}

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
        lifespan: raw.lifespan || null,
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
    title: sp.title || `${fullDataset.title} - ${sp.name}`,
    stages: sp.stages || [],
    imageFile: sp.imageFile || null,
    imageUrl: sp.imageUrl || null,
    speciesName: sp.name || null,
    lifespan: sp.lifespan || null
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
    lifespan: "2 years",
    stages: [
      {
        title: "Egg",
        bullets: [
          "Duration: 7-14 days",
          "Timing: May-Aug",
          "Reproduction: asynchronous egg laying with oldest chick near fledging when youngest hatches",
          "Resource needs: Nest substrate: sheltered branch; Thermal cover: dense foliage"
        ]
      },
      {
        title: "Juvenile",
        bullets: [
          "Duration: 3-5 weeks",
          "Timing: Jun-Aug",
          "Habitat: Edge vegetation",
          "Movement: short dispersal flights"
        ]
      },
      {
        title: "Adult",
        bullets: [
          "Timing: Year-round",
          "Lifespan: 2 years",
          "Habitat: Woodland edge",
          "Reproduction: multiple breeding attempts",
          "Resource needs: Food source: insects; Shelter: canopy cover"
        ]
      }
    ]
  }));
}

function renderCurrentSpeciesWithAI(options = { force: false }) {
  if (!fullDataset) return;

  const sp = getCurrentSpeciesObj();
  if (!sp) return;
  if (options.force) sp.aiEnhanced = false;

  const aiButton = document.getElementById("aiEnhanceBtn");

  const disableButtons = (disabled) => {
    aiBusy = disabled;
    if (aiButton) aiButton.disabled = disabled;
  };

  disableButtons(true);
  showStatus("Enhancing diagram with AI...");

  enhanceSpeciesWithAI(sp)
    .then(() => {
      const toRender = speciesToRenderData(sp);
      renderSelectedTemplate(toRender);

      const jsonOut = { title: toRender.title, lifespan: toRender.lifespan, stages: toRender.stages };
      const jsonInput = document.getElementById("jsonInput");
      if (jsonInput) jsonInput.value = JSON.stringify(jsonOut, null, 2);
    })
    .catch(err => {
      console.error("AI enhancement failed:", err);
      showStatus("AI enhancement failed - showing original layout.");
      renderSelectedTemplate(speciesToRenderData(sp));
    })
    .finally(() => disableButtons(false));
}

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

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function clearNode(node) {
  if (!node) return;
  node.innerHTML = "";
}

function renderChip(container, html, className = "") {
  const chip = document.createElement("div");
  chip.className = `chip ${className}`.trim();
  chip.innerHTML = html;
  container.appendChild(chip);
}

function fillBulletList(container, items) {
  clearNode(container);
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "No additional details provided.";
    container.appendChild(li);
    return;
  }

  items.forEach(item => {
    const li = document.createElement("li");
    li.textContent = item;
    container.appendChild(li);
  });
}

function getActiveInspectorStageIndex(preferredIndex = null) {
  const stages = currentRenderContext?.stages || [];
  if (!stages.length) return -1;

  if (preferredIndex === null && hoveredStageIndex === null && selectedStageIndex === null) {
    return -1;
  }

  const candidate = preferredIndex !== null
    ? preferredIndex
    : (hoveredStageIndex !== null ? hoveredStageIndex : selectedStageIndex);

  return clamp(candidate, 0, stages.length - 1);
}

window.refreshStageInspector = function refreshStageInspector(preferredIndex = null) {
  const sp = getCurrentSpeciesObj();
  const renderData = sp ? speciesToRenderData(sp) : currentRenderContext?.data;
  const stages = currentRenderContext?.stages || renderData?.stages || [];

  setText("inspectorSpeciesTitle", renderData?.title || "Life history");
  setText(
    "inspectorSpeciesMeta",
    stages.length
      ? `${stages.length} life-history stage${stages.length === 1 ? "" : "s"} shown across one annual cycle.`
      : "Upload data to inspect annual stage timing and lifespan context."
  );
  setText("inspectorLifespan", `Average lifespan: ${getSpeciesLifespanText(renderData) || "not provided"}`);

  const annualContainer = document.getElementById("inspectorAnnualFlow");
  fillBulletList(
    annualContainer,
    getAnnualWindowSummary(stages).map(item => {
      const parts = [item.title];
      if (item.timing) parts.push(item.timing);
      if (item.duration) parts.push(item.duration);
      return parts.join(" - ");
    })
  );

  const resourceContainer = document.getElementById("inspectorResources");
  clearNode(resourceContainer);
  const resourceStory = summarizeResourceStory(stages);
  if (resourceStory.length) {
    resourceStory.forEach(item => {
      renderChip(
        resourceContainer,
        `<strong>${item.group}</strong>: ${item.message}<br><span>${item.stages.join(", ")}</span>`
      );
    });
  } else {
    const resourceSummary = getSpeciesResourceSummary(stages);
    if (!resourceSummary.length) {
      renderChip(resourceContainer, "No explicit resource needs found in uploaded data.");
    } else {
      resourceSummary.forEach(item => {
        renderChip(
          resourceContainer,
          `<strong>${item.label}</strong>: ${item.value}<br><span>${item.stages.join(", ")}</span>`
        );
      });
    }
  }

  const stageIndex = getActiveInspectorStageIndex(preferredIndex);
  if (stageIndex < 0 || !stages[stageIndex]) {
    setText("inspectorStageTitle", "No stage selected");
    setText("inspectorStageMeta", "Hover or click a slice, month bar, or card to inspect it.");
    clearNode(document.getElementById("inspectorStageBadges"));
    fillBulletList(document.getElementById("inspectorStageBullets"), []);
    return;
  }

  const stage = stages[stageIndex];
  const focus = getStageFocusSummary(stage);
  setText("inspectorStageTitle", getStageHeadingText(stage, stageIndex));
  setText(
    "inspectorStageMeta",
    focus.timing
      ? `Shown in the annual cycle during ${focus.timing}.`
      : "This stage does not include explicit month timing."
  );

  const badgeContainer = document.getElementById("inspectorStageBadges");
  clearNode(badgeContainer);
  const activeColor = currentRenderContext?.stageEntries?.[stageIndex]?.color || "#334155";
  renderChip(badgeContainer, `<strong>Stage ${stageIndex + 1}</strong>`, "is-stage");
  badgeContainer.lastElementChild.style.background = activeColor;
  if (focus.duration) renderChip(badgeContainer, `<strong>Duration</strong>: ${focus.duration}`);
  if (focus.timing) renderChip(badgeContainer, `<strong>Timing</strong>: ${focus.timing}`);
  if (focus.habitat) renderChip(badgeContainer, `<strong>Habitat</strong>: ${focus.habitat}`);
  if (focus.resourceFocus) renderChip(badgeContainer, `<strong>Resource focus</strong>: ${focus.resourceFocus}`);
  focus.resources.forEach(item => renderChip(badgeContainer, `<strong>${item.label}</strong>: ${item.value}`));

  fillBulletList(document.getElementById("inspectorStageBullets"), (stage.bullets || []).map(String));
};

window.applyStageSelection = function applyStageSelection(stageIndex, options = {}) {
  const context = currentRenderContext;
  if (!context || !context.stageEntries?.length) {
    window.refreshStageInspector();
    return;
  }

  if (stageIndex === null || stageIndex === undefined) {
    context.stageEntries.forEach((entry) => {
      entry.elements.forEach(el => {
        el.classList.remove("is-active", "is-dimmed", "is-hidden-focus");
      });
    });
    window.refreshStageInspector(null);
    return;
  }

  const activeIndex = clamp(stageIndex ?? selectedStageIndex, 0, context.stageEntries.length - 1);
  if (options.commit) selectedStageIndex = activeIndex;

  context.stageEntries.forEach((entry, index) => {
    entry.elements.forEach(el => {
      const role = el.getAttribute("data-stage-role") || "";
      const shouldHideForFocus = context.template === "circular" &&
        index !== activeIndex &&
        ["card", "card-head", "card-head-text", "card-body", "connector"].includes(role);

      el.classList.toggle("is-active", index === activeIndex);
      el.classList.toggle("is-dimmed", index !== activeIndex);
      el.classList.toggle("is-hidden-focus", shouldHideForFocus);
    });
  });

  window.refreshStageInspector(activeIndex);
};

function bindSvgInteractions() {
  const svgContainer = document.getElementById("svgContainer");
  if (!svgContainer || svgContainer.dataset.bound === "true") return;
  svgContainer.dataset.bound = "true";

  svgContainer.addEventListener("mouseover", (event) => {
    const target = event.target.closest("[data-stage-index]");
    if (!target) return;
    hoveredStageIndex = Number(target.getAttribute("data-stage-index"));
    window.applyStageSelection(hoveredStageIndex);
  });

  svgContainer.addEventListener("mouseout", (event) => {
    const toElement = event.relatedTarget;
    if (toElement && toElement.closest && toElement.closest("[data-stage-index]")) return;
    hoveredStageIndex = null;
    window.applyStageSelection(selectedStageIndex);
  });

  svgContainer.addEventListener("click", (event) => {
    const target = event.target.closest("[data-stage-index]");
    if (!target) return;
    selectedStageIndex = Number(target.getAttribute("data-stage-index"));
    hoveredStageIndex = null;
    window.applyStageSelection(selectedStageIndex, { commit: true });
  });
}

function renderCurrentSpecies() {
  const sp = getCurrentSpeciesObj();
  if (!sp) return;
  selectedStageIndex = null;
  hoveredStageIndex = null;
  showStatus("Preparing diagram...");
  enhanceSpeciesWithAI(sp)
    .catch((err) => {
      console.error("Automatic AI preparation failed:", err);
    })
    .finally(() => {
      renderSelectedTemplate(speciesToRenderData(sp));
    });
}

function setupLifeViz() {
  bindSvgInteractions();

  document.getElementById("renderBtn")?.addEventListener("click", () => {
    loadDatasetFromInput((err, dataset) => {
      if (err) return alert("Invalid JSON");
      fullDataset = dataset;
      populateSpeciesSelect(fullDataset);
      renderCurrentSpecies();
    });
  });

  document.getElementById("speciesSelect")?.addEventListener("change", () => {
    if (!fullDataset) return;
    renderCurrentSpecies();
  });

  document.getElementById("templateSelect")?.addEventListener("change", () => {
    if (!fullDataset) return;
    renderCurrentSpecies();
  });

  document.getElementById("downloadPngBtn")?.addEventListener("click", () => {
    const svg = document.querySelector("#svgScaler svg");
    if (!svg) return alert("Render first");

    svgToPngBase64(svg, 1800, 1250, (err, pngDataUrl) => {
      if (err) return alert("Failed to convert");
      const a = document.createElement("a");
      a.href = pngDataUrl;
      a.download = "lifeviz_diagram.png";
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
    renderCurrentSpecies();

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
}
