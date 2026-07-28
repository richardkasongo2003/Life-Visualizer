from io import BytesIO
import re

import pandas as pd


def normalize_col(name: str) -> str:
    return re.sub(r"\s+", " ", str(name)).strip().lower()


def pretty_label(col_name: str) -> str:
    return re.sub(r"\s+", " ", str(col_name)).strip().capitalize()


def clean_cell(val):
    if pd.isna(val):
        return ""
    text = str(val).strip()
    return "" if not text or text.lower() == "nan" else text


def excelish_month(val):
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


def range_text_from_values(values, suffix=""):
    cleaned = [str(v).strip() for v in values if str(v).strip()]
    if not cleaned:
        return ""
    uniq = list(dict.fromkeys(cleaned))
    if len(uniq) == 1:
        return f"{uniq[0]}{suffix}".strip()
    return f"{uniq[0]}-{uniq[-1]}{suffix}".strip()


def sheet_name_matches(sheet_name: str, *needles: str) -> bool:
    normalized = normalize_col(sheet_name)
    return any(needle in normalized for needle in needles)


def sheet_cell(df, row_idx, col_idx):
    if row_idx >= len(df.index) or col_idx >= len(df.columns):
        return ""
    return clean_cell(df.iat[row_idx, col_idx])


def coalesce_label_value(items, max_items=4):
    cleaned = []
    for label, value in items:
        label_text = clean_cell(label)
        value_text = clean_cell(value)
        if not label_text or not value_text:
            continue
        cleaned.append(f"{label_text}: {value_text}")
    return cleaned[:max_items]


def lifespan_unit_suffix(metric, value=""):
    unit = clean_cell(metric).lower()
    value_text = clean_cell(value)
    singular = value_text in ("1", "1.0")
    if "year" in unit:
        return " year" if singular else " years"
    if "month" in unit:
        return " month" if singular else " months"
    if "week" in unit:
        return " week" if singular else " weeks"
    if "day" in unit:
        return " day" if singular else " days"
    return f" {metric}".rstrip() if metric else ""


def select_lifespan_text(lifespan_rows):
    cleaned = []
    for row in lifespan_rows:
        if len(row) == 3:
            metric, value, qualifier = row
        else:
            metric, value = row
            qualifier = ""
        metric = clean_cell(metric)
        value = clean_cell(value)
        qualifier = clean_cell(qualifier)
        if value:
            cleaned.append((metric, value, qualifier))

    if not cleaned:
        return ""

    def pick(predicate):
        return next((row for row in cleaned if predicate(row[2].lower())), None)

    selected = (
        pick(lambda q: ("mean" in q or "average" in q) and "range" not in q and "min" not in q and "max" not in q)
        or pick(lambda q: "average range" in q and "max" in q)
        or pick(lambda q: "average range" in q and "min" in q)
        or pick(lambda q: q.strip() == "maximum" or q.strip() == "max")
        or cleaned[0]
    )

    metric, value, _ = selected
    return f"{value}{lifespan_unit_suffix(metric, value)}".strip()


def infer_stage_rank(stage_title: str) -> tuple[int, int]:
    title = clean_cell(stage_title).lower()
    if not title:
        return (999, 0)

    rank = 500
    if any(key in title for key in ["egg", "embryo", "fertiliz"]):
        rank = 10
    elif any(key in title for key in ["nest", "incubat", "brood", "hatchling"]):
        rank = 20
    elif any(key in title for key in ["larva", "larvae", "tadpole", "fry", "alevin"]):
        rank = 30
    elif any(key in title for key in ["chick", "nestling", "fledgling"]):
        rank = 40
    elif any(key in title for key in ["juvenile", "young", "immature", "subadult", "yearling", "parr", "smolt"]):
        rank = 50
    elif any(key in title for key in ["reproductive adult", "breeding adult"]):
        rank = 80
    elif any(key in title for key in ["breeding", "reproduct", "spawn", "spawning"]):
        rank = 90
    elif any(key in title for key in ["adult", "mature"]):
        rank = 70

    reproductive_penalty = 1 if any(key in title for key in ["reproduct", "breeding", "spawn"]) else 0
    return (rank, reproductive_penalty)


def sort_stages_biologically(stages):
    enriched = []
    for idx, stage in enumerate(stages or []):
        enriched.append((infer_stage_rank(stage.get("title", "")), idx, stage))
    enriched.sort(key=lambda item: (item[0][0], item[0][1], item[1]))
    return [stage for _, _, stage in enriched]


