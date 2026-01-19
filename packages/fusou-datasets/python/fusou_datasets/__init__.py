"""
Fusou Datasets
==============

Secure data loader for FUSOU research datasets with Device Trust authentication.

Usage:
    import fusou_datasets
    
    # Show usage guide
    fusou_datasets.help()
    
    # API key is loaded automatically from:
    # 1. Environment variable: FUSOU_API_KEY
    # 2. Config file: ~/.fusou-datasets/settings.json
    
    # List and load data
    tables = fusou_datasets.list_tables()
    df = fusou_datasets.load("ship_type")
    
    # Enable caching (optional)
    fusou_datasets.configure(cache_dir="~/.fusou_datasets/cache")
    df = fusou_datasets.load("ship_type")  # Cached locally
    df = fusou_datasets.load("ship_type", offline=True)  # Use cache without server check

Google Colab:
    In Google Colab, if your Google account email matches the API key email,
    device verification will be automatic (no code input required).
"""

import json
import os
import sys
import time
import uuid
import re
from importlib.metadata import version, PackageNotFoundError
from io import BytesIO
from pathlib import Path
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin

import fastavro
import pandas as pd
import requests
from tqdm import tqdm

# =============================================================================
# Configuration
# =============================================================================

try:
    __version__ = version("fusou-datasets")
except PackageNotFoundError:
    # If package is not installed (e.g. dev mode), read from pyproject.toml
    try:
        _pyproject = Path(__file__).resolve().parent.parent / "pyproject.toml"
        with open(_pyproject, "r", encoding="utf-8") as _f:
            # Simple regex to find version = "x.y.z"
            _match = re.search(r'^version\s*=\s*"(.*?)"', _f.read(), re.MULTILINE)
            __version__ = _match.group(1) if _match else "0.0.0"
    except Exception:
        __version__ = "0.0.0"
__author__ = "FUSOU Team"
__all__ = [
    "configure",
    "save_api_key",
    "list_tables",
    "list_period_tags",
    "load",
    "clear_cache",
    # Master data helpers
    "list_master_tables",
    "get_master_latest",
    "load_master",
    "get_client_id",
    "FusouDatasetsError",
    "AuthenticationError",
    "DeviceUnverifiedError",
    "DatasetNotFoundError",
    "Tables",
    "query",
    "register_relationship",
    "show_welcome_message",
    "help",
]

DEFAULT_API_URL = os.getenv("FUSOU_API_URL", "https://r2-parquet.fusou.pages.dev/api/data-loader")
SETTINGS_DIR = Path.home() / ".fusou-datasets"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"
REQUEST_TIMEOUT = 30
DOWNLOAD_TIMEOUT = 300

_config: Dict[str, Any] = {"api_key": None, "api_url": DEFAULT_API_URL}

# =============================================================================
# Terms of Service (shown on import)
# =============================================================================

_TERMS = """
================================================================================
Fusou Datasets v{version}
================================================================================
[EN] By using this library, you agree to use data for research purposes only.
     Redistribution of raw data is prohibited. Visit: https://fusou.dev/terms
[JP] このライブラリを使用することで、データを研究目的のみに使用することに同意します。
     生データの再配布は禁止です。詳細: https://fusou.dev/terms
--------------------------------------------------------------------------------
Get your API Key at: https://fusou.dev/dashboard/api-keys
================================================================================
"""
def show_welcome_message():
    """Show the welcome message and license information."""
    if not os.getenv("FUSOU_DATASETS_SILENT"):
        print(_TERMS.format(version=__version__), file=sys.stderr)

# Show welcome message on import
show_welcome_message()



# =============================================================================
# Exceptions
# =============================================================================

class FusouDatasetsError(Exception):
    """Base exception."""
    pass

class AuthenticationError(FusouDatasetsError):
    """Invalid or missing API key."""
    pass

class DeviceUnverifiedError(FusouDatasetsError):
    """Device requires verification."""
    pass

class DatasetNotFoundError(FusouDatasetsError):
    """Dataset not found."""
    pass


class VerificationError(FusouDatasetsError):
    """Verification failed."""
    pass


# =============================================================================
# Constants
# =============================================================================

from .schema import Tables
from .query_engine import query, register_relationship



# =============================================================================
# Environment Detection
# =============================================================================

def _is_colab() -> bool:
    """Check if running in Google Colab."""
    try:
        import google.colab  # noqa: F401
        return True
    except ImportError:
        return False


