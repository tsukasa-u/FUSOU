"""Tests for fusou_datasets._master module."""

import pytest
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
