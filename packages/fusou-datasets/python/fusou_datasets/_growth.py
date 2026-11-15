"""
fusou_datasets._growth
~~~~~~~~~~~~~~~~~~~~~~

Loaders for ship stat growth parameters and speed observations.
Supports server fetching (/api/ship-growth/summary, /api/ship-growth/bounds,
/api/soku-speed-observed/speed-upgrade), local Parquet caching, and offline access.
"""

from typing import Optional
from pathlib import Path
import pandas as pd

from ._config import _config
from ._client import _request, _raise_api_error
from ._exceptions import FusouDatasetsError, DatasetNotFoundError


def _resolve_growth_period(tag: str, ver: Optional[str]) -> tuple[str, str]:
    """Resolve concrete (period_tag, table_version) via /ship-growth/summary."""
    resp = _request("GET", "/ship-growth/summary")
    if resp.status_code != 200:
        _raise_api_error(resp, "Failed to fetch ship growth summary")

    periods = resp.json().get("periods", [])
    if not isinstance(periods, list) or not periods:
        raise DatasetNotFoundError("No ship growth periods are available on the server")

    candidates = periods
    if tag != "latest":
        candidates = [p for p in candidates if p.get("period_tag") == tag]
    if ver:
        candidates = [p for p in candidates if p.get("table_version") == ver]

    if not candidates:
        raise DatasetNotFoundError(
            f"No ship growth period matching period_tag={tag!r}, table_version={ver!r}"
        )

    selected = candidates[0]
    return str(selected["period_tag"]), str(selected["table_version"])


def load_growth_snapshot(
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
    offline: bool = False,
    force_download: bool = False
) -> pd.DataFrame:
    """
    Load ship growth snapshot bounds dataset (naked stats per ship/level).
    Queries server /ship-growth/bounds (resolving 'latest' via /ship-growth/summary),
    caching locally in Parquet.

    Args:
        period_tag: 'latest' or specific period tag (YYYY-MM-DD). Defaults to configured period_tag.
        table_version: Optional table version constraint. Defaults to configured table_version.
        offline: Use local cache if available without contacting server.
        force_download: Force re-download even if cached.

    Returns:
        pd.DataFrame: Growth bound records per ship
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
        raise DatasetNotFoundError(
            f"Offline cache not found for ship growth bounds (period_tag={tag}, table_version={ver or 'latest'})"
        )

    resolved_tag = tag
    resolved_ver = ver
    if resolved_tag == "latest" or not resolved_ver:
        resolved_tag, resolved_ver = _resolve_growth_period(resolved_tag, resolved_ver)

    endpoint = f"/ship-growth/bounds?period_tag={resolved_tag}&table_version={resolved_ver}"
    resp = _request("GET", endpoint)
    if resp.status_code == 200:
        data = resp.json()
        bounds = data.get("bounds", [])
        df = pd.DataFrame(bounds)
        if cache_path and not df.empty:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            df.to_parquet(cache_path, index=False, engine="pyarrow")
        return df

    _raise_api_error(resp, "Failed to load ship growth bounds")
    raise FusouDatasetsError("Unexpected error loading ship growth bounds")


def load_speed_observation(
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
    offline: bool = False,
    force_download: bool = False
) -> pd.DataFrame:
    """
    Load speed-upgrade observation dataset.
    Queries server /soku-speed-observed/speed-upgrade, caching locally in Parquet.

    Args:
        period_tag: 'latest' or specific period tag (YYYY-MM-DD). Defaults to configured period_tag.
        table_version: Optional table version constraint (required when period_tag != 'latest').
        offline: Use local cache if available without contacting server.
        force_download: Force re-download even if cached.

    Returns:
        pd.DataFrame: Aggregated speed observation records (master_id, soku_observed, item_ids, ...)
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
        raise DatasetNotFoundError(
            f"Offline cache not found for speed observations (period_tag={tag}, table_version={ver or 'latest'})"
        )

    if tag != "latest" and not ver:
        raise ValueError("table_version must be provided when specifying a concrete period_tag")

    endpoint = "/soku-speed-observed/speed-upgrade"
    if tag != "latest" and ver:
        endpoint += f"?period_tag={tag}&table_version={ver}"

    resp = _request("GET", endpoint)
    if resp.status_code == 200:
        payload = resp.json()
        raw_data = payload.get("data", {})
        resolved_tag = payload.get("period_tag")
        resolved_ver = payload.get("table_version")
        rows = []
        if isinstance(raw_data, dict):
            for master_id_str, entries in raw_data.items():
                try:
                    master_id = int(master_id_str)
                except (TypeError, ValueError):
                    master_id = master_id_str
                if isinstance(entries, list):
                    for entry in entries:
                        rows.append({
                            "master_id": master_id,
                            "soku_observed": entry.get("soku_observed"),
                            "item_ids": entry.get("item_ids", []),
                            "period_tag": resolved_tag,
                            "table_version": resolved_ver,
                        })
        elif isinstance(raw_data, list):
            rows = raw_data
        df = pd.DataFrame(rows)
        if cache_path and not df.empty:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            df.to_parquet(cache_path, index=False, engine="pyarrow")
        return df

    _raise_api_error(resp, "Failed to load speed observations")
    raise FusouDatasetsError("Unexpected error loading speed observations")