def _get_colab_credentials() -> Optional[Dict[str, str]]:
    """
    Get Google account credentials from Colab.
    Returns dict with 'email' and optionally 'token'.
    """
    if not _is_colab():
        return None
    
    try:
        from google.colab import auth
        auth.authenticate_user()
        
        # Get credentials
        import google.auth
        from google.auth.transport.requests import Request
        creds, _ = google.auth.default()
        
        # Refresh token if needed
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        
        # Get user info
        resp = requests.get(
            "https://www.googleapis.com/oauth2/v1/userinfo",
            headers={"Authorization": f"Bearer {creds.token}"},
            timeout=10,
        )
        
        if resp.ok:
            user_info = resp.json()
            return {
                "email": user_info.get("email"),
                "token": creds.token,
            }
    except Exception as e:
        print(f"[fusou_datasets] Colab auth failed: {e}", file=sys.stderr)
    
    return None


# =============================================================================
# Configuration
# =============================================================================

def configure(
    api_key: Optional[str] = None,
    api_url: Optional[str] = None,
    cache_dir: Optional[str] = None,
) -> None:
    """
    Configure API credentials and caching.
    
    Args:
        api_key: API key for authentication
        api_url: Custom API URL (optional)
        cache_dir: Directory for local data caching (enables caching when set)
    """
    if api_key:
        _config["api_key"] = api_key
    if api_url:
        _config["api_url"] = api_url
    if cache_dir is not None:
        # Expand ~ and resolve path
        _config["cache_dir"] = str(Path(cache_dir).expanduser().resolve())


def save_api_key(api_key: str) -> None:
    """Save API key to config file for persistent use."""
    _ensure_settings_dir()
    settings = _load_settings()
    settings["api_key"] = api_key
    _save_settings(settings)
    _config["api_key"] = api_key


def _ensure_settings_dir() -> None:
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)


def _load_settings() -> Dict[str, Any]:
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def _save_settings(settings: Dict[str, Any]) -> None:
    _ensure_settings_dir()
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)


def _get_api_key() -> str:
    if _config.get("api_key"):
        return _config["api_key"]
    
    env_key = os.environ.get("FUSOU_API_KEY")
    if env_key:
        return env_key
    
    settings = _load_settings()
    if settings.get("api_key"):
        return settings["api_key"]
    
    raise AuthenticationError(
        "❌ API key not configured / APIキーが設定されていません\n\n"
        "To fix this, do ONE of the following:\n"
        "  1. Set environment variable: export FUSOU_API_KEY='your_key'\n"
        "  2. Save it permanently: fusou_datasets.save_api_key('your_key')\n"
        "  3. Configure in code: fusou_datasets.configure(api_key='your_key')\n\n"
        "📝 Get your API key at: https://fusou.dev/dashboard/api-keys"
    )



def _get_client_id() -> str:
    settings = _load_settings()
    if "client_id" in settings:
        return settings["client_id"]
    
    client_id = str(uuid.uuid4())
    settings["client_id"] = client_id
    _save_settings(settings)
    return client_id


def get_client_id() -> str:
    """Get the current device's client ID."""
    return _get_client_id()


# =============================================================================
# API Client
# =============================================================================

def _request(method: str, endpoint: str, json_data: Optional[dict] = None, timeout: int = REQUEST_TIMEOUT) -> requests.Response:
    api_key = _get_api_key()
    client_id = _get_client_id()
    api_url = _config.get("api_url", DEFAULT_API_URL)
    url = f"{api_url.rstrip('/')}/{endpoint.lstrip('/')}"
    
    max_retries = 3
    for attempt in range(max_retries + 1):
        try:
            resp = requests.request(
                method=method,
                url=url,
                headers={
                    "X-API-KEY": api_key,
                    "X-CLIENT-ID": client_id,
                    "Content-Type": "application/json",
                    "User-Agent": f"FusouDatasets/{__version__}",
                },
                json=json_data,
                timeout=timeout,
            )
            
            # Rate Limit Retry Logic
            if resp.status_code == 429:
                retry_after_val = resp.headers.get("Retry-After")
                wait_time = 1  # default
                if retry_after_val:
                    try:
                        wait_time = int(retry_after_val) + 1 # Add buffer
                    except ValueError:
                        pass
                
                if attempt < max_retries:
                    print(f"Rate limit exceeded. Waiting {wait_time}s... (Attempt {attempt+1}/{max_retries})", file=sys.stderr)
                    time.sleep(wait_time)
                    continue
                else:
                    print("Max retries exceeded for rate limit.", file=sys.stderr)
            
            return resp

        except requests.exceptions.RequestException as e:
            # Maybe retry on connection error too?
            if attempt < max_retries:
                 print(f"Connection error: {e}. Retrying...", file=sys.stderr)
                 time.sleep(2)
                 continue
            raise FusouDatasetsError(f"Request failed: {e}")

    # Should not reach here
    raise FusouDatasetsError("Request failed after retries")



