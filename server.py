from flask import Flask, request, send_file, jsonify, render_template
from io import BytesIO
from base64 import b64decode
from pptx import Presentation
from pptx.util import Inches
from PIL import Image
import pandas as pd
import re
import json
import os

from openai import OpenAI

# OpenAI client reads OPENAI_API_KEY from your environment
client = OpenAI()

app = Flask(__name__, static_folder='static', template_folder='templates')


# ===================== Utility helpers =====================

def _normalize_col(name: str) -> str:
    """Lower-case, collapse spaces for matching column names case-insensitively."""
    return re.sub(r'\s+', ' ', str(name)).strip().lower()


def _pretty_label(col_name: str) -> str:
    """Create a simple human-friendly label from a column name."""
    return re.sub(r'\s+', ' ', str(col_name)).strip().capitalize()


def _clean_cell(val):
    if pd.isna(val):
        return ""
    text = str(val).strip()
    return "" if not text or text.lower() == 'nan' else text


def _excelish_month(val):
    """
    Convert workbook timing values into month labels the frontend can parse.
    Supports Excel serial dates, timestamps, and month-like strings.
    """
    if pd.isna(val):
        return ""

    if isinstance(val, (int, float)) and not isinstance(val, bool):
        try:
            dt = pd.to_datetime("1899-12-30") + pd.to_timedelta(float(val), unit="D")
            return dt.strftime("%b")
        except Exception:
            return str(val).strip()

    try:
        dt = pd.to_datetime(val, errors="coerce")
        if pd.notna(dt):
            return dt.strftime("%b")
    except Exception:
        pass

    text = str(val).strip()
    if not text:
        return ""

    lower = text.lower()
    month_map = {
        "jan": "Jan", "january": "Jan",
        "feb": "Feb", "february": "Feb",
        "mar": "Mar", "march": "Mar",
        "apr": "Apr", "april": "Apr",
        "may": "May",
        "jun": "Jun", "june": "Jun",
        "jul": "Jul", "july": "Jul",
        "aug": "Aug", "august": "Aug",
        "sep": "Sep", "sept": "Sep", "september": "Sep",
        "oct": "Oct", "october": "Oct",
        "nov": "Nov", "november": "Nov",
        "dec": "Dec", "december": "Dec",
    }
    for key, label in month_map.items():
        if key in lower:
            return label
    return text


def _range_text_from_values(values, suffix=""):
    cleaned = [str(v).strip() for v in values if str(v).strip()]
    if not cleaned:
        return ""
    uniq = list(dict.fromkeys(cleaned))
    if len(uniq) == 1:
        return f"{uniq[0]}{suffix}".strip()
    return f"{uniq[0]}-{uniq[-1]}{suffix}".strip()


