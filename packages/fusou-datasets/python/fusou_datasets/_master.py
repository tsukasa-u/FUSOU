"""
fusou_datasets._master
~~~~~~~~~~~~~~~~~~~~~~

Master data loading and metadata inspection.
Supports table name canonicalization (singular/plural), local Parquet caching,
and offline access.
"""

from typing import Optional, List, Dict, Any
from pathlib import Path
import sys
import pandas as pd

from ._config import _config
from ._client import _request, _raise_api_error
from ._loader import _download_avro
from ._exceptions import FusouDatasetsError, DatasetNotFoundError
from .schema import TableInput, resolve_table_name

# Canonical master table mapping (accepts both singular and plural forms)
_MASTER_CANONICAL = {
    # Ships
    "mst_ship": "mst_ships",
    "mst_ships": "mst_ships",
    "mst_shipgraph": "mst_ship_graphs",
    "mst_shipgraphs": "mst_ship_graphs",
    "mst_ship_graph": "mst_ship_graphs",
    "mst_ship_graphs": "mst_ship_graphs",
    "mst_ship_upgrade": "mst_ship_upgrades",
    "mst_ship_upgrades": "mst_ship_upgrades",
    # Slotitems / Equip
    "mst_slotitem": "mst_slot_items",
    "mst_slotitems": "mst_slot_items",
    "mst_slot_item": "mst_slot_items",
    "mst_slot_items": "mst_slot_items",
    "mst_slotitem_equiptype": "mst_slotitem_equip_types",
    "mst_slotitem_equiptypes": "mst_slotitem_equip_types",
    "mst_slotitem_equip_type": "mst_slotitem_equip_types",
    "mst_slotitem_equip_types": "mst_slotitem_equip_types",
    "mst_equip_exslot": "mst_equip_exslot",
    "mst_equip_exslot_ship": "mst_equip_exslot_ships",
    "mst_equip_exslot_ships": "mst_equip_exslot_ships",
    "mst_equip_limit_exslot": "mst_equip_limit_exslot",
    "mst_equip_ship": "mst_equip_ships",
    "mst_equip_ships": "mst_equip_ships",
    # Maps & Others
    "mst_map_area": "mst_map_areas",
    "mst_map_areas": "mst_map_areas",
    "mst_map_info": "mst_map_infos",
    "mst_map_infos": "mst_map_infos",
    "mst_stype": "mst_stypes",
    "mst_stypes": "mst_stypes",
    "mst_use_item": "mst_use_items",
    "mst_use_items": "mst_use_items",
    "mst_payitem": "mst_payitem",
}

_MASTER_TABLES = sorted(list(set(_MASTER_CANONICAL.values())))


def list_master_tables() -> List[str]:
    """Return list of supported canonical master-data table names."""
    return list(_MASTER_TABLES)


def get_master_latest(table_version: Optional[str] = None) -> Dict[str, Any]:
    """
    Get latest master-data metadata (period_tag) via data loader.

    Returns:
        dict: with keys 'exists' (bool) and 'period_tag' (str or None)
    """
    try:
        resp = _request("GET", "/tables")
        if resp.status_code != 200:
            raise FusouDatasetsError(f"Failed to list tables: HTTP {resp.status_code}")
        data = resp.json()
        tables = data.get("tables", [])
        master_tables = [t for t in tables if t.startswith("mst_")]
        if not master_tables:
            return {"exists": False, "period_tag": None}
        
        first_table = master_tables[0]
        url = f"/data/{first_table}?period_tag=latest&limit=1"
        ver = table_version or _config.get("table_version")
        if ver:
            url += f"&table_version={ver}"
        resp2 = _request("GET", url)
        if resp2.status_code == 404:
            return {"exists": False, "period_tag": None}
        if resp2.status_code != 200:
            raise FusouDatasetsError(f"Failed to fetch master data: HTTP {resp2.status_code}")
        
        result = resp2.json()
        period_tag = result.get("period_tag")
        return {"exists": True, "period_tag": period_tag}
    except Exception as e:
        raise FusouDatasetsError(f"Failed to get master latest: {e}")


def load_master(
    table: TableInput,
    period_tag: Optional[str] = None,
    table_version: Optional[str] = None,
    offline: bool = False,
    force_download: bool = False
) -> pd.DataFrame:
    """
    Load a master-data table as pandas DataFrame with caching support.

    Args:
        table: master table name (singular or plural, e.g. 'mst_ships' or 'mst_ship')
        period_tag: 'latest' or specific period tag. Defaults to global config or 'latest'.
        table_version: Optional table version constraint. Defaults to global config.
        offline: Load strictly from local cache without contacting server.
        force_download: Force re-download even if cached.

    Returns:
        pd.DataFrame: Master data records
    """
    raw_name = resolve_table_name(table) if not isinstance(table, str) else table
    canonical = _MASTER_CANONICAL.get(str(raw_name).lower().strip())
    if not canonical:
        # Check if table matches without prefix
        with_mst = f"mst_{table.lower().strip()}"
        canonical = _MASTER_CANONICAL.get(with_mst)
    
    if not canonical:
        raise ValueError(
            f"Unknown master table '{table}'.\n"
            f"Available canonical tables: {', '.join(_MASTER_TABLES)}"
        )

    tag = period_tag or _config.get("period_tag") or "latest"
    ver = table_version or _config.get("table_version")
    cache_dir = _config.get("cache_dir")
    
    cache_path = (
        Path(cache_dir) / "master" / (ver or "latest") / tag / f"{canonical}.parquet"
        if cache_dir else None
    )

    if cache_path and cache_path.exists() and not force_download:
        if offline or tag != "latest":
            return pd.read_parquet(cache_path)

    if offline:
        if cache_path and cache_path.exists():
            return pd.read_parquet(cache_path)
        raise DatasetNotFoundError(
            f"Offline mode requested but master table '{canonical}' for period '{tag}' is not cached."
        )

    # Server fetch
    url = f"/data/{canonical}?period_tag={tag}&limit=1"
    if ver:
        url += f"&table_version={ver}"
    
    resp = _request("GET", url)
    if resp.status_code == 404:
        # Try singular/plural fallback
        alt_table = table.lower().strip()
        if alt_table != canonical:
            alt_url = f"/data/{alt_table}?period_tag={tag}&limit=1"
            if ver:
                alt_url += f"&table_version={ver}"
            resp = _request("GET", alt_url)
    
    if resp.status_code == 404:
        raise DatasetNotFoundError(f"No master-data available for table '{canonical}' with period_tag='{tag}'")
    if resp.status_code != 200:
        _raise_api_error(resp, f"load_master/{canonical}")
    
    data = resp.json()
    files = data.get("files", [])
    if not files:
        raise DatasetNotFoundError(f"No files found for master table '{canonical}'")
    
    download_url = files[0].get("download_url")
    if not download_url:
        raise FusouDatasetsError("Missing download_url in master response")
    
    expected_hash = files[0].get("content_hash") or files[0].get("sha256")
    df = _download_avro(download_url, expected_hash=expected_hash)
    
    if cache_path and not df.empty:
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            df.to_parquet(cache_path, index=False, engine="pyarrow")
        except Exception as e:
            print(f"[Warning] Failed to cache master data: {e}", file=sys.stderr)
            
    return df