def _verify_device_colab() -> bool:
    """Try to verify device using Google Colab credentials."""
    creds = _get_colab_credentials()
    if not creds or not creds.get("email"):
        return False
    
    print(f"[fusou_datasets] Attempting Colab verification with: {creds['email']}", file=sys.stderr)
    
    try:
        resp = _request("POST", "/verify-google", {
            "email": creds["email"],
            "google_token": creds.get("token"),
        })
        
        if resp.status_code == 200:
            print(f"✓ Device verified via Google account: {creds['email']}", file=sys.stderr)
            return True
        
        try:
            error_data = resp.json()
            if error_data.get("error") == "EMAIL_MISMATCH":
                print(
                    f"✗ Google account ({creds['email']}) does not match API key email.",
                    file=sys.stderr,
                )
                print("  Falling back to code verification...", file=sys.stderr)
        except json.JSONDecodeError:
            # Non-JSON error response; ignore structured parsing and fall back to generic failure.
            pass
    except Exception as e:
        print(f"[fusou_datasets] Colab verification failed: {e}", file=sys.stderr)
    
    return False


def _verify_device_code() -> bool:
    """Verify device using email code (interactive)."""
    print("\n" + "=" * 60, file=sys.stderr)
    print("🔐 DEVICE VERIFICATION REQUIRED / デバイス認証が必要です", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print("", file=sys.stderr)
    print("[EN] This is a new device. A 6-digit verification code has been", file=sys.stderr)
    print("     sent to your email address registered with your API key.", file=sys.stderr)
    print("", file=sys.stderr)
    print("[JP] 新しいデバイスからのアクセスです。APIキーに登録された", file=sys.stderr)
    print("     メールアドレスに6桁の認証コードを送信しました。", file=sys.stderr)
    print("", file=sys.stderr)
    print("📧 Check your email from: noreply@fusou.dev", file=sys.stderr)
    print("   Subject: [FUSOU] Device Verification Code", file=sys.stderr)
    print("", file=sys.stderr)
    print("💡 Tips / ヒント:", file=sys.stderr)
    print("   - Check spam/junk folder / 迷惑メールフォルダを確認", file=sys.stderr)
    print("   - Code expires in 10 minutes / コードは10分で有効期限切れ", file=sys.stderr)
    print("   - Get API key: https://fusou.dev/dashboard/api-keys", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    
    for attempt in range(3):
        try:
            code = input(f"Code ({attempt+1}/3): ").strip()
        except (EOFError, KeyboardInterrupt):
            raise VerificationError(
                "\n\nℹ️ Verification cancelled / 認証がキャンセルされました\n\n"
                "To continue, call any API function again (e.g., fusou_datasets.list_tables())\n"
                "A new verification code will be sent to your email."
            )
        
        if not code:
            continue
        
        resp = _request("POST", "/verify", {"code": code})
        if resp.status_code == 200:
            print("✓ Device verified!", file=sys.stderr)
            return True
        print("✗ Invalid code", file=sys.stderr)
    
    raise VerificationError(
        "❌ Max verification attempts exceeded / 認証試行回数を超えました\n\n"
        "You can:\n"
        "  1. Restart and try again: fusou_datasets.list_tables()\n"
        "  2. Request a new code (automatically sent on next API call)\n"
        "  3. Check your email for the latest code from noreply@fusou.dev"
    )


def _verify_device() -> bool:
    """
    Verify device - tries Colab auth first, then falls back to code input.
    """
    # Try Colab verification first
    if _is_colab():
        if _verify_device_colab():
            return True
    
    # Fall back to code verification
    return _verify_device_code()


def _handle_403(response: requests.Response, retry_func, *args, **kwargs):
    try:
        data = response.json()
        if data.get("error") == "DEVICE_UNVERIFIED":
            _verify_device()
            return retry_func(*args, **kwargs, _retry=False)
        elif data.get("error") == "INVALID_API_KEY":
            raise AuthenticationError(
                "❌ Invalid or inactive API key / 無効なAPIキーです\n\n"
                "Possible causes:\n"
                "  - API key was revoked or deleted\n"
                "  - API key is incorrect (copy-paste error)\n\n"
                "To fix:\n"
                "  1. Check your API key at: https://fusou.dev/dashboard/api-keys\n"
                "  2. Update it: fusou_datasets.save_api_key('your_new_key')"
            )
    except json.JSONDecodeError:
        pass
    raise AuthenticationError(
        "❌ Access denied / アクセスが拒否されました\n\n"
        "Please check:\n"
        "  1. Your API key is valid: https://fusou.dev/dashboard/api-keys\n"
        "  2. Your account is active\n"
        "  3. You have the required permissions"
    )


def _download_avro(url: str, _retry: bool = True) -> pd.DataFrame:
    api_key = _get_api_key()
    client_id = _get_client_id()
    api_url = _config.get("api_url", DEFAULT_API_URL)
    
    if url.startswith("/"):
        # Use urljoin for robust URL construction
        base_url = api_url.rsplit("/api/", 1)[0] if "/api/" in api_url else api_url
        url = urljoin(base_url + "/", url.lstrip("/"))
    
    max_retries = 3
    for attempt in range(max_retries + 1):
        try:
            resp = requests.get(
                url,
                headers={"X-API-KEY": api_key, "X-CLIENT-ID": client_id},
                timeout=DOWNLOAD_TIMEOUT,
            )
            
            # Rate Limit Retry Logic
            if resp.status_code == 429:
                retry_after_val = resp.headers.get("Retry-After")
                wait_time = 1  # default
                if retry_after_val:
                    try:
                        wait_time = int(retry_after_val) + 1 # Add buffer
                    except ValueError:
                        pass
                
                if attempt < max_retries:
                    print(f"Rate limit exceeded (download). Waiting {wait_time}s... ({attempt+1}/{max_retries})", file=sys.stderr)
                    time.sleep(wait_time)
                    continue
            
            # Handle device verification required
            if resp.status_code == 403 and _retry:
                return _handle_403(resp, lambda: _download_avro(url, _retry=False))
            
            resp.raise_for_status()
            return pd.DataFrame.from_records(list(fastavro.reader(BytesIO(resp.content))))

        except requests.exceptions.RequestException as e:
            # Maybe retry on connection error too?
            if attempt < max_retries:
                 print(f"Download connection error: {e}. Retrying...", file=sys.stderr)
                 time.sleep(2)
                 continue
            raise FusouDatasetsError(f"Download failed: {e}")

    raise FusouDatasetsError("Download failed after retries")



# =============================================================================
# Public API
# =============================================================================

def _parse_error_response(resp: requests.Response) -> str:
    """Parse error response and return a helpful error message."""
    try:
        data = resp.json()
        error_code = data.get("error", "UNKNOWN")
        message = data.get("message", "")
        if message:
            return f"{error_code}: {message}"
        return error_code
    except (json.JSONDecodeError, ValueError):
        return resp.text[:200] if resp.text else f"HTTP {resp.status_code}"


def _raise_api_error(resp: requests.Response, context: str = "") -> None:
    """Raise appropriate exception based on response status."""
    error_detail = _parse_error_response(resp)
    
    if resp.status_code == 500:
        raise FusouDatasetsError(
            f"Server error ({context}): {error_detail}\n"
            "This may be a temporary issue. Please try again later.\n"
            "If the problem persists, contact support: https://fusou.dev/support"
        )
    elif resp.status_code == 401:
        raise AuthenticationError(
            f"Authentication failed: {error_detail}\n"
            "Make sure your API key is valid. Get one at: https://fusou.dev/dashboard/api-keys"
        )
    elif resp.status_code == 404:
        raise DatasetNotFoundError(f"Not found: {error_detail}")
    else:
        raise FusouDatasetsError(f"Request failed ({context}): HTTP {resp.status_code} - {error_detail}")


# =============================================================================
# Master Data (JWT-protected endpoints)
# =============================================================================

_MASTER_TABLES = [
    'mst_ship',
    'mst_shipgraph',
    'mst_slotitem',
    'mst_slotitem_equiptype',
    'mst_payitem',
    'mst_equip_exslot',
    'mst_bgm',
    'mst_furniture',
    'mst_bgm_season',
    'mst_mapbgm',
    'mst_const',
    'mst_mission',
]


def list_master_tables() -> List[str]:
    """Return allowed master-data table names."""
    return list(_MASTER_TABLES)


def get_master_latest() -> Dict[str, Any]:
    """Get latest master-data metadata (period_tag) via data loader.

    Returns dict with keys: period_tag (str or None)
    """
    # Use data loader to list available master tables
    try:
        resp = _request("GET", "/tables")
        if resp.status_code != 200:
            raise FusouDatasetsError(f"Failed to list tables: HTTP {resp.status_code}")
        data = resp.json()
        tables = data.get("tables", [])
        # Filter master tables (mst_*)
        master_tables = [t for t in tables if t.startswith("mst_")]
        if not master_tables:
            return {"exists": False, "period_tag": None}
        
        # Get latest period for the first master table
        first_table = master_tables[0]
        resp2 = _request("GET", f"/data/{first_table}?period_tag=latest&limit=1")
        if resp2.status_code == 404:
            return {"exists": False, "period_tag": None}
        if resp2.status_code != 200:
            raise FusouDatasetsError(f"Failed to fetch master data: HTTP {resp2.status_code}")
        
        result = resp2.json()
        period_tag = result.get("period_tag")
        return {"exists": True, "period_tag": period_tag}
    except Exception as e:
        raise FusouDatasetsError(f"Failed to get master latest: {e}")


def load_master(table: str, period_tag: str = "latest") -> pd.DataFrame:
    """Load a master-data table as pandas DataFrame via data loader.

    Args:
        table: table name (see list_master_tables())
        period_tag: 'latest' or specific period tag
    """
    if table not in _MASTER_TABLES:
        raise ValueError(f"Unknown master table '{table}'. Use list_master_tables().")

    # Use data loader /data/:table endpoint
    resp = _request("GET", f"/data/{table}?period_tag={period_tag}&limit=1")
    
    if resp.status_code == 404:
        raise DatasetNotFoundError(f"No master-data available for table '{table}' with period_tag='{period_tag}'")
    if resp.status_code != 200:
        _raise_api_error(resp, f"load_master/{table}")
    
    data = resp.json()
    files = data.get("files", [])
    if not files:
        raise DatasetNotFoundError(f"No files found for master table '{table}'")
    
    # Download the file
    download_url = files[0].get("download_url")
    if not download_url:
        raise FusouDatasetsError("Missing download_url in response")
    
    return _download_avro(download_url)


def list_tables(_retry: bool = True) -> List[str]:
    """List available tables."""
    resp = _request("GET", "/tables")
    if resp.status_code == 403 and _retry:
        return _handle_403(resp, list_tables)
    if resp.status_code != 200:
        _raise_api_error(resp, "list_tables")
    return resp.json().get("tables", [])


def list_period_tags(_retry: bool = True) -> Dict[str, Any]:
    """
    List available period tags.
    
    Returns:
        Dict with 'period_tags' (list) and 'latest' (str)
    """
    resp = _request("GET", "/period-tags")
    if resp.status_code == 403 and _retry:
        return _handle_403(resp, list_period_tags)
    if resp.status_code != 200:
        _raise_api_error(resp, "list_period_tags")
    data = resp.json()
    return {"period_tags": data.get("period_tags", []), "latest": data.get("latest")}


def _load_impl(table: str, period_tag: str = "latest", limit: int = 100, show_progress: bool = True, _retry: bool = True) -> pd.DataFrame:
    """Internal implementation of load() with retry parameter."""
    if not table:
        raise ValueError("Table name required")
    
    resp = _request("GET", f"/data/{table}?period_tag={period_tag}&limit={limit}")
    
    if resp.status_code == 403 and _retry:
        return _handle_403(resp, lambda: _load_impl(table, period_tag, limit, show_progress, _retry=False))
    if resp.status_code == 404:
        raise DatasetNotFoundError(
            f"❌ No data found for table '{table}' with period_tag='{period_tag}'\n\n"
            "Tips:\n"
            "  1. Check available tables: fusou_datasets.list_tables()\n"
            "  2. Check available periods: fusou_datasets.list_period_tags()\n"
            "  3. Try: fusou_datasets.load(table, period_tag='all')"
        )
    if resp.status_code != 200:
        _raise_api_error(resp, f"load/{table}")
    
    files = resp.json().get("files", [])
    if not files:
        raise DatasetNotFoundError(
            f"❌ No files found for table '{table}'\n\n"
            "The table exists but has no data files yet.\n"
            "Check available tables: fusou_datasets.list_tables()"
        )
    
    dfs = []
    file_iter = tqdm(files, desc=f"Loading {table}", unit="file", disable=not show_progress)
    for f in file_iter:
        url = f.get("download_url")
        if url:
            try:
                dfs.append(_download_avro(url))
            except Exception as e:
                print(f"Warning: {f.get('file_path')}: {e}", file=sys.stderr)
    
    if not dfs:
        raise FusouDatasetsError("No files downloaded")
    return pd.concat(dfs, ignore_index=True)


def _download_files(files: list, table: str, show_progress: bool = True) -> pd.DataFrame:
    """Download files and return combined DataFrame."""
    if not files:
        raise DatasetNotFoundError(f"No files to download for table '{table}'")
    
    dfs = []
    api_url = _config.get("api_url", DEFAULT_API_URL)
    # Parse base URL from api_url (e.g. https://domain.com/api -> https://domain.com)
    import urllib.parse
    parsed = urllib.parse.urlparse(api_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    file_iter = tqdm(files, desc=f"Loading {table}", unit="file", disable=not show_progress)
    for f in file_iter:
        url = f.get("download_url")
        if url and url.startswith("/"):
            url = f"{base_url}{url}"
            
        if url:
            try:
                dfs.append(_download_avro(url))
            except Exception as e:
                msg = f"Warning: Failed to download {f.get('file_path')}\n  URL: {url}\n  Error: {str(e)}"
                if hasattr(e, 'response') and e.response:
                     msg += f"\n  Status: {e.response.status_code}\n  Response: {e.response.text[:200]}"
                print(msg, file=sys.stderr)
    
    if not dfs:
        raise FusouDatasetsError(
            f"No files downloaded (out of {len(files)} files).\n"
            "This usually indicates a network issue, permission problem, or server-side error.\n"
            "Check the warnings above for specific details."
        )
    return pd.concat(dfs, ignore_index=True)


def _load_impl_with_files(
    table: str,
    period_tag: str,
    limit: int,
    show_progress: bool,
    scope: str,
    _retry: bool
) -> tuple:
    """Load implementation that returns (DataFrame, files_list) tuple."""
    if not table:
        raise ValueError("Table name required")
    
    resp = _request("GET", f"/data/{table}?period_tag={period_tag}&limit={limit}&scope={scope}")
    
    if resp.status_code == 403 and _retry:
        return _handle_403(resp, lambda: _load_impl_with_files(table, period_tag, limit, show_progress, scope, _retry=False))
    if resp.status_code == 404:
        raise DatasetNotFoundError(
            f"❌ No data found for table '{table}' with period_tag='{period_tag}'\n\n"
            "Tips:\n"
            "  1. Check available tables: fusou_datasets.list_tables()\n"
            "  2. Check available periods: fusou_datasets.list_period_tags()\n"
            "  3. Try: fusou_datasets.load(table, period_tag='all')"
        )
    if resp.status_code != 200:
        _raise_api_error(resp, f"load/{table}")
    
    files = resp.json().get("files", [])
    if not files:
        raise DatasetNotFoundError(
            f"❌ No files found for table '{table}'\n\n"
            "The table exists but has no data files yet.\n"
            "Check available tables: fusou_datasets.list_tables()"
        )
    
    df = _download_files(files, table, show_progress)
    return df, files


def load(
    table: str,
    period_tag: str = "latest",
    limit: int = 100,
    show_progress: bool = True,
    force_download: bool = False,
    offline: bool = False,
    scope: str = "all"
) -> pd.DataFrame:
    """
    Load data for a table.
    
    Args:
        table: Table name (use list_tables() to see options)
        period_tag: "latest", "all", or specific tag
        limit: Max files to load
        show_progress: Show download progress bar
        force_download: Force re-download even if cached
        offline: Use cached data without server validation
        scope: "all" (all users' data, default) or "own" (your uploads only)
        
    Returns:
        pd.DataFrame: Combined data from all matching files
    """
    cache_dir = _config.get("cache_dir")
    
    # Validate scope parameter
    if scope not in ("own", "all"):
        raise ValueError(f"scope must be 'own' or 'all', got '{scope}'")
    
    # If caching enabled and not forcing download
    if cache_dir and not force_download:
        cache_path = Path(cache_dir) / table / period_tag
        manifest_path = cache_path / "manifest.json"
        data_path = cache_path / "data.parquet"
        
        if data_path.exists() and manifest_path.exists():
            if offline:
                # Offline mode: use cache without validation
                print(f"[Cache] Loading {table} from cache (offline)", file=sys.stderr)
                return pd.read_parquet(data_path)
            
            # Online mode: validate cache with server
            try:
                # Cache validation
                resp = _request("GET", f"/data/{table}?period_tag={period_tag}&limit={limit}&scope={scope}")
                if resp.status_code == 200:
                    files = resp.json().get("files", [])
                    current_hash = _compute_files_hash(files)
                    
                    with open(manifest_path, "r") as f:
                        manifest = json.load(f)
                    
                    if manifest.get("hash") == current_hash:
                        print(f"[Cache] Loading {table} from cache (valid)", file=sys.stderr)
                        return pd.read_parquet(data_path)
                    else:
                        print(f"[Cache] Data updated, re-downloading {table}", file=sys.stderr)
                        # Use existing files list for download and cache
                        df = _download_files(files, table, show_progress)
                        _save_to_cache(table, period_tag, df, files)
                        return df
            except Exception as e:
                print(f"[Cache] Validation failed, re-downloading: {e}", file=sys.stderr)
        elif offline:
            # Offline mode but no cache exists
            raise DatasetNotFoundError(
                f"❌ No cached data for '{table}' (period_tag='{period_tag}')\n\n"
                "Offline mode requires cached data. To fix:\n"
                f"  1. Run: fusou_datasets.load('{table}', period_tag='{period_tag}')\n"
                "  2. Then use: fusou_datasets.load(..., offline=True)\n\n"
                "💡 Tip: Make sure cache_dir is configured:\n"
                "   fusou_datasets.configure(cache_dir='~/.fusou_datasets/cache')"
            )
    elif offline:
        # Offline mode but cache_dir not configured
        raise DatasetNotFoundError(
            "❌ Offline mode requires cache configuration\n\n"
            "To use offline mode:\n"
            "  1. Configure cache: fusou_datasets.configure(cache_dir='~/.fusou_datasets/cache')\n"
            f"  2. Load data once: fusou_datasets.load('{table}')\n"
            "  3. Then use: fusou_datasets.load(..., offline=True)"
        )
    
    # Download data (no cache or cache miss)
    df, files = _load_impl_with_files(table, period_tag, limit, show_progress, scope, _retry=True)
    
    # Save to cache if enabled
    if cache_dir:
        _save_to_cache(table, period_tag, df, files)
    
    return df


def _compute_files_hash(files: list) -> str:
    """Compute hash from file metadata for cache validation."""
    import hashlib
    # Sort by id to ensure consistent ordering
    sorted_files = sorted(files, key=lambda f: f.get("id", ""))
    # Create hash from id, size, record_count
    hash_input = "|".join(
        f"{f.get('id')}:{f.get('size')}:{f.get('record_count')}"
        for f in sorted_files
    )
    return hashlib.sha256(hash_input.encode()).hexdigest()[:16]


def _save_to_cache(table: str, period_tag: str, df: pd.DataFrame, files: list) -> None:
    """Save DataFrame to local cache."""
    cache_dir = _config.get("cache_dir")
    if not cache_dir:
        return
    
    try:
        cache_path = Path(cache_dir) / table / period_tag
        cache_path.mkdir(parents=True, exist_ok=True)
        
        # Compute hash from files list
        current_hash = _compute_files_hash(files)
        
        # Save data - remove existing file first to avoid pyarrow type extension conflicts
        data_path = cache_path / "data.parquet"
        if data_path.exists():
            data_path.unlink()
        
        # Convert UUID objects to strings for parquet compatibility
        df_to_save = df.copy()
        for col in df_to_save.columns:
            # Check if column contains UUID objects
            if df_to_save[col].dtype == 'object':
                sample = df_to_save[col].dropna().head(1)
                if len(sample) > 0:
                    first_val = sample.iloc[0]
                    # Check for UUID type
                    if hasattr(first_val, 'hex') and hasattr(first_val, 'int'):
                        df_to_save[col] = df_to_save[col].apply(
                            lambda x: str(x) if x is not None else None
                        )
        
        # Use pyarrow engine explicitly with allow_truncated_timestamps for compatibility
        df_to_save.to_parquet(
            data_path, 
            index=False, 
            engine='pyarrow',
            coerce_timestamps='ms',
            allow_truncated_timestamps=True
        )
        
        # Save manifest
        manifest = {
            "hash": current_hash,
            "period_tag": period_tag,
            "cached_at": pd.Timestamp.now().isoformat(),
            "record_count": len(df)
        }
        with open(cache_path / "manifest.json", "w") as f:
            json.dump(manifest, f, indent=2)
        
        print(f"[Cache] Saved {table} to cache ({len(df)} records)", file=sys.stderr)
    except Exception as e:
        print(f"[Cache] Failed to save: {e}", file=sys.stderr)


def clear_cache(table: Optional[str] = None) -> None:
    """
    Clear cached data.
    
    Args:
        table: Specific table to clear, or None to clear all
    """
    cache_dir = _config.get("cache_dir")
    if not cache_dir:
        print("Cache not configured", file=sys.stderr)
        return
    
    import shutil
    cache_path = Path(cache_dir)
    
    if table:
        table_path = cache_path / table
        if table_path.exists():
            shutil.rmtree(table_path)
            print(f"Cleared cache for {table}", file=sys.stderr)
        else:
            print(f"No cache found for {table}", file=sys.stderr)
    else:
        if cache_path.exists():
            shutil.rmtree(cache_path)
            cache_path.mkdir(parents=True, exist_ok=True)
            print("Cleared all cache", file=sys.stderr)
        else:
            print("No cache to clear", file=sys.stderr)


# =============================================================================
# CLI
# =============================================================================

def help() -> None:
    """
    Display usage information for fusou-datasets library.
    """
    help_text = f"""
================================================================================
Fusou Datasets v{__version__} - Usage Guide
================================================================================

🔧 SETUP
--------------------------------------------------------------------------------
  fusou_datasets.save_api_key("your_api_key")
      Save API key for persistent use.
      Get your key at: https://fusou.dev/dashboard/api-keys

  fusou_datasets.configure(api_key="...", cache_dir="~/.fusou_datasets/cache")
      Configure API credentials and caching.

📋 LIST DATA
--------------------------------------------------------------------------------
  fusou_datasets.list_tables()
      List all available tables. Returns: List[str]

  fusou_datasets.list_period_tags()
      List available period tags. Returns: Dict

📊 LOAD DATA
--------------------------------------------------------------------------------
  df = fusou_datasets.load("table_name")
      Load table data as pandas DataFrame.
      
  df = fusou_datasets.load("table_name", period_tag="2024-01")
      Load specific period's data.

💾 CACHING (requires cache_dir configuration)
--------------------------------------------------------------------------------
  df = fusou_datasets.load("table_name")
      Uses cache if available and data unchanged.
      
  df = fusou_datasets.load("table_name", offline=True)
      Use cache without server validation.
      
  df = fusou_datasets.load("table_name", force_download=True)
      Force re-download ignoring cache.
      
  fusou_datasets.clear_cache()
      Clear all cached data.

🔍 QUERY DATA (Cached Data Only)
--------------------------------------------------------------------------------
  # Step 1: Load required tables first
  fusou_datasets.load("battle")
  fusou_datasets.load("own_deck")
  
  # Step 2: Query cached data
  from fusou_datasets import Tables, query
  result = query([Tables.Battle.TIMESTAMP, Tables.OwnDeck.UUID])

🔑 DEVICE INFO
--------------------------------------------------------------------------------
  fusou_datasets.get_client_id()
      Get current device's client ID.

📚 MORE INFO: https://fusou.dev/docs/fusou-datasets
================================================================================
"""
    print(help_text)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Fusou Datasets CLI")
    parser.add_argument("--version", action="version", version=f"fusou-datasets {__version__}")
    parser.add_argument("--client-id", action="store_true", help="Show client ID")
    parser.add_argument("--tables", action="store_true", help="List tables")
    parser.add_argument("--period-tags", action="store_true", help="List period tags")
    args = parser.parse_args()
    
    if args.client_id:
        print(f"Client ID: {get_client_id()}")
    elif args.tables:
        for t in list_tables():
            print(t)
    elif args.period_tags:
        info = list_period_tags()
        period_tags = info.get("period_tags") or []
        latest = info.get("latest")
        if period_tags:
            print("Available period tags:")
            for tag in period_tags:
                marker = " (latest)" if latest is not None and tag == latest else ""
                print(f"  {tag}{marker}")
        elif latest:
            print(f"Latest period tag: {latest}")
        else:
            print("No period tags available")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