def _structured_life_history_workbook_to_species_list(sheets):
    """
    Parse the multi-sheet workbook format used by the attached example workbook.
    Expected sheets include:
      - Life History Stages
      - Habitat
      - Life Span
      - Resource Needs
    """
    required_sheet = None
    for name in sheets:
        if _normalize_col(name) == "life history stages":
            required_sheet = name
            break
    if not required_sheet:
        return None

    species_map = {}

    def get_species_entry(scientific_name, common_name="", population=""):
        sci = _clean_cell(scientific_name)
        if not sci:
            return None
        key = sci.lower()
        entry = species_map.setdefault(key, {
            "name": sci,
            "commonName": _clean_cell(common_name),
            "population": _clean_cell(population),
            "imageFile": None,
            "imageUrl": None,
            "lifespan": [],
            "stages": {}
        })
        if common_name and not entry["commonName"]:
            entry["commonName"] = _clean_cell(common_name)
        if population and not entry["population"]:
            entry["population"] = _clean_cell(population)
        return entry

    def get_stage_entry(species_entry, stage_name):
        stage = _clean_cell(stage_name)
        if not species_entry or not stage:
            return None
        key = stage.lower()
        return species_entry["stages"].setdefault(key, {
            "name": stage,
            "duration_values": [],
            "duration_units": [],
            "timing_months": [],
            "bullets": []
        })

    stage_df = sheets[required_sheet]
    stage_cols = {_normalize_col(c): c for c in stage_df.columns}

    sci_col = stage_cols.get("species scientific name")
    common_col = stage_cols.get("species common name")
    pop_col = stage_cols.get("population (if appropriate)")
    life_stage_col = stage_cols.get("lifestage")
    duration_metric_col = stage_cols.get("metric")
    duration_value_col = stage_cols.get("value")
    timing_metric_col = stage_df.columns[9] if len(stage_df.columns) > 9 else None
    timing_value_col = stage_df.columns[10] if len(stage_df.columns) > 10 else None
    repro_strategy_col = stage_cols.get("reproductive strategy")

    for _, row in stage_df.iterrows():
        species_entry = get_species_entry(
            row.get(sci_col),
            row.get(common_col) if common_col else "",
            row.get(pop_col) if pop_col else ""
        )
        stage_entry = get_stage_entry(species_entry, row.get(life_stage_col) if life_stage_col else "")
        if not stage_entry:
            continue

        metric = _clean_cell(row.get(duration_metric_col)) if duration_metric_col else ""
        value = _clean_cell(row.get(duration_value_col)) if duration_value_col else ""
        if metric and value:
            stage_entry["duration_units"].append(metric)
            stage_entry["duration_values"].append(value)

        timing_metric = _clean_cell(row.get(timing_metric_col)) if timing_metric_col else ""
        timing_value = row.get(timing_value_col) if timing_value_col else None
        if timing_metric and not pd.isna(timing_value):
            stage_entry["timing_months"].append(_excelish_month(timing_value))

        repro_strategy = _clean_cell(row.get(repro_strategy_col)) if repro_strategy_col else ""
        if repro_strategy:
            stage_entry["bullets"].append(f"Reproduction: {repro_strategy}")

    habitat_sheet = next((sheets[name] for name in sheets if _normalize_col(name) == "habitat"), None)
    if habitat_sheet is not None and not habitat_sheet.empty:
        habitat_cols = list(habitat_sheet.columns)
        sci_col = habitat_cols[0] if len(habitat_cols) > 0 else None
        common_col = habitat_cols[1] if len(habitat_cols) > 1 else None
        pop_col = habitat_cols[2] if len(habitat_cols) > 2 else None
        stage_col = habitat_cols[3] if len(habitat_cols) > 3 else None
        habitat_names = habitat_cols[4:]

        for _, row in habitat_sheet.iterrows():
            species_entry = get_species_entry(row.get(sci_col), row.get(common_col), row.get(pop_col))
            stage_entry = get_stage_entry(species_entry, row.get(stage_col))
            if not stage_entry:
                continue
            active = [str(h).strip() for h in habitat_names if _clean_cell(row.get(h)).lower() in ("x", "yes", "true", "1")]
            if active:
                stage_entry["bullets"].append(f"Habitat: {', '.join(active)}")

    resource_sheet = next((sheets[name] for name in sheets if _normalize_col(name) == "resource needs"), None)
    if resource_sheet is not None and not resource_sheet.empty:
        resource_cols = list(resource_sheet.columns)
        sci_col = resource_cols[0] if len(resource_cols) > 0 else None
        common_col = resource_cols[1] if len(resource_cols) > 1 else None
        pop_col = resource_cols[2] if len(resource_cols) > 2 else None
        stage_col = resource_cols[3] if len(resource_cols) > 3 else None
        need_names = resource_cols[4:]

        for _, row in resource_sheet.iterrows():
            species_entry = get_species_entry(row.get(sci_col), row.get(common_col), row.get(pop_col))
            stage_entry = get_stage_entry(species_entry, row.get(stage_col))
            if not stage_entry:
                continue

            active = []
            for need in need_names:
                use = _clean_cell(row.get(need))
                if use:
                    active.append(f"{need}: {use}")
            if active:
                stage_entry["bullets"].append(f"Resource needs: {'; '.join(active[:4])}")

    lifespan_sheet = next((sheets[name] for name in sheets if _normalize_col(name) == "life span"), None)
    if lifespan_sheet is not None and not lifespan_sheet.empty:
        life_cols = {_normalize_col(c): c for c in lifespan_sheet.columns}
        sci_col = life_cols.get("species scientific name")
        common_col = life_cols.get("species common name")
        metric_col = life_cols.get("life span metric")
        value_col = life_cols.get("life span value")

        for _, row in lifespan_sheet.iterrows():
            species_entry = get_species_entry(row.get(sci_col), row.get(common_col) if common_col else "", "")
            if not species_entry:
                continue
            metric = _clean_cell(row.get(metric_col)) if metric_col else ""
            value = _clean_cell(row.get(value_col)) if value_col else ""
            if metric and value:
                species_entry["lifespan"].append((metric, value))

    species_out = []
    for info in species_map.values():
        title_base = info["commonName"] or info["name"]
        title = f"{title_base} - Life history"
        if info["population"]:
          title = f"{title_base} ({info['population']}) - Life history"

        lifespan_text = ""
        lifespan_values = [val for metric, val in info["lifespan"] if "year" in metric.lower()]
        if lifespan_values:
            lifespan_text = _range_text_from_values(lifespan_values, " years")
        elif info["lifespan"]:
            lifespan_text = _range_text_from_values([val for _, val in info["lifespan"]])

        stages_out = []
        for st in info["stages"].values():
            bullets = []

            duration_suffix = ""
            if st["duration_units"]:
                duration_suffix = f" {st['duration_units'][0]}"
            duration_text = _range_text_from_values(st["duration_values"], duration_suffix)
            if duration_text:
                bullets.append(f"Duration: {duration_text}")

            months = [m for m in st["timing_months"] if m]
            if months:
                bullets.append(f"Timing: {_range_text_from_values(months)}")

            if lifespan_text:
                bullets.append(f"Lifespan: {lifespan_text}")

            bullets.extend(st["bullets"])
            stages_out.append({
                "title": st["name"],
                "bullets": list(dict.fromkeys([b for b in bullets if b]))
            })

        species_out.append({
            "name": info["name"],
            "title": title,
            "imageFile": info["imageFile"],
            "imageUrl": info["imageUrl"],
            "stages": stages_out
        })

    return species_out


