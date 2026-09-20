"""
fusou_datasets._loader
~~~~~~~~~~~~~~~~~~~~~~

Dataset loading, Avro parsing, and partition downloading.
"""

import sys
import json
import time
from io import BytesIO
from pathlib import Path
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin

import requests
import pandas as pd
import fastavro
from tqdm import tqdm

from ._config import _config, _get_api_key, _get_client_id, DEFAULT_API_URL
from ._client import _request, _handle_403, _raise_api_error, _mask_url_tokens, DOWNLOAD_TIMEOUT
from ._cache import (
    _compute_files_hash,
    _get_latest_table_version,
    _filter_files_by_version,
    _resolve_cached_table_version,
    _save_to_cache,
)
from ._exceptions import FusouDatasetsError, DatasetNotFoundError
from .schema import TableInput, SplitLiteral, resolve_table_name


def _normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize DataFrame data types for consistency between network and cache."""
    for col in df.columns:
        if df[col].dtype == 'object':
            sample = df[col].dropna().head(1)
            if len(sample) > 0:
                first_val = sample.iloc[0]
                if hasattr(first_val, 'hex') and hasattr(first_val, 'int'):
                    df[col] = df[col].apply(lambda x: str(x) if x is not None else None)
    return df


def _download_avro(url: str, expected_hash: Optional[str] = None, _retry: bool = True) -> pd.DataFrame:
    """Download single Avro file and return DataFrame with checksum verification."""
    api_key = _get_api_key()
    client_id = _get_client_id()
    api_url = _config.get("api_url", DEFAULT_API_URL)
    
    if url.startswith("/"):
        base_url = api_url.rsplit("/api/", 1)[0] if "/api/" in api_url else api_url
        url = urljoin(base_url + "/", url.lstrip("/"))
    
    max_retries = 3
    for attempt in range(max_retries + 1):
        try:
            resp = requests.get(
                url,
                headers={"X-API-KEY": api_key, "X-CLIENT-ID": client_id},
                timeout=DOWNLOAD_TIMEOUT,
            )
            
            if resp.status_code == 429:
                retry_after_val = resp.headers.get("Retry-After")
                wait_time = 1
                if retry_after_val:
                    try:
                        wait_time = int(retry_after_val) + 1
                    except ValueError:
                        pass
                
                if attempt < max_retries:
                    print(f"Rate limit exceeded (download). Waiting {wait_time}s... ({attempt+1}/{max_retries})", file=sys.stderr)
                    time.sleep(wait_time)
                    continue
            
            if resp.status_code == 403 and _retry:
                return _handle_403(resp, lambda: _download_avro(url, expected_hash=expected_hash, _retry=False))
            
            resp.raise_for_status()
            content_bytes = resp.content
            
            if expected_hash:
                import hashlib
                actual_hash = hashlib.sha256(content_bytes).hexdigest()
                if not actual_hash.lower().startswith(expected_hash.lower()):
                    raise FusouDatasetsError(
                        f"Checksum mismatch for downloaded file: expected {expected_hash}, got {actual_hash}"
                    )
            
            return _normalize_dataframe(pd.DataFrame.from_records(list(fastavro.reader(BytesIO(content_bytes)))))

        except requests.exceptions.RequestException as e:
            if attempt < max_retries:
                print(f"Download connection error: {e}. Retrying...", file=sys.stderr)
                time.sleep(2)
                continue
            safe_url = _mask_url_tokens(url)
            raise FusouDatasetsError(f"Download failed for {safe_url}: {e}")

    raise FusouDatasetsError("Download failed after retries")


def _download_files(files: list, table: str, show_progress: bool = True) -> pd.DataFrame:
    """Download files and return combined DataFrame with fail-fast validation."""
    if not files:
        raise DatasetNotFoundError(f"No files to download for table '{table}'")
    
    dfs = []
    api_url = _config.get("api_url", DEFAULT_API_URL)
    import urllib.parse
    parsed = urllib.parse.urlparse(api_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    file_iter = tqdm(files, desc=f"Loading {table}", unit="file", disable=not show_progress)
    for f in file_iter:
        url = f.get("download_url")
        if url and url.startswith("/"):
            url = f"{base_url}{url}"
            
        if url:
            try:
                expected_hash = f.get("content_hash") or f.get("sha256") or f.get("sp_effect_sha256")
                df_part = _download_avro(url, expected_hash=expected_hash)
                dfs.append(_normalize_dataframe(df_part))
            except Exception as e:
                raise FusouDatasetsError(
                    f"Failed to download partition file '{f.get('file_path')}': {e}\n"
                    "Aborting load to prevent partial/corrupted dataset from being returned."
                ) from e
    
    if not dfs:
        raise FusouDatasetsError(
            f"No files downloaded (out of {len(files)} files).\n"
            "This usually indicates a network issue, permission problem, or server-side error."
        )
    
    combined_df = pd.concat(dfs, ignore_index=True)
    sort_cols = [c for c in ["timestamp", "index", "uuid", "id"] if c in combined_df.columns]
    if sort_cols:
        combined_df = combined_df.sort_values(by=sort_cols).reset_index(drop=True)
    return combined_df


def list_tables(_retry: bool = True) -> List[str]:
    """List all available dataset tables."""
    resp = _request("GET", "/tables")
    if resp.status_code == 200:
        return resp.json().get("tables", [])
    elif resp.status_code == 403 and _retry:
        return _handle_403(resp, list_tables)
    else:
        _raise_api_error(resp, "Failed to list tables")
    return []


def list_period_tags(_retry: bool = True) -> Dict[str, Any]:
    """List available period tags."""
    resp = _request("GET", "/period-tags")
    if resp.status_code == 200:
        return resp.json()
    elif resp.status_code == 403 and _retry:
        return _handle_403(resp, list_period_tags)
    else:
        _raise_api_error(resp, "Failed to list period tags")
    return {}


def load(
    table: TableInput,
    period_tag: Optional[str] = None,
    limit: int = 100,
    show_progress: bool = True,
    force_download: bool = False,
    offline: bool = False,
    scope: str = "all",
    split: SplitLiteral = "train",
    table_version: Optional[str] = None
) -> pd.DataFrame:
    if period_tag is None:
        period_tag = _config.get("period_tag", "latest")
    if table_version is None:
        table_version = _config.get("table_version")
    """
    Load data for a table.
    
    Args:
        table: Table name (use list_tables() to see options)
        period_tag: "latest", "all", or specific tag
        limit: Max files to load
        show_progress: Show download progress bar
        force_download: Force re-download even if cached
        offline: Use cached data without server validation
        scope: "all" (all users' data, default) or "own" (your uploads only)
        table_version: Table version to load (e.g., "0.4")
        
    Returns:
        pd.DataFrame: Combined data from all matching files
    """
    table = resolve_table_name(table)
    cache_dir = _config.get("cache_dir")
    
    if scope not in ("own", "all"):
        raise ValueError(f"scope must be 'own' or 'all', got '{scope}'")
    
    valid_splits = ("train", "validation", "test", "train+validation")
    if split not in valid_splits:
        raise ValueError(f"split must be one of {valid_splits}, got '{split}'")
    
    resolved_cache_version = None
    if cache_dir and not force_download:
        resolved_cache_version = _resolve_cached_table_version(cache_dir, table, table_version)
        if resolved_cache_version:
            cache_path = Path(cache_dir) / table / resolved_cache_version / period_tag / split
        else:
            cache_path = None
        manifest_path = cache_path / "manifest.json" if cache_path else None
        data_path = cache_path / "data.parquet" if cache_path else None
        
        if cache_path and data_path and manifest_path and data_path.exists() and manifest_path.exists():
            if offline:
                print(f"[Cache] Loading {table} from cache (offline)", file=sys.stderr)
                return pd.read_parquet(data_path)
            
            try:
                url = f"/data/{table}?period_tag={period_tag}&limit={limit}&scope={scope}&split={split}"
                effective_request_version = table_version or resolved_cache_version
                if effective_request_version:
                    url += f"&table_version={effective_request_version}"
                resp = _request("GET", url)
                if resp.status_code == 200:
                    files = resp.json().get("files", [])
                    detected_version = _get_latest_table_version(files)
                    
                    if not table_version and detected_version:
                        import warnings
                        warnings.warn(
                            f"table_version was not specified; automatically using latest detected version '{detected_version}'. "
                            f"To ensure reproducibility, explicitly pass table_version='{detected_version}'.",
                            UserWarning,
                            stacklevel=2
                        )
                        versions = {f.get("table_version") for f in files if f.get("table_version")}
                        if len(versions) > 1:
                            files = _filter_files_by_version(files, detected_version)
                    
                    current_hash = _compute_files_hash(files)
                    with open(manifest_path, "r", encoding="utf-8") as f:
                        manifest = json.load(f)
                    
                    if manifest.get("hash") == current_hash:
                        print(f"[Cache] Loading {table} from cache (valid)", file=sys.stderr)
                        return pd.read_parquet(data_path)
                    else:
                        print(f"[Cache] Data updated, re-downloading {table}", file=sys.stderr)
                        df = _download_files(files, table, show_progress)
                        _save_to_cache(table, period_tag, detected_version or table_version or "unknown", df, files, split=split)
                        return df
            except Exception as e:
                print(f"[Cache] Validation failed, re-downloading: {e}", file=sys.stderr)
        elif offline:
            raise DatasetNotFoundError(
                f"? No cached data for '{table}' (period_tag='{period_tag}')\n\n"
                "Offline mode requires cached data. To fix:\n"
                f"  1. Run: fusou_datasets.load('{table}', period_tag='{period_tag}')\n"
                "  2. Then use: fusou_datasets.load(..., offline=True)"
            )
    elif offline:
        raise DatasetNotFoundError(
            "? Offline mode requires cache configuration\n\n"
            "To use offline mode:\n"
            "  1. Configure cache: fusou_datasets.configure(cache_dir='~/.fusou_datasets/cache')\n"
            f"  2. Load data once: fusou_datasets.load('{table}')\n"
            "  3. Then use: fusou_datasets.load(..., offline=True)"
        )
    
    # Online download flow
    url = f"/data/{table}?period_tag={period_tag}&limit={limit}&scope={scope}&split={split}"
    if table_version:
        url += f"&table_version={table_version}"
    resp = _request("GET", url)
    if resp.status_code == 200:
        data = resp.json()
        files = data.get("files", [])
        if not files:
            raise DatasetNotFoundError(f"No data found for table '{table}' (period_tag='{period_tag}', scope='{scope}')")
        
        detected_version = _get_latest_table_version(files)
        if not table_version and detected_version:
            import warnings
            warnings.warn(
                f"table_version was not specified; automatically using latest detected version '{detected_version}'. "
                f"To ensure reproducibility, explicitly pass table_version='{detected_version}'.",
                UserWarning,
                stacklevel=2
            )
            versions = {f.get("table_version") for f in files if f.get("table_version")}
            if len(versions) > 1:
                files = _filter_files_by_version(files, detected_version)
        
        df = _download_files(files, table, show_progress)
        _save_to_cache(table, period_tag, detected_version or table_version or "unknown", df, files, split=split)
        return df
    else:
        _raise_api_error(resp, f"Failed to load table '{table}'")
    return pd.DataFrame()