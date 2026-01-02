---
title: fusou-datasets Troubleshooting
contributors: ["antigravity-ai"]
description: >-
  fusou-datasetsライブラリのトラブルシューティングガイド。認証エラー、ネットワークエラー、データが見つからない場合の解決方法とFAQ。
date: 2026-01-01
slug: guide/fusou_datasets/troubleshooting
tags: [guide, fusou_datasets, python, troubleshooting]
---

# fusou-datasets Troubleshooting

よくある問題と解決方法をまとめています。

## 認証関連のエラー

### `AuthenticationError: API key not configured`

**原因**: API キーが設定されていません。

**解決方法**:

```python
# 方法1: 環境変数で設定（推奨）
# bash: export FUSOU_API_KEY="your_key"

# 方法2: プログラムで設定
import fusou_datasets
fusou_datasets.configure(api_key="your_api_key")

# 方法3: 永続保存
fusou_datasets.save_api_key("your_api_key")
```

---

### `AuthenticationError: Invalid API key`

**原因**: API キーが無効または期限切れです。

**解決方法**:

1. [API キー管理ページ](/dashboard/api-keys) で有効なキーを確認
   - 管理方法は [API キー管理ガイド](../dashboard/api_keys) を参照
2. 必要に応じて新しいキーを発行
3. 正しいキーを設定する

```python
# キーを再設定
import fusou_datasets
fusou_datasets.save_api_key("new_valid_key")
```

---

### `AuthenticationError: Access denied`

**原因**: 認証は通ったがアクセス権限がありません。

**解決方法**:

- 利用条件を確認してください
- FUSOU サポートに問い合わせてください

---

## デバイス認証のエラー

### `VerificationError: Max attempts exceeded`

**原因**: 認証コードの入力を 3 回失敗しました。

**解決方法**:

1. メールアドレスを確認（API キーに紐づいたアドレス）
2. 迷惑メールフォルダを確認
3. しばらく待ってから再試行

```python
# 再度データにアクセスすると認証フローが始まります
import fusou_datasets
df = fusou_datasets.list_tables()  # 認証が再開
```

---

### `VerificationError: Verification cancelled`

**原因**: 認証コード入力がキャンセルされました（Ctrl+C など）。

**解決方法**:

再度 API を呼び出すと認証フローが開始されます。

---

### 認証コードが届かない

**確認事項**:

1. **メールアドレス**: API キーに紐づいたアドレスを確認
2. **迷惑メール**: スパムフォルダを確認
3. **待機時間**: 数分待ってから再試行

> [!TIP]
> Google Colab では、Google アカウントのメールアドレスが一致すれば自動認証されます。

---

## ネットワークエラー

### `FusouDatasetsError: Request failed: ...`

**原因**: ネットワーク接続の問題。

**確認事項**:

1. インターネット接続を確認
2. ファイアウォール設定を確認
3. プロキシ設定を確認

```python
# タイムアウトエラーの場合、少し待ってから再試行
import time
import fusou_datasets

for attempt in range(3):
    try:
        df = fusou_datasets.load("ship_type")
        break
    except Exception as e:
        print(f"試行 {attempt + 1} 失敗: {e}")
        time.sleep(5)  # 5秒待機
```

---

### `FusouDatasetsError: Download failed: ...`

**原因**: データファイルのダウンロード中にエラーが発生しました。

**解決方法**:

1. ネットワーク接続を確認
2. `limit` パラメータを小さくして試す

```python
# ファイル数を制限して読み込み
df = fusou_datasets.load("ship_type", limit=10)
```

---

## データ関連のエラー

### `DatasetNotFoundError: No data for 'table_name' with period_tag='...'`

**原因**: 指定したテーブルまたは期間タグにデータが存在しません。

**解決方法**:

```python
import fusou_datasets

# 利用可能なテーブルを確認
tables = fusou_datasets.list_tables()
print("利用可能なテーブル:", tables)

# 利用可能な期間タグを確認
info = fusou_datasets.list_period_tags()
print("利用可能な期間:", info['period_tags'])
print("最新期間:", info['latest'])
```

---

### `DatasetNotFoundError: No files for 'table_name'`

**原因**: テーブルは存在するがファイルがありません。

**解決方法**:

- 別の期間タグを試す
- `period_tag="all"` で全期間を試す

```python
df = fusou_datasets.load("ship_type", period_tag="all")
```

---

### `ValueError: Table name required`

**原因**: `load()` 関数にテーブル名が指定されていません。

**解決方法**:

```python
# ❌ 間違い
df = fusou_datasets.load("")

# ✓ 正しい
df = fusou_datasets.load("ship_type")
```

---

## インストール関連

### pip install が失敗する

**解決方法**:

```bash
# pip を最新版にアップデート
pip install --upgrade pip

# 再試行
pip install fusou-datasets
```

---

### fastavro のビルドエラー

**原因**: C コンパイラが必要です。

**Ubuntu/Debian**:

```bash
sudo apt-get install build-essential python3-dev
```

**macOS**:

```bash
xcode-select --install
```

**Windows**:
[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) をインストール

---

### ModuleNotFoundError: No module named 'fusou_datasets'

**原因**: パッケージがインストールされていないか、別の Python 環境にインストールされています。

**解決方法**:

```bash
# 現在の Python でインストール
python -m pip install fusou-datasets

# インストール確認
python -c "import fusou_datasets; print(fusou_datasets.__version__)"
```

---

## Google Colab 固有の問題

### Colab で認証が自動にならない

**原因**: Google アカウントのメールアドレスと API キーのメールアドレスが一致していません。

**解決方法**:

通常のコード認証にフォールバックされます。メールで届いたコードを入力してください。

---

### Secrets から API キーを読み込めない

**解決方法**:

1. Colab の左サイドバーで 🔑 アイコンをクリック
2. `FUSOU_API_KEY` という名前で API キーを追加
3. アクセスを有効化

```python
from google.colab import userdata
api_key = userdata.get('FUSOU_API_KEY')
print(f"API キー: {api_key[:8]}...")  # 先頭8文字のみ表示
```

---

## FAQ（よくある質問）

### Q: 無料で使えますか？

A: データセットへのアクセスには API キーが必要です。詳細は FUSOU ウェブサイトの利用規約を確認してください。

---

### Q: データの商用利用は可能ですか？

A: 研究目的に限定されています。商用利用については FUSOU チームにお問い合わせください。

---

### Q: データの更新頻度は？

A: 定期的に更新されます。最新の期間タグは `list_period_tags()` で確認できます。

---

### Q: オフラインで使えますか？

A: いいえ、データはオンラインで取得されます。ダウンロードしたデータを CSV などに保存してオフラインで分析することは可能です。

```python
df = fusou_datasets.load("ship_type")
df.to_csv("ship_type_offline.csv", index=False)
```

---

### Q: どのくらいのデータ容量ですか？

A: テーブルと期間によって異なります。`limit` パラメータで読み込むファイル数を制限できます。

---

### Q: 複数のマシンで使えますか？

A: はい。各マシンで初回認証（デバイス認証）が必要です。

---

## サポート

問題が解決しない場合:

- [GitHub Issues](https://github.com/tsukasa-u/FUSOU/issues) で報告
- [FUSOU ウェブサイト](https://fusou.dev) からサポートに連絡

---

## 関連ページ

- [クイックスタート](./getting_started)
- [認証設定](./authentication)
- [API リファレンス](./api_reference)