def _add_bullets_from_row(df, row, species_dict, species_col, stage_col=None):
    """
    Generic aggregator for the full workbook route.

    - Uses species + optional stage columns (case-insensitive) to group rows.
    - All other non-empty columns become bullets like "Label: value".
    - Species and stage keys are lowercased so differing capitalization merges.
    - Display names keep the first capitalization encountered.
    """
    raw_species = row[species_col]
    if pd.isna(raw_species):
        return

    s_name = str(raw_species).strip()
    if not s_name or s_name.lower() == 'nan':
        return

    s_key = s_name.lower()

    species_entry = species_dict.setdefault(
        s_key,
        {
            "key": s_key,
            "name": s_name,
            "commonName": None,
            "imageFile": None,
            "imageUrl": None,
            "stages": {},
            "speciesBullets": [],
        }
    )

    stage_name = None
    if stage_col is not None and stage_col in df.columns:
        raw_stage = row[stage_col]
        if not pd.isna(raw_stage):
            tmp = str(raw_stage).strip()
            if tmp and tmp.lower() != 'nan':
                stage_name = tmp

    if stage_name:
        st_key = stage_name.lower()
        stage = species_entry["stages"].setdefault(
            st_key,
            {"key": st_key, "name": stage_name, "bullets": []}
        )
        target_list = stage["bullets"]
    else:
        target_list = species_entry["speciesBullets"]

    for col in df.columns:
        if col == species_col or col == stage_col:
            continue
        val = row[col]
        if pd.isna(val):
            continue
        text = str(val).strip()
        if not text or text.lower() == 'nan':
            continue
        label = _pretty_label(col)
        bullet = f"{label}: {text}"
        target_list.append(bullet)


# ===================== Routes =====================

@app.route('/')
def index():
    return render_template('index.html')


# ---------- Export PPTX from PNG ----------

@app.route('/generate_pptx', methods=['POST'])
def generate_pptx():
    data = request.get_json()
    if not data or 'image_b64' not in data:
        return jsonify({"error": "Missing image_b64"}), 400

    title = data.get('title', 'Export')
    image_b64_clean = re.sub(r'^data:image/.+;base64,', '', data['image_b64'])
    image_bytes = b64decode(image_b64_clean)

    image = Image.open(BytesIO(image_bytes)).convert('RGB')
    img_width_px, img_height_px = image.size

    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank slide

    img_stream = BytesIO()
    image.save(img_stream, format='PNG')
    img_stream.seek(0)

    slide_w = prs.slide_width
    slide_h = prs.slide_height

    dpi = 96.0
    img_w_in = img_width_px / dpi
    img_h_in = img_height_px / dpi

    max_w_in = slide_w / 914400.0
    max_h_in = slide_h / 914400.0

    scale = min(max_w_in / img_w_in, max_h_in / img_h_in, 1.0)
    final_w = img_w_in * scale
    final_h = img_h_in * scale

    left = (max_w_in - final_w) / 2.0
    top = (max_h_in - final_h) / 2.0

    slide.shapes.add_picture(
        img_stream,
        Inches(left),
        Inches(top),
        width=Inches(final_w),
        height=Inches(final_h),
    )

    out = BytesIO()
    prs.save(out)
    out.seek(0)

    safe_title = re.sub(r'[^a-zA-Z0-9 _\-\.\(\)]', '', title).strip() or "LifeViz"
    return send_file(
        out,
        as_attachment=True,
        download_name=f"{safe_title}.pptx",
        mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )


