# fusou-datasets Python SDK

Secure, reproducible data loader for FUSOU research datasets.

## Installation

```bash
pip install fusou-datasets
```

## Quick Start

```python
import fusou_datasets as fd

# Configure session defaults
fd.configure(
    period_tag="latest",
    table_version="0.6.0",
    cache_dir="./data/cache",
    api_key="your_api_key",
)

# Load battle records (3-tier split: train, validation, test)
df_cells = fd.load("cells", split="train")

# Load equipment synergy data
synergy = fd.load_synergy(period_tag="latest")
print("Single bonuses:", len(synergy.single_bonuses))
print("Cross synergies:", len(synergy.cross_synergies))

# Load ship stat growth curves (naked stats and caps)
growth = fd.load_growth_snapshot(period_tag="latest")
```

## Configuration

Set credentials and defaults globally or via environment variables:

```python
fd.configure(
    api_key="your_key",
    cache_dir="./data/cache",
    period_tag="latest",
    table_version="0.6.0",
)

# Inspect current configuration
print(fd.get_config())
```

Or via environment variables:
```bash
export FUSOU_API_KEY="your_key"
export FUSOU_PERIOD_TAG="latest"
export FUSOU_TABLE_VERSION="0.6.0"
export FUSOU_CACHE_DIR="./data/cache"
```

## 3-Tier Data Split

To prevent data leakage and ensure scientific reproducibility, datasets are split deterministically:
- `split="train"` (70%): For training models, estimating parameters, and exploratory data analysis.
- `split="validation"` (20%): For public verification on `fusou-web`. Access is audit-logged.
- `split="test"` (10%): Held-out test set for blind evaluation. Regular API keys will receive HTTP 403.

```python
train_data = fd.load("cells", split="train")
val_data = fd.load("cells", split="validation")
```

## Caching

When `cache_dir` is configured, datasets are saved in local Parquet and JSON files:
- **Battle tables**: `{cache_dir}/{table}/{table_version}/{period_tag}/{split}/data.parquet`
- **Synergy data**: `{cache_dir}/synergy/{period_tag}/synergy.json`
- **Growth curves**: `{cache_dir}/growth/{table_version}/{period_tag}/bounds.parquet`

```python
# Load from cache without contacting the server
df = fd.load("cells", offline=True)
synergy = fd.load_synergy(offline=True)

# Force re-download from server even if cached
df = fd.load("cells", force_download=True)
```

## Synergy Data

```python
synergy = fd.load_synergy(period_tag="latest")

# Filter single item bonuses by ship ID
ship_bonuses = synergy.query(ship_id=1)

# Export to Parquet for fast analytics
synergy.to_parquet("./data/cache/synergy")
```

## Fluent Query Builder

```python
ds = fd.VerificationDataset("cells", split="validation")

# Filter with Django-style expressions
results = (
    ds.filter(maparea_id=45, mapinfo_no__in=[1, 2])
      .select("maparea_id", "mapinfo_no", "cell_id")
      .limit(500)
      .to_dataframe()
)
```

## API Reference

| Function / Class | Description |
| ---------------- | ----------- |
| `configure(...)` | Set global API key, URL, cache_dir, period_tag, table_version |
| `get_config()` | Return dictionary of current configuration |
| `save_api_key(key)` | Persist API key to ~/.fusou-datasets/settings.json |
| `list_tables()` | List available dataset tables |
| `list_period_tags()` | List available period tags |
| `load(table, ...)` | Load dataset as DataFrame (split: train, validation, test) |
| `load_synergy(...)` | Load equipment synergy rules and bonuses |
| `load_growth_snapshot(...)` | Load ship parameter growth curves |
| `load_speed_observation(...)` | Load speed observation records |
| `load_master(table, ...)` | Load master-data table |
| `VerificationDataset(...)` | Fluent dataset interface for hypothesis verification |
| `clear_cache(table=None)` | Clear local cache |
