"""
fusou_datasets._growth
~~~~~~~~~~~~~~~~~~~~~~

Loaders for ship stat growth parameters and speed observations.
Supports server fetching (/api/ship-growth/bounds, /api/soku-speed-observed),
local Parquet caching, and offline access.
"""

from typing import Optional
from pathlib import Path
import sys
import pandas as pd

from ._config import _config
from ._loader import load
from ._client import _request, _raise_api_error
from ._exceptions import FusouDatasetsError, DatasetNotFoundError


def load_growth_snapshot(
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
    offline: bool = False,
    force_download: bool = False
) -> pd.DataFrame:
    """
    Load ship growth snapshot dataset (naked stats, max stats, kyouka, slot items).
    Queries server /ship-growth/bounds if available, caching locally in Parquet.

    Args:
        period_tag: 'latest' or specific period tag. Defaults to configured period_tag.
        table_version: Optional table version constraint. Defaults to configured table_version.
        offline: Use local cache if available without contacting server.
        force_download: Force re-download even if cached.

    Returns:
        pd.DataFrame: Growth records per ship
    """
    tag = period_tag or _config.get("period_tag") or "latest"
    ver = table_version or _config.get("table_version")
    cache_dir = _config.get("cache_dir")
    
    cache_path = (
        Path(cache_dir) / "growth" / (ver or "latest") / tag / "bounds.parquet"
        if cache_dir else None
    )

    if cache_path and cache_path.exists() and not force_download:
        if offline or tag != "latest":
            return pd.read_parquet(cache_path)

    if offline:
        if cache_path and cache_path.exists():
            return pd.read_parquet(cache_path)
        # Try offline load via general loader
        return load(
            table="ship_growth_snapshot",
            period_tag=tag,
            table_version=ver,
            offline=True
        )

    # Try server /ship-growth/bounds endpoint
    endpoint = f"/ship-growth/bounds?period_tag={tag}"
    if ver:
        endpoint += f"&table_version={ver}"
    
    try:
        resp = _request("GET", endpoint)
        if resp.status_code == 200:
            data = resp.json()
            bounds = data.get("bounds", [])
            if bounds:
                df = pd.DataFrame(bounds)
                if cache_path:
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    df.to_parquet(cache_path, index=False, engine="pyarrow")
                return df
    except Exception:
        # Fallback to standard data-loader table
        pass

    return load(
        table="ship_growth_snapshot",
        period_tag=tag,
        table_version=ver,
        offline=offline,
        force_download=force_download
    )


def load_speed_observation(
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
    offline: bool = False,
    force_download: bool = False
) -> pd.DataFrame:
    """
    Load speed observation snapshot dataset.
    Queries server /soku-speed-observed if available, caching locally in Parquet.

    Args:
        period_tag: 'latest' or specific period tag. Defaults to configured period_tag.
        table_version: Optional table version constraint. Defaults to configured table_version.
        offline: Use local cache if available without contacting server.
        force_download: Force re-download even if cached.

    Returns:
        pd.DataFrame: Speed observation records
    """
    tag = period_tag or _config.get("period_tag") or "latest"
    ver = table_version or _config.get("table_version")
    cache_dir = _config.get("cache_dir")
    
    cache_path = (
        Path(cache_dir) / "soku_speed" / (ver or "latest") / tag / "observations.parquet"
        if cache_dir else None
    )

    if cache_path and cache_path.exists() and not force_download:
        if offline or tag != "latest":
            return pd.read_parquet(cache_path)

    if offline:
        if cache_path and cache_path.exists():
            return pd.read_parquet(cache_path)
        return load(
            table="soku_speed_observed_snapshot",
            period_tag=tag,
            table_version=ver,
            offline=True
        )

    endpoint = f"/soku-speed-observed?period_tag={tag}"
    if ver:
        endpoint += f"&table_version={ver}"
    
    try:
        resp = _request("GET", endpoint)
        if resp.status_code == 200:
            data = resp.json()
            obs = data.get("observations", [])
            if obs:
                df = pd.DataFrame(obs)
                if cache_path:
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    df.to_parquet(cache_path, index=False, engine="pyarrow")
                return df
    except Exception:
        pass

    return load(
        table="soku_speed_observed_snapshot",
        period_tag=tag,
        table_version=ver,
        offline=offline,
        force_download=force_download
    )
