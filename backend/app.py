"""Flask application factory. Serves the JSON API and the static frontend."""
import os

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from postgrest.exceptions import APIError

from backend.config import Config
from backend.routes import auth_routes, admin_routes, inventory_routes, order_routes

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))


def create_app():
    app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
    app.config["SECRET_KEY"] = Config.SECRET_KEY
    CORS(app, resources={r"/api/*": {"origins": Config.CORS_ORIGINS}})

    for module in (auth_routes, order_routes, inventory_routes, admin_routes):
        app.register_blueprint(module.bp)

    @app.get("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.errorhandler(APIError)
    def handle_database_error(exc):
        message = getattr(exc, "message", None) or str(exc)
        app.logger.warning("Database error: %s", message)
        return jsonify({"error": f"Database error: {message}"}), 400

    @app.errorhandler(404)
    def not_found(_exc):
        return jsonify({"error": "Not found."}), 404

    @app.errorhandler(Exception)
    def handle_unexpected(exc):
        app.logger.exception("Unhandled error")
        return jsonify({"error": "Something went wrong on our side. Try again."}), 500

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=Config.DEBUG)
