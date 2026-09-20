"""Tests for fusou_datasets.query_engine module."""

import pytest
import pandas as pd
import numpy as np

from fusou_datasets.query_engine import (
    JoinGraph,
    _prepare_for_merge,
    REGISTRY,
)


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
