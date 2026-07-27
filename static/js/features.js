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
function setupLifeViz() {
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
    })
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
}
