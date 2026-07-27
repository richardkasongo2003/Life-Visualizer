from flask import Blueprint, jsonify, request, send_file

from app.services.pptx_exporter import generate_pptx_file


export_bp = Blueprint("export", __name__)


@export_bp.route("/generate_pptx", methods=["POST"])
def generate_pptx():
    data = request.get_json()
    if not data or "image_b64" not in data:
        return jsonify({"error": "Missing image_b64"}), 400

    out, safe_title = generate_pptx_file(data.get("title", "Export"), data["image_b64"])
    return send_file(
        out,
        as_attachment=True,
        download_name=f"{safe_title}.pptx",
        mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
