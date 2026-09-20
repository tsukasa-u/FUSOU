"""
fusou-datasets
~~~~~~~~~~~~~~

Secure data loader for FUSOU research datasets with Device Trust authentication.
"""

__version__ = "0.2.0"

# Terms Banner (display once on interactive import)
import sys

_BANNER_SHOWN = False

def help() -> None:
    """Print quick usage guide and available functions."""
    guide = f"""
================================================================================
Fusou Datasets SDK v{__version__} - Quick Guide
================================================================================

1. Configuration:
   fd.configure(api_key="...", cache_dir="./data/cache", period_tag="latest", table_version="0.6.0")
   fd.get_config()

2. Loading Datasets (3-tier split: train=70%, validation=20%, test=10%):
   df_train = fd.load("cells", split="train")
   df_val   = fd.load("cells", split="validation")
   df_local = fd.load("cells", offline=True)

3. Equipment Synergy & Ship Growth:
   synergy = fd.load_synergy(period_tag="latest")
   growth  = fd.load_growth_snapshot(period_tag="latest")

4. Verification & Queries:
   ds = fd.VerificationDataset("cells", split="validation")
   df = ds.filter(maparea_id=45).select("cell_id", "mapinfo_no").to_dataframe()

Documentation: https://fusou.dev/guide/fusou_datasets/
================================================================================
"""
    print(guide)

def _show_banner():
    global _BANNER_SHOWN
    if not _BANNER_SHOWN:
        _BANNER_SHOWN = True
        print(
            "\n" + "=" * 80 + "\n"
            f"Fusou Datasets v{__version__}\n"
            + "=" * 80 + "\n"
            "[EN] By using this library, you agree to use data for research purposes only.\n"
            "     Redistribution of raw data is prohibited. Visit: https://fusou.dev/terms\n"
            "[JP] このライブラリを使用することで、データは研究目的のみに使用することに同意します。\n"
            "     生データの再配布は禁止されています。詳細: https://fusou.dev/terms\n"
            + "-" * 80 + "\n"
            "Get your API Key at: https://fusou.dev/dashboard/api-keys\n"
            + "=" * 80 + "\n",
            file=sys.stderr
        )

# Show banner if interactive
if sys.stdout.isatty():
    _show_banner()

# Exceptions
from ._exceptions import (
    FusouDatasetsError,
    AuthenticationError,
    DeviceUnverifiedError,
    DatasetNotFoundError,
    VerificationError,
    RateLimitError,
    DownloadError,
)

# Configuration
from ._config import (
    configure,
    save_api_key,
    get_client_id,
    _config,
    _get_api_key,
    _get_client_id,
)

# Client & Low-level HTTP
from ._client import (
    _request,
    _handle_403,
    _raise_api_error,
)

# Cache Management
from ._cache import (
    clear_cache,
    _save_to_cache,
    _compute_files_hash,
)

# Dataset Loading
from ._loader import (
    load,
    list_tables,
    list_period_tags,
    _download_avro,
    _download_files,
    _normalize_dataframe,
)

# Master Data
from ._master import (
    load_master,
    list_master_tables,
    get_master_latest,
)

# Growth & Synergy
from ._growth import (
    load_growth_snapshot,
    load_speed_observation,
)
from ._synergy import (
    SynergyData,
    load_synergy,
)

# Fluent Query & Verification
from ._query_builder import DatasetQuery
from ._verification import VerificationDataset
# Schema & Query Engine
from .schema import Tables, Column, TableMeta, TableInput, TableLiteral, SplitLiteral, resolve_table_name, validate_schema
from .query_engine import query, register_relationship, REGISTRY

__all__ = [
    # Exceptions
    "FusouDatasetsError",
    "AuthenticationError",
    "DeviceUnverifiedError",
    "DatasetNotFoundError",
    "VerificationError",
    "RateLimitError",
    "DownloadError",
    # Configuration
    "configure",
    "save_api_key",
    "get_client_id",
    # Data Loading
    "load",
    "list_tables",
    "list_period_tags",
    "clear_cache",
    # Master Data
    "load_master",
    "list_master_tables",
    "get_master_latest",
    # Growth & Synergy
    "load_growth_snapshot",
    "load_speed_observation",
    "SynergyData",
    "load_synergy",
    # Schema & Query
    # Fluent Query & Verification
    "DatasetQuery",
    "VerificationDataset",
    "Tables",
    "Column",
    "TableMeta",
    "TableInput",
    "TableLiteral",
    "SplitLiteral",
    "resolve_table_name",
    "validate_schema",
    "query",
    "register_relationship",
]


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Fusou Datasets CLI")
    parser.add_argument("--version", action="version", version=f"fusou-datasets {__version__}")
    parser.add_argument("--client-id", action="store_true", help="Show client ID")
    parser.add_argument("--tables", action="store_true", help="List tables")
    parser.add_argument("--period-tags", action="store_true", help="List period tags")
    args = parser.parse_args()
    
    if args.client_id:
        print(f"Client ID: {get_client_id()}")
    elif args.tables:
        for t in list_tables():
            print(t)
    elif args.period_tags:
        info = list_period_tags()
        period_tags = info.get("period_tags") or []
        latest = info.get("latest")
        if period_tags:
            print("Available period tags:")
            for tag in period_tags:
                marker = " (latest)" if latest is not None and tag == latest else ""
                print(f"  {tag}{marker}")
        elif latest:
            print(f"Latest period tag: {latest}")
        else:
            print("No period tags available")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()