# Improvements Backlog

現時点で未実装・改善予定の項目をまとめます（優先度が高いものから順）。

## 短期

- 構造化ログ: Hono/WorkflowのログをJSON化し、`requestId/userId/datasetId`を含める。
- CORS重複の整理: ルート個別の`app.options('*')`が残っている場合、グローバルCORSに寄せてシンプル化。

## 中期

- 型の厳格化: R2アクセス周り（utils.tsなど）の`any`を排除し型を明示。
- アラート整備: DLQ件数や`compaction_in_progress`が長時間 true の場合に通知する仕組みを追加。
- 監査ログ/メトリクス送信: Queue処理結果を外部監視（Dash/Cloudflare Analytics/Supabase）に送るパスを追加。

## 備考

- 上記は随時更新します。実装が完了したものは本ファイルから削除し、`COMPACTION_OVERVIEW.md` 等に反映してください。
