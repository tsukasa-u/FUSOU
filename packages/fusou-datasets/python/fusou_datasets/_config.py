"""
fusou_datasets._config
~~~~~~~~~~~~~~~~~~~~~~

Configuration and persistent settings management.
"""

import os
import sys
import json
import uuid
from pathlib import Path
from typing import Optional, Dict, Any

from ._exceptions import AuthenticationError

# Constants
DEFAULT_API_URL = "https://fusou.dev/api/data-loader"
SETTINGS_DIR = Path.home() / ".fusou-datasets"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"

# Environment variables
DEFAULT_PERIOD_TAG = os.environ.get("FUSOU_PERIOD_TAG", "latest")
DEFAULT_TABLE_VERSION = os.environ.get("FUSOU_TABLE_VERSION", None)
DEFAULT_CACHE_DIR = os.environ.get("FUSOU_CACHE_DIR", None)

# In-memory runtime configuration (singleton dict preserved across reloads)
if "_config" not in globals():
    _config: Dict[str, Any] = {
        "api_key": None,
        "api_url": DEFAULT_API_URL,
        "cache_dir": DEFAULT_CACHE_DIR,
        "period_tag": DEFAULT_PERIOD_TAG,
        "table_version": DEFAULT_TABLE_VERSION,
    }
else:
    _config.update({
        "period_tag": DEFAULT_PERIOD_TAG,
        "table_version": DEFAULT_TABLE_VERSION,
        "cache_dir": DEFAULT_CACHE_DIR,
    })


def configure(
    api_key: Optional[str] = None,
    api_url: Optional[str] = None,
    cache_dir: Optional[str] = None,
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
) -> None:
    """
    Configure API credentials, caching, and default dataset versions.
    
    Args:
        api_key: API key for authentication
        api_url: Custom API URL (optional)
        cache_dir: Directory for local data caching (enables caching when set)
        period_tag: Default dataset period tag (e.g., 'latest', '2026-09')
        table_version: Default schema table version (e.g., '0.6.0')
    """
    if api_key is not None:
        _config["api_key"] = api_key
    if api_url is not None:
        _config["api_url"] = api_url
    if cache_dir is not None:
        _config["cache_dir"] = str(Path(cache_dir).expanduser().resolve())
    if period_tag is not None:
        _config["period_tag"] = period_tag
    if table_version is not None:
        _config["table_version"] = table_version


def get_config() -> Dict[str, Any]:
    """Return a copy of the current configuration dictionary."""
    return dict(_config)


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
    try:
        os.chmod(SETTINGS_FILE, 0o600)
    except Exception:
        pass


def save_api_key(api_key: str) -> None:
    """Save API key to config file for persistent use."""
    _ensure_settings_dir()
    settings = _load_settings()
    settings["api_key"] = api_key
    _save_settings(settings)
    _config["api_key"] = api_key


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
        "[!] API key not configured\n\n"
        "To fix this, do ONE of the following:\n"
        "  1. Set environment variable: export FUSOU_API_KEY='your_key'\n"
        "  2. Save it permanently: fusou_datasets.save_api_key('your_key')\n"
        "  3. Configure in code: fusou_datasets.configure(api_key='your_key')\n\n"
        "Get your API key at: https://fusou.dev/dashboard/api-keys"
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