# ---------- FULL WORKBOOK UPLOAD ----------

@app.route('/upload_excel_full', methods=['POST'])
def upload_excel_full():
    """
    Generic multi-sheet workbook reader.

    - Any sheet that has a 'species' column (case-insensitive) is used.
    - If it has a 'stage' / 'lifestage' column, rows are grouped by stage.
    - Every other non-empty cell becomes a bullet "Label: value".
    - Species and stages are merged case-insensitively.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']

    try:
        sheets = pd.read_excel(file, sheet_name=None)
    except Exception as e:
        return jsonify({"error": f"Could not read Excel file: {e}"}), 400

    if not sheets:
        return jsonify({"error": "Excel workbook has no sheets"}), 400

    species_dict = {}

    for sheet_name, df in sheets.items():
        if df is None or df.empty:
            continue

        normalized_cols = {_normalize_col(c): c for c in df.columns}

        species_col = None
        for key, orig in normalized_cols.items():
            if 'species' in key:
                species_col = orig
                break
        if not species_col:
            continue

        stage_col = None
        for key, orig in normalized_cols.items():
            if 'stage' in key or 'lifestage' in key or 'life stage' in key:
                stage_col = orig
                break

        for _, row in df.iterrows():
            _add_bullets_from_row(df, row, species_dict, species_col, stage_col)

    if not species_dict:
        return jsonify({"error": "No species rows found in workbook"}), 400

    species_list = []
    for s_key, info in species_dict.items():
        stages = []

        for st_key, st in info["stages"].items():
            seen = set()
            bullets = []
            for b in st["bullets"]:
                if b not in seen:
                    bullets.append(b)
                    seen.add(b)
            stages.append({"title": st["name"], "bullets": bullets})

        if info["speciesBullets"]:
            stages.insert(0, {
                "title": "Species summary",
                "bullets": list(dict.fromkeys(info["speciesBullets"]))
            })

        species_list.append({
            "name": info["name"],
            "title": f"{info['name']} – Life history",
            "imageFile": info.get("imageFile"),
            "imageUrl": info.get("imageUrl"),
            "stages": stages
        })

    return jsonify({
        "title": "Life History Workbook",
        "species": species_list
    })


# ---------- SIMPLE TEMPLATE UPLOAD ----------

@app.route('/upload_excel_simple', methods=['POST'])
def upload_excel_simple():
    """
    Simple one-sheet template.

    Expected columns (case-insensitive):

      Species
      CommonName      (optional)
      ImageUrl        (optional)
      ImageFile       (optional)
      StageName
      StageOrder      (optional)
      Duration
      Timing
      Habitat
      Lifespan
      Movement
      Physical
      Reproduction
      Food
      Notes           (optional)

    One row per life stage.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']

    try:
        df = pd.read_excel(file)
    except Exception as e:
        return jsonify({"error": f"Could not read Excel file: {e}"}), 400

    if df.empty:
        return jsonify({"error": "Template sheet is empty"}), 400

    cols_norm = {_normalize_col(c): c for c in df.columns}

    def col(*names):
        for n in names:
            key = _normalize_col(n)
            if key in cols_norm:
                return cols_norm[key]
        return None

    species_col = col('Species')
    stage_col = col('StageName', 'Stage', 'Life stage', 'Lifestage')
    order_col = col('StageOrder', 'Order')
    common_col = col('CommonName', 'Common name')
    image_file_col = col('ImageFile', 'Image', 'Photo')
    image_url_col = col('ImageUrl', 'Image URL', 'PhotoUrl', 'Photo URL')

    if not species_col or not stage_col:
        return jsonify({"error": "Template must contain Species and StageName columns"}), 400

    detail_candidates = [
        'Duration', 'Timing', 'Habitat', 'Lifespan', 'Movement',
        'Physical', 'Reproduction', 'Food', 'Notes'
    ]
    detail_cols = [col(c) for c in detail_candidates if col(c)]

    species_map = {}

    for _, row in df.iterrows():
        raw_species = row[species_col]
        if pd.isna(raw_species):
            continue
        s_name = str(raw_species).strip()
        if not s_name or s_name.lower() == 'nan':
            continue

        s_key = s_name.lower()

        sp = species_map.setdefault(
            s_key,
            {
                "key": s_key,
                "name": s_name,
                "commonName": None,
                "imageFile": None,
                "imageUrl": None,
                "stages": {}
            }
        )

        if common_col and not pd.isna(row[common_col]):
            sp["commonName"] = str(row[common_col]).strip()
        if image_file_col and not pd.isna(row[image_file_col]):
            sp["imageFile"] = str(row[image_file_col]).strip()
        if image_url_col and not pd.isna(row[image_url_col]):
            sp["imageUrl"] = str(row[image_url_col]).strip()

        raw_stage = row[stage_col]
        if pd.isna(raw_stage):
            continue
        stage_name = str(raw_stage).strip()
        if not stage_name or stage_name.lower() == 'nan':
            continue

        st_key = stage_name.lower()

        order = None
        if order_col and not pd.isna(row[order_col]):
            try:
                order = float(row[order_col])
            except Exception:
                order = None

        stage = sp["stages"].setdefault(
            st_key,
            {
                "key": st_key,
                "name": stage_name,
                "order": order,
                "bullets": []
            }
        )

        for c in detail_cols:
            val = row[c]
            if pd.isna(val):
                continue
            text = str(val).strip()
            if not text or text.lower() == 'nan':
                continue
            label = _pretty_label(c)
            stage["bullets"].append(f"{label}: {text}")

    species_out = []
    for s_key, sp in species_map.items():
        stages = list(sp["stages"].values())
        stages.sort(key=lambda st: (9999 if st["order"] is None else st["order"]))
        stages_out = [{"title": st["name"], "bullets": st["bullets"]} for st in stages]

        species_out.append({
            "name": sp["name"],
            "title": f"{sp['name']} – Life history",
            "imageFile": sp["imageFile"],
            "imageUrl": sp["imageUrl"],
            "stages": stages_out
        })

    return jsonify({
        "title": "LifeViz Template",
        "species": species_out
    })


