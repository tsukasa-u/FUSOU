import http.server
import json
import base64
import os
import subprocess
import mimetypes

PORT = 8085
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "tools"))
PKG_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))

BASE_MAP_DIR = os.path.join(REPO_ROOT, "packages", "FUSOU-WEB", "src", "assets", "map")
PUBLIC_MAP_DIR = os.path.join(REPO_ROOT, "packages", "FUSOU-WEB", "public", "battle-maps")
CONVERT_SCRIPT = os.path.join(SCRIPT_DIR, "convert.py")

class MaskHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        # Serve tools and map assets
        url_path = self.path.split("?")[0].lstrip("/")
        
        target_file = None
        if url_path in ("map-mask-editor.html", "map-compare.html", ""):
            filename = url_path if url_path else "map-mask-editor.html"
            target_file = os.path.join(TOOLS_DIR, filename)
        elif url_path.startswith("battle-maps/"):
            rel = url_path[len("battle-maps/"):]
            target_file = os.path.join(PUBLIC_MAP_DIR, rel)
        elif url_path.startswith("src/assets/map/"):
            rel = url_path[len("src/assets/map/"):]
            target_file = os.path.join(BASE_MAP_DIR, rel)
        elif url_path.startswith("tools/"):
            rel = url_path[len("tools/"):]
            target_file = os.path.join(TOOLS_DIR, rel)

        if target_file and os.path.isfile(target_file):
            self.send_response(200)
            mime, _ = mimetypes.guess_type(target_file)
            self.send_header("Content-Type", mime or "application/octet-stream")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            with open(target_file, "rb") as f:
                self.wfile.write(f.read())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/save_mask":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode("utf-8"))
                map_id = data.get("mapId", "3-5")
                b64_str = data.get("imageBase64", "")
                if "," in b64_str:
                    b64_str = b64_str.split(",")[1]

                img_bytes = base64.b64decode(b64_str)

                # 1. src/assets/map/<map_id>/land_mask.png に保存 (正本)
                target_src = os.path.join(BASE_MAP_DIR, map_id, "land_mask.png")
                os.makedirs(os.path.dirname(target_src), exist_ok=True)
                with open(target_src, "wb") as f:
                    f.write(img_bytes)

                print(f"[Server] Saved land_mask.png for {map_id} at {target_src}")

                # 2. convert.py を再実行してマップ画像とデータを再生成
                subprocess.run(["python", CONVERT_SCRIPT, map_id], cwd=SCRIPT_DIR, check=False)
                print(f"[Server] Re-generated battle-maps for {map_id} successfully")

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    server = http.server.HTTPServer(("127.0.0.1", PORT), MaskHandler)
    print(f"Mask Editor Server running on http://127.0.0.1:{PORT}")
    server.serve_forever()
