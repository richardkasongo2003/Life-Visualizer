from flask import Flask

from app.routes.ai import ai_bp
from app.routes.export import export_bp
from app.routes.main import main_bp
from app.routes.uploads import uploads_bp


def create_app() -> Flask:
    app = Flask(__name__, static_folder="../static", template_folder="../templates")

    app.register_blueprint(main_bp)
    app.register_blueprint(export_bp)
    app.register_blueprint(uploads_bp)
    app.register_blueprint(ai_bp)

    return app
