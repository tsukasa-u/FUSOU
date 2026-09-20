"""
fusou_datasets._synergy
~~~~~~~~~~~~~~~~~~~~~~~

Structured synergy and equipment bonus dataset representation.
Supports server fetching (/api/master-data/synergy-data), local caching, and offline access.
"""

from typing import Optional, Dict, Any, List, Union
import os
import sys
import json
import time
from pathlib import Path
import pandas as pd

from ._config import _config
from ._client import _request, _raise_api_error
from ._exceptions import FusouDatasetsError, DatasetNotFoundError


def _expand_effect_rules(effect_rules: list) -> pd.DataFrame:
    """Expand effect_rules into a flattened single_bonuses DataFrame."""
    rows = []
    for rule in effect_rules:
        ships = rule.get("ships", [])
        items = rule.get("items", [])
        if isinstance(items, int):
            items = [items]
        bonuses = rule.get("b", {})
        
        for ship_id in ships:
            for item_id in items:
                row = {
                    "ship_id": int(ship_id),
                    "item_id": int(item_id),
                    **bonuses
                }
                rows.append(row)
    
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows).fillna(0)
    # Ensure standard stat columns exist with numeric types
    for stat in ["houg", "raig", "tyku", "souk", "kaih", "tais", "saku", "houm", "leng"]:
        if stat not in df.columns:
            df[stat] = 0
        else:
            df[stat] = pd.to_numeric(df[stat], errors="coerce").fillna(0).astype(int)
    return df


def _expand_cross_rules(cross_rules: list) -> pd.DataFrame:
    """Expand cross_rules into a flattened cross_synergies DataFrame."""
    rows = []
    for rule in cross_rules:
        ships = rule.get("ships", [])
        pairs = rule.get("pairs", [])
        synergy = rule.get("synergy", {})
        
        for ship_id in ships:
            for pair in pairs:
                if len(pair) >= 2:
                    row = {
                        "ship_id": int(ship_id),
                        "item_id_1": int(pair[0]),
                        "item_id_2": int(pair[1]),
                        **synergy
                    }
                    rows.append(row)
    
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows).fillna(0)
    for stat in ["houg", "raig", "tyku", "souk", "kaih", "tais", "saku", "houm", "leng"]:
        if stat not in df.columns:
            df[stat] = 0
        else:
            df[stat] = pd.to_numeric(df[stat], errors="coerce").fillna(0).astype(int)
    return df


class SynergyData:
    """Structured synergy dataset containing single bonuses and multi-item combinations."""
    
    def __init__(self, raw: dict):
        self._raw = raw
        self._meta = raw.get("_meta", {})
        self._single: Optional[pd.DataFrame] = None
        self._cross: Optional[pd.DataFrame] = None
    
    @property
    def meta(self) -> dict:
        """Metadata for the synergy payload."""
        return self._meta
    
    @property
    def single_bonuses(self) -> pd.DataFrame:
        """DataFrame of single item bonuses (ship_id x item_id -> bonuses)."""
        if self._single is None:
            self._single = _expand_effect_rules(self._raw.get("effect_rules", []))
        return self._single
    
    @property
    def cross_synergies(self) -> pd.DataFrame:
        """DataFrame of cross item synergies (ship_id x item_1 x item_2 -> bonuses)."""
        if self._cross is None:
            self._cross = _expand_cross_rules(self._raw.get("cross_rules", []))
        return self._cross
    
    @property
    def raw(self) -> dict:
        """Underlying raw JSON dict (including triple/quad rules)."""
        return self._raw
    
    def query(self, ship_id: Optional[int] = None, item_id: Optional[int] = None) -> pd.DataFrame:
        """Filter single bonuses by ship_id or item_id."""
        df = self.single_bonuses
        if df.empty:
            return df
        if ship_id is not None:
            df = df[df["ship_id"] == ship_id]
        if item_id is not None:
            df = df[df["item_id"] == item_id]
        return df.reset_index(drop=True)

    def to_parquet(self, output_dir: Union[str, Path]) -> Dict[str, str]:
        """Export single_bonuses and cross_synergies to Parquet files."""
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        single_path = out / "single_bonuses.parquet"
        cross_path = out / "cross_synergies.parquet"
        self.single_bonuses.to_parquet(single_path, index=False, engine="pyarrow")
        self.cross_synergies.to_parquet(cross_path, index=False, engine="pyarrow")
        return {"single_bonuses": str(single_path), "cross_synergies": str(cross_path)}


def load_synergy(
    period_tag: Optional[str] = None,
    offline: bool = False,
    force_download: bool = False
) -> SynergyData:
    """
    Load synergy data for a given period tag with caching support.

    Args:
        period_tag: 'latest' or specific period tag (e.g., '2026-09-01').
                    Defaults to global configured period_tag or 'latest'.
        offline: If True, load strictly from local cache without contacting server.
        force_download: If True, bypass cache and re-download from server.

    Returns:
        SynergyData: structured object with single_bonuses and cross_synergies DataFrames
    """
    tag = period_tag or _config.get("period_tag") or "latest"
    cache_dir = _config.get("cache_dir")
    
    cache_path = Path(cache_dir) / "synergy" / tag / "synergy.json" if cache_dir else None
    manifest_path = Path(cache_dir) / "synergy" / tag / "manifest.json" if cache_dir else None

    # Check local cache
    if cache_path and cache_path.exists() and not force_download:
        if offline or tag != "latest":
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return SynergyData(data)
            except Exception as e:
                if offline:
                    raise FusouDatasetsError(f"Failed to read cached synergy data from {cache_path}: {e}")

    if offline:
        if cache_path and cache_path.exists():
            with open(cache_path, "r", encoding="utf-8") as f:
                return SynergyData(json.load(f))
        raise DatasetNotFoundError(
            f"Offline mode requested but synergy data for period_tag '{tag}' is not cached.\n"
            f"Expected cache location: {cache_path or 'cache_dir not configured'}"
        )

    # Server fetch
    endpoint = f"/master-data/synergy-data?period_tag={tag}" if tag != "latest" else "/master-data/synergy-data"
    try:
        resp = _request("GET", endpoint)
        if resp.status_code == 200:
            data = resp.json()
            # Save to cache if cache_dir configured
            if cache_path:
                try:
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(cache_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    if manifest_path:
                        manifest = {
                            "period_tag": tag,
                            "cached_at": time.time(),
                            "source": "server",
                            "meta": data.get("_meta", {})
                        }
                        with open(manifest_path, "w", encoding="utf-8") as f:
                            json.dump(manifest, f, indent=2)
                except Exception as cache_err:
                    print(f"[Warning] Failed to cache synergy data: {cache_err}", file=sys.stderr)
            return SynergyData(data)
        else:
            # Fallback to cache if available
            if cache_path and cache_path.exists():
                print(f"[Cache] Server returned HTTP {resp.status_code}. Using cached synergy data.", file=sys.stderr)
                with open(cache_path, "r", encoding="utf-8") as f:
                    return SynergyData(json.load(f))
            _raise_api_error(resp, f"Failed to load synergy data for period_tag '{tag}'")
    except Exception as e:
        if cache_path and cache_path.exists():
            print(f"[Cache] Network request failed ({e}). Using cached synergy data.", file=sys.stderr)
            with open(cache_path, "r", encoding="utf-8") as f:
                return SynergyData(json.load(f))
        raise

    return SynergyData({})
