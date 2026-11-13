"""Tests for fusou_datasets._master module."""

import pytest
import pandas as pd
import fusou_datasets._master as master
from fusou_datasets import Tables
from fusou_datasets._master import (
    list_master_tables,
    _MASTER_CANONICAL,
)


def test_list_master_tables():
    tables = list_master_tables()
    assert len(tables) >= 10
    assert "mst_ships" in tables
    assert "mst_slot_items" in tables
    assert "mst_map_infos" in tables


def test_master_canonical_aliases():
    # Both singular and plural should map to canonical plural
    assert _MASTER_CANONICAL["mst_ship"] == "mst_ships"
    assert _MASTER_CANONICAL["mst_ships"] == "mst_ships"
    assert _MASTER_CANONICAL["mst_slotitem"] == "mst_slot_items"
    assert _MASTER_CANONICAL["mst_map_info"] == "mst_map_infos"
    assert _MASTER_CANONICAL["mst_map_infos"] == "mst_map_infos"


def test_load_master_accepts_table_meta_and_fresh_latest_cache(tmp_path, monkeypatch):
    cache_file = tmp_path / "master" / "latest" / "latest" / "mst_ships.parquet"
    cache_file.parent.mkdir(parents=True)
    cache_file.touch()
    expected = pd.DataFrame({"id": [1]})

    monkeypatch.setitem(master._config, "cache_dir", str(tmp_path))
    monkeypatch.setitem(master._config, "period_tag", "latest")
    monkeypatch.setitem(master._config, "table_version", None)
    monkeypatch.setattr(master.pd, "read_parquet", lambda path: expected)
    monkeypatch.setattr(master, "_request", lambda *args, **kwargs: pytest.fail("fresh cache should be used"))

    assert master.load_master(Tables.MstShips).equals(expected)