# ---------- AI ENHANCEMENT ROUTE ----------

@app.route('/ai_enhance', methods=['POST'])
def ai_enhance():
    """
    Takes a single-species JSON (title, stages[])
    and asks an LLM to:
      - order stages logically,
      - merge duplicates,
      - compress / clean bullets.

    Returns: { title, stages[] } with same structure.

    IMPORTANT:
    - No new facts invented.
    - Keep bullets concise.
    """
    try:
        payload = request.get_json()
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    if not payload or 'stages' not in payload:
        return jsonify({"error": "Missing stages in payload"}), 400

    species_title = payload.get('title', 'Life history')
    stages = payload.get('stages', [])

    compact = {
        "title": species_title,
        "stages": [
            {"title": s.get("title", ""), "bullets": s.get("bullets", [])}
            for s in stages
        ]
    }

    system_prompt = (
        "You are an ecologist who designs clear life-history diagrams.\n"
        "TASK:\n"
        "- Reorder stages into a logical life-history sequence.\n"
        "- Merge near-duplicate stages when appropriate.\n"
        "- Preserve clear 'Duration:' bullets when present.\n"
        "- Preserve clear 'Timing:' / seasonal timing bullets when present.\n"
        "- Preserve one clear 'Lifespan:' value when present anywhere in the input.\n"
        "- For each stage, keep at most 5 concise bullets summarizing the information\n"
        "  (habitat, movement, food, reproduction, lifespan, etc.).\n"
        "- Do NOT invent any new biological facts; only rephrase or combine what is given.\n\n"
        "OUTPUT FORMAT (IMPORTANT):\n"
        "- Return ONLY valid JSON.\n"
        "- No explanation, no commentary, no markdown, no ``` fences.\n"
        "- Shape must be: {\"title\": string, \"stages\": [{\"title\": string, \"bullets\": [string, ...]}, ...]}\n"
    )

    user_prompt = (
        "Here is the current life-history data as JSON. "
        "Reorder and clean it as described, and return ONLY the JSON object.\n\n"
        f"{json.dumps(compact, ensure_ascii=False)}"
    )

    try:
        resp = client.responses.create(
            model="gpt-4.1-mini",
            input=[
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
            ],
        )

        text_out = resp.output[0].content[0].text.strip()

        # If model accidentally wraps with ```json fences, strip them
        if text_out.startswith("```"):
            lines = text_out.splitlines()
            lines = lines[1:]  # drop opening fence
            if lines and lines[-1].strip().startswith("```"):
                lines = lines[:-1]
            text_out = "\n".join(lines).strip()

        enhanced = json.loads(text_out)

    except Exception as e:
        return jsonify({"error": f"AI enhancement failed: {e}"}), 500

    if 'stages' not in enhanced or not isinstance(enhanced['stages'], list):
        return jsonify({"error": "AI returned invalid structure"}), 500

    return jsonify(enhanced)


if __name__ == '__main__':
    # Make sure you've set OPENAI_API_KEY in your environment
    app.run(debug=True, port=8000)
