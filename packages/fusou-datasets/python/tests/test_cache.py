"""Tests for fusou_datasets._cache module."""

import pytest
from pathlib import Path

from fusou_datasets._cache import (
    _compute_files_hash,
    _version_sort_key,
    _get_latest_table_version,
    _filter_files_by_version,
    _resolve_cached_table_version,
)


def test_compute_files_hash_deterministic():
    files1 = [
        {"id": "1", "size": 100, "record_count": 10, "table_version": "0.6.0"},
        {"id": "2", "size": 200, "record_count": 20, "table_version": "0.6.0"},
    ]
    # Reverse order should produce exact same hash
    files2 = [
        {"id": "2", "size": 200, "record_count": 20, "table_version": "0.6.0"},
        {"id": "1", "size": 100, "record_count": 10, "table_version": "0.6.0"},
    ]
    h1 = _compute_files_hash(files1)
    h2 = _compute_files_hash(files2)
    assert h1 == h2
    assert len(h1) == 64  # Full SHA-256


def test_version_sort_key():
    assert _version_sort_key("v0") < _version_sort_key("v1")
    assert _version_sort_key("v1") < _version_sort_key("0.4")
    assert _version_sort_key("0.4") < _version_sort_key("0.5")
    assert _version_sort_key("0.5") < _version_sort_key("0.6.0")


def test_get_latest_table_version():
    files = [
        {"id": "1", "table_version": "0.4"},
        {"id": "2", "table_version": "0.6.0"},
        {"id": "3", "table_version": "0.5"},
    ]
    assert _get_latest_table_version(files) == "0.6.0"


def test_filter_files_by_version():
    files = [
        {"id": "1", "table_version": "0.4"},
        {"id": "2", "table_version": "0.6.0"},
        {"id": "3", "table_version": "0.4"},
    ]
    filtered = _filter_files_by_version(files, "0.4")
    assert len(filtered) == 2
    assert all(f["table_version"] == "0.4" for f in filtered)