import urllib.request
import json
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

# Optional: load .env from current directory or parent directory if present
def load_dotenv():
    env_paths = [
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(__file__), "..", ".env"),
        os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    ]
    for p in env_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("\"'")
                            if k not in os.environ:
                                os.environ[k] = v
            except Exception:
                pass

load_dotenv()

GRAFANA_URL = os.environ.get("GRAFANA_URL")
TOKEN = os.environ.get("GRAFANA_API_TOKEN")
ACCOUNT_TAG = os.environ.get("CLOUDFLARE_ACCOUNT_TAG")
JSON_PATH = os.path.join(os.path.dirname(__file__), "cloudflare-unified-dashboard.json")

headers = {
    "Content-Type": "application/json"
}
if TOKEN:
    headers["Authorization"] = f"Bearer {TOKEN}"

def deploy():
    if not GRAFANA_URL or not TOKEN:
        print("=" * 70)
        print("ERROR: Missing required environment variables.")
        print("=" * 70)
        print("Please set the following environment variables (or define them in a .env file):")
        print("  - GRAFANA_URL            : Your Grafana instance URL (e.g. https://<org>.grafana.net)")
        print("  - GRAFANA_API_TOKEN      : Your Grafana Service Account Token (glsa_...)")
        print("  - CLOUDFLARE_ACCOUNT_TAG : (Optional) Your Cloudflare Account Tag/ID")
        print()
        print("Example (PowerShell):")
        print('  $env:GRAFANA_URL="https://your-org.grafana.net"')
        print('  $env:GRAFANA_API_TOKEN="glsa_xxxx"')
        print('  $env:CLOUDFLARE_ACCOUNT_TAG="4251ceba..."')
        print("  python docs/grafana/deploy_dashboard.py")
        sys.exit(1)

    if not os.path.exists(JSON_PATH):
        print(f"Error: Dashboard JSON not found at {JSON_PATH}")
        sys.exit(1)

    with open(JSON_PATH, "r", encoding="utf-8") as f:
        dash = json.load(f)

    # If CLOUDFLARE_ACCOUNT_TAG is provided, inject it into the dashboard template variable
    if ACCOUNT_TAG:
        for v in dash.get("templating", {}).get("list", []):
            if v.get("name") == "accountTag":
                v["current"] = {
                    "selected": True,
                    "text": ACCOUNT_TAG,
                    "value": ACCOUNT_TAG
                }
                v["query"] = ACCOUNT_TAG
        print(f"Injected Cloudflare Account Tag: {ACCOUNT_TAG[:6]}...{ACCOUNT_TAG[-4:]}")

    payload = {
        "dashboard": dash,
        "overwrite": True,
        "message": "Deployed updated dashboard from deploy_dashboard.py"
    }

    url = f"{GRAFANA_URL.rstrip('/')}/api/dashboards/db"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            print("Dashboard successfully deployed to Grafana!")
            print(f"  Status : {res.get('status')}")
            print(f"  Version: {res.get('version')}")
            print(f"  URL    : {GRAFANA_URL.rstrip('/')}{res.get('url')}")
    except Exception as e:
        print(f"Failed to deploy: {e}")
        sys.exit(1)

if __name__ == "__main__":
    deploy()
