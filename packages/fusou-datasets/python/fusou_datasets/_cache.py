"""
fusou_datasets._cache
~~~~~~~~~~~~~~~~~~~~~

Local Parquet caching and cache validation for datasets.
"""

import sys
import json
import hashlib
import shutil
from pathlib import Path
from typing import Optional, List, Set, Dict, Any

import pandas as pd

from ._config import _config
from ._exceptions import FusouDatasetsError


def _compute_files_hash(files: list) -> str:
    """Compute SHA-256 hash from file metadata and content hashes for robust cache validation."""
    sorted_files = sorted(files, key=lambda f: f.get("id", ""))
    hash_input = "|".join(
        f"{f.get('id')}:{f.get('size')}:{f.get('record_count')}:{f.get('table_version')}:{f.get('content_hash', f.get('sha256', ''))}"
        for f in sorted_files
    )
    return hashlib.sha256(hash_input.encode()).hexdigest()


def _version_sort_key(v: str) -> tuple:
    """Return a sort key for table_version strings."""
    if v.startswith("v") and v[1:].isdigit():
        return (0, int(v[1:]), 0)
    parts = v.split(".")
    try:
        return (1, int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
    except ValueError:
        return (2, 0, 0)


def _get_latest_table_version(files: list) -> Optional[str]:
    """Extract the latest table_version from a list of files."""
    versions: Set[str] = {f["table_version"] for f in files if f.get("table_version")}
    if not versions:
        return None
    if len(versions) > 1:
        latest = sorted(versions, key=_version_sort_key, reverse=True)[0]
        return latest
    return next(iter(versions))


def _filter_files_by_version(files: list, version: str) -> list:
    """Filter file list to only include files matching the given table_version."""
    return [f for f in files if f.get("table_version") == version]


def _resolve_cached_table_version(cache_dir: str, table: str, table_version: Optional[str]) -> Optional[str]:
    """Resolve cache table_version when not provided."""
    if table_version:
        return table_version
    base = Path(cache_dir) / table
    if not base.exists() or not base.is_dir():
        return None
    versions = [p.name for p in base.iterdir() if p.is_dir()]
    if len(versions) == 1:
        return versions[0]
    return None


def _save_to_cache(table: str, period_tag: str, table_version: str, df: pd.DataFrame, files: list, split: str = "train") -> None:
    """Save DataFrame and manifest to local Parquet cache partitioned by split."""
    cache_dir = _config.get("cache_dir")
    if not cache_dir:
        return
    
    try:
        cache_path = Path(cache_dir) / table / table_version / period_tag / split
        cache_path.mkdir(parents=True, exist_ok=True)
        
        current_hash = _compute_files_hash(files)
        data_path = cache_path / "data.parquet"
        if data_path.exists():
            data_path.unlink()
        
        # Parquet export with timestamp ms coercion
        df.to_parquet(
            data_path, 
            index=False, 
            engine='pyarrow',
            coerce_timestamps='ms',
            allow_truncated_timestamps=True
        )
        
        # Save manifest
        manifest = {
            "hash": current_hash,
            "period_tag": period_tag,
            "table_version": table_version,
            "split": split,
            "cached_at": pd.Timestamp.now().isoformat(),
            "record_count": len(df)
        }
        with open(cache_path / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        
        print(f"[Cache] Saved {table} to cache ({len(df)} records)", file=sys.stderr)
    except Exception as e:
        print(f"[Cache] Failed to save: {e}", file=sys.stderr)


def clear_cache(table: Optional[str] = None) -> None:
    """
    Clear cached data.
    
    Args:
        table: Specific table to clear, or None to clear all
    """
    cache_dir = _config.get("cache_dir")
    if not cache_dir:
        print("Cache not configured.", file=sys.stderr)
        return
    
    base = Path(cache_dir)
    if not base.exists():
        return
    
    if table:
        target = base / table
        if target.exists():
            shutil.rmtree(target)
            print(f"Cleared cache for '{table}'", file=sys.stderr)
    else:
        for item in base.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
        print("Cleared all cached data", file=sys.stderr)