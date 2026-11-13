"""Tests for fusou_datasets.query_engine module."""

import pytest
import pandas as pd
import numpy as np

import fusou_datasets as fd
from fusou_datasets import Tables
from fusou_datasets.query_engine import (
    JoinGraph,
    _prepare_for_merge,
    REGISTRY,
)


def test_battle_cells_relationship_uses_uuid():
    assert REGISTRY.find_path(Tables.Battle.TABLE, Tables.Cells.TABLE) == [
        ("battle", str(Tables.Battle.UUID), "cells", str(Tables.Cells.BATTLES)),
    ]


def test_join_graph_shortest_path():
    g = JoinGraph()
    g.add("table_a", "id", "table_b", "a_id")
    g.add("table_b", "id", "table_c", "b_id")
    
    path = g.find_path("table_a", "table_c")
    assert path == [
        ("table_a", "id", "table_b", "a_id"),
        ("table_b", "id", "table_c", "b_id"),
    ]


def test_join_graph_no_path():
    g = JoinGraph()
    g.add("table_a", "id", "table_b", "a_id")
    assert g.find_path("table_a", "unconnected") is None


def test_prepare_for_merge_explode_array():
    df = pd.DataFrame({
        "id": [1, 2],
        "tags": [["tag1", "tag2"], ["tag3"]],
    })
    exploded = _prepare_for_merge(df, "tags")
    assert len(exploded) == 3
    assert list(exploded["tags"]) == ["tag1", "tag2", "tag3"]


def test_prepare_for_merge_scalar_unchanged():
    df = pd.DataFrame({
        "id": [1, 2],
        "name": ["alpha", "beta"],
    })
    unchanged = _prepare_for_merge(df, "name")
    assert len(unchanged) == 2
def test_resolve_cached_file_with_split(tmp_path):
    from fusou_datasets.query_engine import _resolve_cached_file
    
    # Create cached file under split directory
    split_dir = tmp_path / "battle" / "0.6.0" / "latest" / "train"
    split_dir.mkdir(parents=True)
    parquet_file = split_dir / "data.parquet"
    parquet_file.write_text("dummy", encoding="utf-8")
    
    # Resolving with split='train' should find the file
    resolved = _resolve_cached_file(tmp_path, "battle", "latest", "0.6.0", split="train")
    assert resolved == parquet_file
    
    # Resolving without explicit version should also search and find
    resolved_auto = _resolve_cached_file(tmp_path, "battle", "latest", split="train")
    assert resolved_auto == parquet_file


def test_query_reads_validation_split_cache(tmp_path, monkeypatch):
    import fusou_datasets.query_engine as query_engine

    cache_file = tmp_path / "battle" / "0.6.0" / "latest" / "validation" / "data.parquet"
    cache_file.parent.mkdir(parents=True)
    cache_file.touch()
    monkeypatch.setitem(fd._config, "cache_dir", str(tmp_path))
    monkeypatch.setitem(fd._config, "table_version", "0.6.0")
    monkeypatch.setitem(fd._config, "period_tag", "latest")

    read_paths = []

    def read_parquet(path):
        read_paths.append(path)
        return pd.DataFrame({"uuid": ["battle-uuid"]})

    monkeypatch.setattr(query_engine.pd, "read_parquet", read_parquet)
    result = query_engine.query(
        [Tables.Battle.UUID],
        period_tag="latest",
        table_version="0.6.0",
        split="validation",
    )

    assert read_paths == [cache_file]
    assert result["uuid"].tolist() == ["battle-uuid"]


def test_resolve_cached_file_finds_master_cache_fallback(tmp_path):
    from fusou_datasets.query_engine import _resolve_cached_file

    master_file = tmp_path / "master" / "latest" / "latest" / "mst_ships.parquet"
    master_file.parent.mkdir(parents=True)
    master_file.touch()

    assert _resolve_cached_file(
        tmp_path, "mst_ships", "2026-09", table_version="0.6.0"
    ) == master_file


def test_resolve_cached_file_prefers_exact_period_and_regular_over_latest_master(tmp_path):
    from fusou_datasets.query_engine import _resolve_cached_file

    # Create broad master/latest/latest fallback as well as narrower exact files.
    latest_master = tmp_path / "master" / "latest" / "latest" / "mst_ships.parquet"
    latest_master.parent.mkdir(parents=True)
    latest_master.touch()

    latest_version_exact_period_master = (
        tmp_path / "master" / "latest" / "2026-09" / "mst_ships.parquet"
    )
    latest_version_exact_period_master.parent.mkdir(parents=True)
    latest_version_exact_period_master.touch()

    assert _resolve_cached_file(
        tmp_path, "mst_ships", "2026-09", table_version="0.6.0"
    ) == latest_version_exact_period_master

    exact_master = tmp_path / "master" / "0.6.0" / "2026-09" / "mst_ships.parquet"
    exact_master.parent.mkdir(parents=True)
    exact_master.touch()

    assert _resolve_cached_file(
        tmp_path, "mst_ships", "2026-09", table_version="0.6.0"
    ) == exact_master

    exact_regular = tmp_path / "mst_ships" / "0.6.0" / "2026-09" / "train" / "data.parquet"
    exact_regular.parent.mkdir(parents=True)
    exact_regular.touch()

    assert _resolve_cached_file(
        tmp_path, "mst_ships", "2026-09", table_version="0.6.0", split="train"
    ) == exact_regular


def test_resolve_cached_file_prefers_exact_legacy_regular_over_latest_master(tmp_path):
    from fusou_datasets.query_engine import _resolve_cached_file

    latest_master = tmp_path / "master" / "latest" / "latest" / "mst_ships.parquet"
    latest_master.parent.mkdir(parents=True)
    latest_master.touch()

    legacy_regular = tmp_path / "mst_ships" / "2026-09" / "train" / "data.parquet"
    legacy_regular.parent.mkdir(parents=True)
    legacy_regular.touch()

    assert _resolve_cached_file(
        tmp_path, "mst_ships", "2026-09", table_version="0.6.0", split="train"
    ) == legacy_regular
