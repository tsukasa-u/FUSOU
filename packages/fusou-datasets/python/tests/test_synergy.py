"""Tests for fusou_datasets._synergy module."""

import pytest
import pandas as pd

from fusou_datasets._synergy import (
    _expand_effect_rules,
    _expand_cross_rules,
    SynergyData,
)


def test_expand_effect_rules():
    rules = [
        {
            "ships": [1, 2],
            "items": [101, 102],
            "b": {"houg": 2, "raig": 1},
        },
        {
            "ships": [3],
            "items": 103,  # scalar item ID
            "b": {"houg": 3},
        }
    ]
    df = _expand_effect_rules(rules)
    assert len(df) == 5  # 2 ships * 2 items + 1 ship * 1 item
    assert "houg" in df.columns
    assert "raig" in df.columns
    # Check that scalar item was properly normalized to list
    ship3 = df[df["ship_id"] == 3]
    assert len(ship3) == 1
    assert ship3.iloc[0]["item_id"] == 103
    assert ship3.iloc[0]["houg"] == 3


def test_synergy_data_query():
    raw = {
        "_meta": {"version": "1.0"},
        "effect_rules": [
            {
                "ships": [10],
                "items": [201],
                "b": {"houg": 5},
            },
            {
                "ships": [20],
                "items": [202],
                "b": {"houg": 10},
            }
        ],
        "cross_rules": []
    }
    synergy = SynergyData(raw)
    assert synergy.meta["version"] == "1.0"
    
    # Query by ship_id
    q1 = synergy.query(ship_id=10)
    assert len(q1) == 1
    assert q1.iloc[0]["houg"] == 5
    
    # Query non-existent
    q2 = synergy.query(ship_id=999)
    assert len(q2) == 0
def test_synergy_cache_and_offline(tmp_path, monkeypatch):
    import json
    from fusou_datasets._config import configure
    from fusou_datasets._synergy import load_synergy
    
    cache_dir = tmp_path / "cache"
    configure(cache_dir=str(cache_dir), period_tag="2026-09")
    
    # Create fake cache
    syn_dir = cache_dir / "synergy" / "2026-09"
    syn_dir.mkdir(parents=True)
    fake_data = {
        "_meta": {"version": "1.0.0"},
        "effect_rules": [
            {"ships": [1], "items": [101], "b": {"houg": 5}}
        ],
        "cross_rules": []
    }
    (syn_dir / "synergy.json").write_text(json.dumps(fake_data), encoding="utf-8")
    
    # Offline load should succeed from cache
    syn = load_synergy(period_tag="2026-09", offline=True)
    assert len(syn.single_bonuses) == 1
    assert syn.single_bonuses.iloc[0]["houg"] == 5
