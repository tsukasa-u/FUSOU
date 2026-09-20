# FUSOU Datasets SDK

Python SDK for reproducible KanColle data science, game mechanics verification, and research datasets on [FUSOU](https://fusou.dev).

## Key Features

- **3-Tier Data Distribution**:
  - `train` (70%): Hypothesis generation, exploratory analysis, and parameter estimation.
  - `validation` (20%): Public hypothesis verification and reproducible research papers.
  - `test` (10%): Blind out-of-sample evaluation (held out on server, 403 Forbidden to regular keys).
- **Zero-Copy & High Performance**:
  - Multi-tier local caching using Apache Parquet and JSON.
  - PyArrow C Data Stream interface (`__arrow_c_stream__`) and Python Array API support.
- **Master Data & Synergy Integration**:
  - Schema-validated master datasets (`mst_ship`, `mst_slotitem`, etc.).
  - Equipment synergy bonuses (`load_synergy()`) and parameter growth curves (`load_growth_snapshot()`).
- **Fluent Query Builder**:
  - Django-style filtering (`DatasetQuery`), deterministic joins, and Jupyter HTML previews.

## Installation

```bash
pip install fusou-datasets
```

## Quick Start

```python
import fusou_datasets as fd

# 1. Global configuration (session-wide defaults)
fd.configure(
    period_tag="latest",       # e.g., '2026-09' or 'latest'
    table_version="0.6.0",      # Schema table version
    cache_dir="./data/cache",   # Enables local Parquet/JSON caching
    api_key="your_api_key",     # Or via FUSOU_API_KEY environment variable
)

# 2. Load battle data with 3-tier split
train_df = fd.load("cells", split="train")
val_df = fd.load("cells", split="validation")

# 3. Load equipment synergy bonuses
synergy = fd.load_synergy(period_tag="latest")
print(synergy.single_bonuses.head())
print(synergy.cross_synergies.head())

# 4. Load ship growth parameters
growth_df = fd.load_growth_snapshot(period_tag="latest")

# 5. Fluent query builder for verification
ds = fd.VerificationDataset("cells", split="validation")
q = ds.filter(maparea_id=45).select("maparea_id", "mapinfo_no", "cell_id")
print(q.to_dataframe().head())
```

## Documentation

- [Getting Started](../../docs/contents/guide/fusou_datasets/getting_started.md)
- [Installation](../../docs/contents/guide/fusou_datasets/installation.md)
- [Authentication & Device Trust](../../docs/contents/guide/fusou_datasets/authentication.md)
- [API Reference](../../docs/contents/guide/fusou_datasets/api_reference.md)
- [Verification Examples](../../docs/contents/guide/fusou_datasets/examples.md)
- [Troubleshooting](../../docs/contents/guide/fusou_datasets/troubleshooting.md)
