# Fusou Datasets

Secure data loader for FUSOU research datasets.

## Installation

```bash
pip install fusou-datasets
```

Or from source:

```bash
pip install -e packages/fusou-datasets/python
```

## Quick Start

```python
import fusou_datasets

# API key loaded automatically from FUSOU_API_KEY env var
tables = fusou_datasets.list_tables()
df = fusou_datasets.load("ship_type")
```

## Configuration

```bash
# Set API key (recommended)
export FUSOU_API_KEY="your_key"
```

Or save to config:

```python
fusou_datasets.save_api_key("your_key")
```

## API

| Function                           | Description                |
| ---------------------------------- | -------------------------- |
| `list_tables()`                    | Get available table names  |
| `list_period_tags()`               | Get period tags and latest |
| `load(table, period_tag="latest")` | Load data as DataFrame     |

## Period Tags

```python
df = fusou_datasets.load("ship_type")  # latest
df = fusou_datasets.load("ship_type", period_tag="2024-12")
df = fusou_datasets.load("ship_type", period_tag="all")
```

## CLI

```bash
fusou-datasets --tables
fusou-datasets --period-tags
fusou-datasets --client-id
```
