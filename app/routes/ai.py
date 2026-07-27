from flask import Blueprint, jsonify, request

from app.services.ai_enhancer import enhance_life_history_data


ai_bp = Blueprint("ai", __name__)


@ai_bp.route("/ai_enhance", methods=["POST"])
def ai_enhance():
    try:
        payload = request.get_json()
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    if not payload or "stages" not in payload:
        return jsonify({"error": "Missing stages in payload"}), 400

    try:
        enhanced = enhance_life_history_data(
            payload.get("title", "Life history"),
            payload.get("stages", []),
        )
    except Exception as e:
        return jsonify({"error": f"AI enhancement failed: {e}"}), 500

    if "stages" not in enhanced or not isinstance(enhanced["stages"], list):
        return jsonify({"error": "AI returned invalid structure"}), 500

    return jsonify(enhanced)
