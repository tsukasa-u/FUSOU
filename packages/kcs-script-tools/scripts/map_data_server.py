import http.server
import os
import re
import urllib.parse

PORT = 8085
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "tools"))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
PUBLIC_MAP_DIR = os.path.abspath(
    os.path.join(REPO_ROOT, "packages", "FUSOU-WEB", "public", "battle-maps")
)


def safe_join(base_dir: str, rel_path: str) -> str | None:
    if not rel_path:
        return None

    normalized_rel = rel_path.replace("\\", "/")
    if normalized_rel.startswith("/") or re.match(r"^[A-Za-z]:", normalized_rel):
        return None

    parts = [part for part in normalized_rel.split("/") if part not in ("", ".")]
    if any(part == ".." for part in parts):
        return None

    abs_base = os.path.realpath(base_dir)
    target = os.path.realpath(os.path.join(abs_base, *parts))
    try:
        if os.path.commonpath([abs_base, target]) == abs_base:
            return target
    except ValueError:
        return None
    return None


class MapDataHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        url_path = urllib.parse.urlsplit(self.path).path.lstrip("/")

        if url_path in ("", "map-data-viewer.html"):
            target_file = safe_join(TOOLS_DIR, "map-data-viewer.html")
        elif url_path == "battle-maps/maps_metadata.json":
            target_file = safe_join(PUBLIC_MAP_DIR, "maps_metadata.json")
        elif re.fullmatch(r"battle-maps/\d+-\d+/data\.json", url_path):
            target_file = safe_join(PUBLIC_MAP_DIR, url_path[len("battle-maps/"):])
        else:
            target_file = None

        if not target_file or not os.path.isfile(target_file):
            self.send_error(404)
            return

        content_type = (
            "text/html; charset=utf-8"
            if target_file.endswith(".html")
            else "application/json; charset=utf-8"
        )
        with open(target_file, "rb") as file:
            content = file.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), MapDataHandler)
    print(f"Map data viewer running at http://127.0.0.1:{PORT}/")
    server.serve_forever()