def structured_life_history_workbook_to_species_list(raw_sheets):
    stage_sheet_name = next(
        (name for name in raw_sheets if sheet_name_matches(name, "life history stages", "lifestages")),
        None,
    )
    if not stage_sheet_name:
        return None

    species_map = {}

    def get_species_entry(scientific_name, common_name="", population=""):
        sci = clean_cell(scientific_name)
        if not sci:
            return None
        key = sci.lower()
        entry = species_map.setdefault(key, {
            "name": sci,
            "commonName": clean_cell(common_name),
            "population": clean_cell(population),
            "imageFile": None,
            "imageUrl": None,
            "lifespan": [],
            "stages": {},
        })
        if common_name and not entry["commonName"]:
            entry["commonName"] = clean_cell(common_name)
        if population and not entry["population"]:
            entry["population"] = clean_cell(population)
        return entry

    def get_stage_entry(species_entry, stage_name):
        stage = clean_cell(stage_name)
        if not species_entry or not stage:
            return None
        key = stage.lower()
        return species_entry["stages"].setdefault(key, {
            "name": stage,
            "duration_values": [],
            "duration_units": [],
            "timing_months": [],
            "timing_range": "",
            "bullets": [],
        })

    stage_df = raw_sheets[stage_sheet_name]
    for row_idx in range(2, len(stage_df.index)):
        species_entry = get_species_entry(
            sheet_cell(stage_df, row_idx, 0),
            sheet_cell(stage_df, row_idx, 1),
            sheet_cell(stage_df, row_idx, 2),
        )
        stage_entry = get_stage_entry(species_entry, sheet_cell(stage_df, row_idx, 3))
        if not stage_entry:
            continue

        duration_metric = sheet_cell(stage_df, row_idx, 6)
        duration_value = sheet_cell(stage_df, row_idx, 7)
        if duration_metric and duration_value:
            stage_entry["duration_units"].append(duration_metric)
            stage_entry["duration_values"].append(duration_value)

        timing_value = sheet_cell(stage_df, row_idx, 10)
        if timing_value:
            stage_entry["timing_months"].append(excelish_month(timing_value))

        reproductive_age_value = sheet_cell(stage_df, row_idx, 16)
        reproductive_age_metric = sheet_cell(stage_df, row_idx, 15)
        if reproductive_age_value:
            suffix = f" {reproductive_age_metric}".strip()
            stage_entry["bullets"].append(f"Reproduction age: {reproductive_age_value}{suffix}")

        reproductive_frequency_value = sheet_cell(stage_df, row_idx, 19)
        reproductive_frequency_metric = sheet_cell(stage_df, row_idx, 18)
        if reproductive_frequency_value:
            suffix = f" {reproductive_frequency_metric}".strip()
            stage_entry["bullets"].append(f"Reproductive frequency: {reproductive_frequency_value}{suffix}")

        initial_count_value = sheet_cell(stage_df, row_idx, 22)
        initial_count_metric = sheet_cell(stage_df, row_idx, 21)
        if initial_count_value:
            suffix = f" {initial_count_metric}".strip()
            stage_entry["bullets"].append(f"Initial count: {initial_count_value}{suffix}")

        repro_strategy = sheet_cell(stage_df, row_idx, 23)
        if repro_strategy:
            stage_entry["bullets"].append(f"Reproduction: {repro_strategy}")

    habitat_sheet_name = next((name for name in raw_sheets if sheet_name_matches(name, "habitat")), None)
    if habitat_sheet_name:
        habitat_df = raw_sheets[habitat_sheet_name]
        habitat_names = [sheet_cell(habitat_df, 1, col_idx) for col_idx in range(4, len(habitat_df.columns))]

        for row_idx in range(2, len(habitat_df.index)):
            species_entry = get_species_entry(
                sheet_cell(habitat_df, row_idx, 0),
                sheet_cell(habitat_df, row_idx, 1),
                sheet_cell(habitat_df, row_idx, 2),
            )
            stage_entry = get_stage_entry(species_entry, sheet_cell(habitat_df, row_idx, 3))
            if not stage_entry:
                continue

            active = []
            for offset, habitat_name in enumerate(habitat_names, start=4):
                marker = sheet_cell(habitat_df, row_idx, offset).lower()
                if marker in ("x", "yes", "true", "1"):
                    active.append(habitat_name)
            if active:
                stage_entry["bullets"].append(f"Habitat: {', '.join(active)}")

    resource_sheet_name = next((name for name in raw_sheets if sheet_name_matches(name, "resource needs")), None)
    if resource_sheet_name:
        resource_df = raw_sheets[resource_sheet_name]
        need_names = [sheet_cell(resource_df, 1, col_idx) for col_idx in range(4, len(resource_df.columns))]

        for row_idx in range(2, len(resource_df.index)):
            species_entry = get_species_entry(
                sheet_cell(resource_df, row_idx, 0),
                sheet_cell(resource_df, row_idx, 1),
                sheet_cell(resource_df, row_idx, 2),
            )
            stage_entry = get_stage_entry(species_entry, sheet_cell(resource_df, row_idx, 3))
            if not stage_entry:
                continue

            resource_pairs = []
            for offset, need_name in enumerate(need_names, start=4):
                resource_value = sheet_cell(resource_df, row_idx, offset)
                if resource_value:
                    resource_pairs.append((need_name, resource_value))
            if resource_pairs:
                stage_entry["bullets"].append(
                    f"Resource needs: {'; '.join(coalesce_label_value(resource_pairs, 4))}"
                )

    lifespan_sheet_name = next((name for name in raw_sheets if sheet_name_matches(name, "life span", "lifespan")), None)
    if lifespan_sheet_name:
        lifespan_df = raw_sheets[lifespan_sheet_name]
        for row_idx in range(1, len(lifespan_df.index)):
            species_entry = get_species_entry(
                sheet_cell(lifespan_df, row_idx, 0),
                sheet_cell(lifespan_df, row_idx, 1),
                "",
            )
            if not species_entry:
                continue

            qualifier = sheet_cell(lifespan_df, row_idx, 3)
            metric = sheet_cell(lifespan_df, row_idx, 4)
            value = sheet_cell(lifespan_df, row_idx, 5)
            if metric and value:
                species_entry["lifespan"].append((metric, value, qualifier))

    species_out = []
    for info in species_map.values():
        title_base = info["commonName"] or info["name"]
        title = f"{title_base} - Life history"
        if info["population"]:
            title = f"{title_base} ({info['population']}) - Life history"

        lifespan_text = select_lifespan_text(info["lifespan"])

        stages_out = []
        for st in info["stages"].values():
            bullets = []

            unit_suffix = f" {st['duration_units'][0]}" if st["duration_units"] else ""
            duration_text = range_text_from_values(st["duration_values"], unit_suffix)
            if duration_text:
                bullets.append(f"Duration: {duration_text}")

            months = [m for m in st["timing_months"] if m]
            timing_range = range_text_from_values(months)
            st["timing_range"] = timing_range
            if months:
                bullets.append(f"Timing: {timing_range}")

            if lifespan_text:
                bullets.append(f"Lifespan: {lifespan_text}")

            bullets.extend(st["bullets"])
            stages_out.append({
                "title": st["name"],
                "timingRange": timing_range,
                "timingMonths": list(dict.fromkeys(months)),
                "bullets": list(dict.fromkeys([b for b in bullets if b])),
            })

        stages_out = sort_stages_biologically(stages_out)

        species_out.append({
            "name": info["name"],
            "title": title,
            "imageFile": info["imageFile"],
            "imageUrl": info["imageUrl"],
            "lifespan": lifespan_text,
            "stages": stages_out,
        })

    return species_out or None


