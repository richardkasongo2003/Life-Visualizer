from flask import Blueprint, jsonify, request

from app.services.excel_parser import (
    dataset_response,
    generic_workbook_to_species_list,
    merge_sheet_maps,
    read_excel_sheets_from_bytes,
    structured_life_history_workbook_to_species_list,
)


uploads_bp = Blueprint("uploads", __name__)


@uploads_bp.route("/upload_excel_multi", methods=["POST"])
def upload_excel_multi():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No worksheet files uploaded"}), 400

    try:
        raw_sheet_maps = []
        standard_sheet_maps = []

        for file in files:
            file_bytes = file.read()
            if not file_bytes:
                continue
            raw_sheet_maps.append(read_excel_sheets_from_bytes(file_bytes, header=None))
            standard_sheet_maps.append(read_excel_sheets_from_bytes(file_bytes, header=0))
    except Exception as e:
        return jsonify({"error": f"Could not read Excel files: {e}"}), 400

    if not raw_sheet_maps:
        return jsonify({"error": "Uploaded worksheet files were empty"}), 400

    merged_raw_sheets = merge_sheet_maps(raw_sheet_maps)
    merged_standard_sheets = merge_sheet_maps(standard_sheet_maps)

    species_list = structured_life_history_workbook_to_species_list(merged_raw_sheets)
    if not species_list:
        species_list = generic_workbook_to_species_list(merged_standard_sheets)

    if not species_list:
        return jsonify({"error": "Could not extract species and stage data from the uploaded worksheets"}), 400

    return jsonify(dataset_response("Life History Worksheets", species_list))


@uploads_bp.route("/upload_excel_single", methods=["POST"])
def upload_excel_single():
    if "file" not in request.files:
        return jsonify({"error": "No worksheet file uploaded"}), 400

    file = request.files["file"]

    try:
        file_bytes = file.read()
        if not file_bytes:
            return jsonify({"error": "Uploaded worksheet file was empty"}), 400
        raw_sheets = read_excel_sheets_from_bytes(file_bytes, header=None)
        standard_sheets = read_excel_sheets_from_bytes(file_bytes, header=0)
    except Exception as e:
        return jsonify({"error": f"Could not read Excel file: {e}"}), 400

    species_list = structured_life_history_workbook_to_species_list(raw_sheets)
    if not species_list:
        species_list = generic_workbook_to_species_list(standard_sheets)

    if not species_list:
        return jsonify({"error": "Could not extract a life-history diagram from this worksheet"}), 400

    return jsonify(dataset_response("Life History Worksheet", species_list))
