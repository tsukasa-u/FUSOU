"""
Fusou Datasets
==============

Secure data loader for FUSOU research datasets with Device Trust authentication.

Usage:
    import fusou_datasets
    
    # API key is loaded automatically from:
    # 1. Environment variable: FUSOU_API_KEY
    # 2. Config file: ~/.fusou-datasets/settings.json
    
    # List available tables
    tables = fusou_datasets.list_tables()
    
    # List period tags
    tags = fusou_datasets.list_period_tags()
    
    # Load data
    df = fusou_datasets.load("ship_type")  # latest period
    df = fusou_datasets.load("ship_type", period_tag="all")  # all periods

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
    "get_client_id",
    "FusouDatasetsError",
    "AuthenticationError",
    "DeviceUnverifiedError",
    "DatasetNotFoundError",
    "Tables",
    "query",
    "register_relationship",
]

DEFAULT_API_URL = "https://fusou.pages.dev/api/data-loader"
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
================================================================================
"""
if not os.getenv("FUSOU_DATASETS_SILENT"):
    print(_TERMS.format(version=__version__), file=sys.stderr)



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

def configure(api_key: Optional[str] = None, api_url: Optional[str] = None) -> None:
    """Configure API credentials."""
    if api_key:
        _config["api_key"] = api_key
    if api_url:
        _config["api_url"] = api_url


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
        "API key not configured. Set FUSOU_API_KEY environment variable "
        "or call fusou_datasets.save_api_key('your_key')"
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
    print("\n" + "=" * 50, file=sys.stderr)
    print("DEVICE VERIFICATION / デバイス認証", file=sys.stderr)
    print("Check your email for the verification code.", file=sys.stderr)
    print("メールで認証コードを確認してください。", file=sys.stderr)
    print("=" * 50, file=sys.stderr)
    
    for attempt in range(3):
        try:
            code = input(f"Code ({attempt+1}/3): ").strip()
        except (EOFError, KeyboardInterrupt):
            raise VerificationError("Verification cancelled")
        
        if not code:
            continue
        
        resp = _request("POST", "/verify", {"code": code})
        if resp.status_code == 200:
            print("✓ Device verified!", file=sys.stderr)
            return True
        print("✗ Invalid code", file=sys.stderr)
    
    raise VerificationError("Max attempts exceeded")


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
            raise AuthenticationError("Invalid API key")
    except json.JSONDecodeError:
        # If the response body is not valid JSON, treat it as a generic access denial.
        pass
    raise AuthenticationError("Access denied")


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

def list_tables(_retry: bool = True) -> List[str]:
    """List available tables."""
    resp = _request("GET", "/tables")
    if resp.status_code == 403 and _retry:
        return _handle_403(resp, list_tables)
    if resp.status_code != 200:
        raise FusouDatasetsError(f"Failed (HTTP {resp.status_code})")
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
        raise FusouDatasetsError(f"Failed (HTTP {resp.status_code})")
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
        raise DatasetNotFoundError(f"No data for '{table}' with period_tag='{period_tag}'")
    if resp.status_code != 200:
        raise FusouDatasetsError(f"Failed (HTTP {resp.status_code})")
    
    files = resp.json().get("files", [])
    if not files:
        raise DatasetNotFoundError(f"No files for '{table}'")
    
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


def load(table: str, period_tag: str = "latest", limit: int = 100, show_progress: bool = True) -> pd.DataFrame:
    """
    Load data for a table.
    
    Args:
        table: Table name (use list_tables() to see options)
        period_tag: "latest", "all", or specific tag
        limit: Max files to load
        show_progress: Show download progress bar
        
    Returns:
        pd.DataFrame: Combined data from all matching files
    """
    return _load_impl(table, period_tag, limit, show_progress, _retry=True)


# =============================================================================
# CLI
# =============================================================================

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