def add_bullets_from_row(df, row, species_dict, species_col, stage_col=None):
    raw_species = row[species_col]
    if pd.isna(raw_species):
        return

    s_name = str(raw_species).strip()
    if not s_name or s_name.lower() == "nan":
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
        },
    )

    stage_name = None
    if stage_col is not None and stage_col in df.columns:
        raw_stage = row[stage_col]
        if not pd.isna(raw_stage):
            tmp = str(raw_stage).strip()
            if tmp and tmp.lower() != "nan":
                stage_name = tmp

    if stage_name:
        st_key = stage_name.lower()
        stage = species_entry["stages"].setdefault(
            st_key,
            {"key": st_key, "name": stage_name, "bullets": []},
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
        if not text or text.lower() == "nan":
            continue
        bullet = f"{pretty_label(col)}: {text}"
        target_list.append(bullet)


def generic_workbook_to_species_list(sheets):
    species_dict = {}

    for _, df in sheets.items():
        if df is None or df.empty:
            continue

        normalized_cols = {normalize_col(c): c for c in df.columns}

        species_col = None
        for key, orig in normalized_cols.items():
            if "species" in key:
                species_col = orig
                break
        if not species_col:
            continue

        stage_col = None
        for key, orig in normalized_cols.items():
            if "stage" in key or "lifestage" in key or "life stage" in key:
                stage_col = orig
                break

        for _, row in df.iterrows():
            add_bullets_from_row(df, row, species_dict, species_col, stage_col)

    if not species_dict:
        return None

    species_list = []
    for info in species_dict.values():
        stages = []

        for st in info["stages"].values():
            bullets = []
            seen = set()
            for bullet in st["bullets"]:
                if bullet not in seen:
                    bullets.append(bullet)
                    seen.add(bullet)
            stages.append({"title": st["name"], "bullets": bullets})

        if info["speciesBullets"]:
            stages.insert(0, {
                "title": "Species summary",
                "bullets": list(dict.fromkeys(info["speciesBullets"])),
            })
        else:
            stages = sort_stages_biologically(stages)

        species_list.append({
            "name": info["name"],
            "title": f"{info['name']} - Life history",
            "imageFile": info.get("imageFile"),
            "imageUrl": info.get("imageUrl"),
            "stages": stages,
        })

    return species_list


def simple_template_sheet_to_species_list(df):
    if df is None or df.empty:
        return None

    cols_norm = {normalize_col(c): c for c in df.columns}

    def col(*names):
        for n in names:
            key = normalize_col(n)
            if key in cols_norm:
                return cols_norm[key]
        return None

    species_col = col("Species")
    stage_col = col("StageName", "Stage", "Life stage", "Lifestage")
    order_col = col("StageOrder", "Order")
    common_col = col("CommonName", "Common name")
    image_file_col = col("ImageFile", "Image", "Photo")
    image_url_col = col("ImageUrl", "Image URL", "PhotoUrl", "Photo URL")

    if not species_col or not stage_col:
        return None

    detail_candidates = [
        "Duration", "Timing", "Habitat", "Lifespan", "Movement",
        "Physical", "Reproduction", "Food", "Notes",
    ]
    detail_cols = [col(c) for c in detail_candidates if col(c)]

    species_map = {}

    for _, row in df.iterrows():
        raw_species = row[species_col]
        if pd.isna(raw_species):
            continue
        s_name = str(raw_species).strip()
        if not s_name or s_name.lower() == "nan":
            continue

        s_key = s_name.lower()
        sp = species_map.setdefault(
            s_key,
            {
                "name": s_name,
                "commonName": None,
                "imageFile": None,
                "imageUrl": None,
                "stages": {},
            },
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
        if not stage_name or stage_name.lower() == "nan":
            continue

        order = None
        if order_col and not pd.isna(row[order_col]):
            try:
                order = float(row[order_col])
            except Exception:
                order = None

        st_key = stage_name.lower()
        stage = sp["stages"].setdefault(
            st_key,
            {"name": stage_name, "order": order, "bullets": []},
        )

        for detail_col in detail_cols:
            val = row[detail_col]
            if pd.isna(val):
                continue
            text = str(val).strip()
            if not text or text.lower() == "nan":
                continue
            stage["bullets"].append(f"{pretty_label(detail_col)}: {text}")

    if not species_map:
        return None

    species_out = []
    for sp in species_map.values():
        stages = list(sp["stages"].values())
        stages.sort(key=lambda st: (9999 if st["order"] is None else st["order"]))
        species_out.append({
            "name": sp["name"],
            "title": f"{sp['name']} - Life history",
            "imageFile": sp["imageFile"],
            "imageUrl": sp["imageUrl"],
            "stages": sort_stages_biologically([{"title": st["name"], "bullets": st["bullets"]} for st in stages]),
        })

    return species_out


def read_excel_sheets_from_bytes(file_bytes, header=0):
    return pd.read_excel(BytesIO(file_bytes), sheet_name=None, header=header)


def merge_sheet_maps(sheet_maps):
    merged = {}
    for sheets in sheet_maps:
        for name, df in sheets.items():
            unique_name = name
            suffix = 2
            while unique_name in merged:
                unique_name = f"{name} ({suffix})"
                suffix += 1
            merged[unique_name] = df
    return merged


def dataset_response(title, species_list):
    return {"title": title, "species": species_list}
