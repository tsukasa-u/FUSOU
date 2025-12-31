# Fusou Datasets

Multi-language SDK for accessing FUSOU research datasets.

## Structure

```
fusou-datasets/
├── python/     → PyPI: fusou-datasets
└── (future)    → Julia, R, etc.
```

## Python

```bash
pip install fusou-datasets
```

```python
import fusou_datasets
tables = fusou_datasets.list_tables()
df = fusou_datasets.load("ship_type")
```

See [python/README.md](python/README.md) for details.

## Authentication

All clients require:

1. API key (via environment variable `FUSOU_API_KEY`)
2. Device verification (email OTP on first use)
