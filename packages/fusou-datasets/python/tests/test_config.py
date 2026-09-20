"""Tests for fusou_datasets._config module."""

import sys
import os
import pytest
from pathlib import Path

# Import the actual module object from sys.modules
import fusou_datasets._config
cfg_module = sys.modules["fusou_datasets._config"]

from fusou_datasets._config import (
    get_config,
    configure,
    save_api_key,
    get_client_id,
    _config,
    _get_api_key,
    _get_client_id,
    DEFAULT_API_URL,
)
from fusou_datasets._exceptions import AuthenticationError


@pytest.fixture(autouse=True)
def reset_config():
    """Reset configuration before each test."""
    _config["api_key"] = None
    _config["api_url"] = DEFAULT_API_URL
    _config["cache_dir"] = None
    yield
    _config["api_key"] = None
    _config["api_url"] = DEFAULT_API_URL
    _config["cache_dir"] = None


def test_default_config():
    assert _config["api_url"] == DEFAULT_API_URL
    assert _config["api_key"] is None


def test_configure(tmp_path):
    cache_path = str(tmp_path / "cache")
    configure(
        api_key="test-api-key",
        api_url="https://custom.api/data-loader",
        cache_dir=cache_path,
    )
    assert _config["api_key"] == "test-api-key"
    assert _config["api_url"] == "https://custom.api/data-loader"
    assert _config["cache_dir"] == cache_path


def test_get_api_key_from_config():
    configure(api_key="my-secret-key")
    assert _get_api_key() == "my-secret-key"


def test_get_api_key_from_env(monkeypatch):
    monkeypatch.setenv("FUSOU_API_KEY", "env-api-key")
    assert _get_api_key() == "env-api-key"


def test_get_api_key_missing(monkeypatch, tmp_path):
    monkeypatch.delenv("FUSOU_API_KEY", raising=False)
    monkeypatch.setattr(cfg_module, "SETTINGS_FILE", tmp_path / "settings.json")
    
    with pytest.raises(AuthenticationError):
        _get_api_key()


def test_get_client_id(monkeypatch, tmp_path):
    monkeypatch.setattr(cfg_module, "SETTINGS_DIR", tmp_path)
    monkeypatch.setattr(cfg_module, "SETTINGS_FILE", tmp_path / "settings.json")
    
    cid1 = get_client_id()
    assert isinstance(cid1, str)
    assert len(cid1) > 0
    cid2 = get_client_id()
    assert cid1 == cid2
def test_get_config():
    configure(period_tag="2026-09", table_version="0.6.0")
    cfg = get_config()
    assert cfg["period_tag"] == "2026-09"
    assert cfg["table_version"] == "0.6.0"


def test_env_defaults(monkeypatch):
    monkeypatch.setenv("FUSOU_PERIOD_TAG", "2026-10")
    monkeypatch.setenv("FUSOU_TABLE_VERSION", "0.7.0")
    import importlib
    cfg_m = sys.modules["fusou_datasets._config"]
    importlib.reload(cfg_m)
    assert cfg_m._config["period_tag"] == "2026-10"
    assert cfg_m._config["table_version"] == "0.7.0"
