# Fusou Datasets

Secure data loader for FUSOU research datasets.

## Installation

```bash
pip install fusou-datasets
```

## Quick Start

```python
import fusou_datasets

# Show usage guide
fusou_datasets.help()

# API key loaded automatically from FUSOU_API_KEY env var
tables = fusou_datasets.list_tables()
df = fusou_datasets.load("ship_type")
```

## Configuration

```bash
export FUSOU_API_KEY="your_key"
```

Or save to config:

```python
fusou_datasets.save_api_key("your_key")
```

## Caching

```python
# Enable local caching
fusou_datasets.configure(cache_dir="~/.fusou_datasets/cache")

df = fusou_datasets.load("ship_type")  # Cached locally
df = fusou_datasets.load("ship_type", offline=True)  # Use cache only
df = fusou_datasets.load("ship_type", force_download=True)  # Force re-download

fusou_datasets.clear_cache()  # Clear all cache
```

## Query Engine (Cached Data Only)

```python
# Step 1: Load required tables
fusou_datasets.load("battle")
fusou_datasets.load("own_deck")

# Step 2: Query cached data
from fusou_datasets import Tables, query
result = query([Tables.Battle.TIMESTAMP, Tables.OwnDeck.UUID])
```

## API

| Function                        | Description                 |
| ------------------------------- | --------------------------- |
| `help()`                        | Show usage guide            |
| `list_tables()`                 | Get available table names   |
| `list_period_tags()`            | Get period tags and latest  |
| `load(table, ...)`              | Load data as DataFrame      |
| `query(columns)`                | Auto-join tables by columns |
| `clear_cache(table=None)`       | Clear cached data           |
| `configure(api_key, cache_dir)` | Configure API and caching   |

## CLI

```bash
fusou-datasets --tables
fusou-datasets --period-tags
fusou-datasets --client-id
```
