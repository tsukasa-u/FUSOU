"""Tests for fusou_datasets._growth module."""

from types import SimpleNamespace
import pandas as pd
import pytest

import fusou_datasets._growth as growth
from fusou_datasets._config import configure
from fusou_datasets._exceptions import DatasetNotFoundError


@pytest.fixture(autouse=True)
def reset_growth_config():
    from fusou_datasets._config import _config, DEFAULT_API_URL

    _config["api_key"] = None
    _config["api_url"] = DEFAULT_API_URL
    _config["cache_dir"] = None
    _config["period_tag"] = "latest"
    _config["table_version"] = None
    yield
    _config["api_key"] = None
    _config["api_url"] = DEFAULT_API_URL
    _config["cache_dir"] = None
    _config["period_tag"] = "latest"
    _config["table_version"] = None


def test_load_growth_snapshot_resolves_latest_via_summary(monkeypatch, tmp_path):
    configure(cache_dir=str(tmp_path))
    calls = []

    def fake_request(method, endpoint, **kwargs):
        calls.append((method, endpoint))
        if endpoint == "/ship-growth/summary":
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "ok": True,
                    "periods": [{"period_tag": "2026-10-01", "table_version": "0.6.0"}],
                },
            )
        if endpoint == "/ship-growth/bounds?period_tag=2026-10-01&table_version=0.6.0":
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "ok": True,
                    "bounds": [{"master_id": 1, "lv": 99, "kaihi_naked": 80}],
                },
            )
        raise AssertionError(f"Unexpected endpoint: {endpoint}")

    monkeypatch.setattr(growth, "_request", fake_request)
    df = growth.load_growth_snapshot()
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 1
    assert df.iloc[0]["master_id"] == 1
    assert calls == [
        ("GET", "/ship-growth/summary"),
        ("GET", "/ship-growth/bounds?period_tag=2026-10-01&table_version=0.6.0"),
    ]
    assert (tmp_path / "growth" / "latest" / "latest" / "bounds.parquet").exists()


def test_load_growth_snapshot_offline_missing_raises(tmp_path):
    configure(cache_dir=str(tmp_path))
    with pytest.raises(DatasetNotFoundError):
        growth.load_growth_snapshot(offline=True)


def test_load_speed_observation_queries_speed_upgrade(monkeypatch, tmp_path):
    configure(cache_dir=str(tmp_path))
    calls = []

    def fake_request(method, endpoint, **kwargs):
        calls.append((method, endpoint))
        if endpoint == "/soku-speed-observed/speed-upgrade":
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "ok": True,
                    "period_tag": "2026-10-01",
                    "table_version": "0.6.0",
                    "data": {
                        "1": [{"soku_observed": 10, "item_ids": [33, 34]}],
                    },
                },
            )
        raise AssertionError(f"Unexpected endpoint: {endpoint}")

    monkeypatch.setattr(growth, "_request", fake_request)
    df = growth.load_speed_observation()
    assert len(df) == 1
    assert df.iloc[0]["master_id"] == 1
    assert df.iloc[0]["soku_observed"] == 10
    assert list(df.iloc[0]["item_ids"]) == [33, 34]
    assert calls == [("GET", "/soku-speed-observed/speed-upgrade")]


def test_load_speed_observation_requires_table_version_with_explicit_period():
    with pytest.raises(ValueError, match="table_version"):
        growth.load_speed_observation(period_tag="2026-10-01")
