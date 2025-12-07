use anyhow::{Context, Result};
use polars::prelude::*;
use serde::{Deserialize, Serialize};
use smartcore::linalg::basic::matrix::DenseMatrix;
use smartcore::tree::decision_tree_regressor::{DecisionTreeRegressor, DecisionTreeRegressorParameters};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanJobData {
    pub feature_names: Vec<String>,
    pub correlations: HashMap<String, f64>,
    pub targets: Vec<f64>,
    pub data: Vec<Vec<f64>>,
    pub target_stats: TargetStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetStats {
    pub mean: f64,
    pub std: f64,
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeSplitJob {
    /// 量子化した予測値を使ったグループキー（leaf相当）
    pub leaf_key: String,
    /// 決定木が返した予測値（leafの代表値）
    pub predicted_value: f64,
    /// グループ化後のクリーン済みデータ
    pub job: CleanJobData,
}

/// JSONを読み込み、前処理とフィーチャー選択を実行
pub fn clean_and_select_features(
    json_str: &str,
    target_column: &str,
    correlation_threshold: f64,
    min_features: usize,
) -> Result<CleanJobData> {
    let (feature_names, data, targets, correlations, target_stats) =
        prepare_clean_data(json_str, target_column, correlation_threshold, min_features)?;

    Ok(CleanJobData {
        feature_names,
        correlations,
        targets,
        data,
        target_stats,
    })
}

/// 決定木（回帰木）でデータを自動分割し、leaf（予測値）ごとにジョブ化する
pub fn auto_split_by_tree(
    json_str: &str,
    target_column: &str,
    correlation_threshold: f64,
    min_features: usize,
    max_depth: u16,
    min_samples_leaf: usize,
) -> Result<Vec<TreeSplitJob>> {
    let (feature_names, data, targets, correlations, _target_stats) =
        prepare_clean_data(json_str, target_column, correlation_threshold, min_features)?;

    // smartcore用に行列を構築
    let x = DenseMatrix::from_2d_vec(&data);
    let params = DecisionTreeRegressorParameters::default()
        .with_max_depth(max_depth)
        .with_min_samples_leaf(min_samples_leaf);

    let tree = DecisionTreeRegressor::fit(&x, &targets, params)
        .context("Failed to fit decision tree regressor")?;

    let preds = tree
        .predict(&x)
        .context("Failed to run tree prediction for grouping")?;

    // 予測値を量子化して葉ごとにクラスタリング
    let mut buckets: HashMap<i64, (f64, Vec<usize>)> = HashMap::new();
    for (idx, pred) in preds.iter().enumerate() {
        if !pred.is_finite() {
            continue;
        }
        let key = quantize_prediction(*pred);
        let entry = buckets.entry(key).or_insert((*pred, Vec::new()));
        entry.1.push(idx);
    }

    let mut jobs = Vec::new();
    for (key, (pred_value, indices)) in buckets.into_iter() {
        let mut subset_data = Vec::with_capacity(indices.len());
        let mut subset_targets = Vec::with_capacity(indices.len());
        for idx in indices.iter().copied() {
            if let Some(row) = data.get(idx) {
                subset_data.push(row.clone());
            }
            if let Some(t) = targets.get(idx) {
                subset_targets.push(*t);
            }
        }

        // Leafごとのターゲット統計を計算
        let stats = compute_stats(&subset_targets);

        let clean = CleanJobData {
            feature_names: feature_names.clone(),
            correlations: correlations.clone(),
            targets: subset_targets.clone(),
            data: subset_data,
            target_stats: stats,
        };

        jobs.push(TreeSplitJob {
            leaf_key: format!("leaf_{}", key),
            predicted_value: pred_value,
            job: clean,
        });
    }

    // 予測値で安定ソート（再現性向上）
    jobs.sort_by(|a, b| a.predicted_value.partial_cmp(&b.predicted_value).unwrap_or(std::cmp::Ordering::Equal));

    Ok(jobs)
}

/// 前処理＋フィーチャー選択を実行し、学習と分割の両方で使える形式に整形
fn prepare_clean_data(
    json_str: &str,
    target_column: &str,
    correlation_threshold: f64,
    min_features: usize,
) -> Result<(Vec<String>, Vec<Vec<f64>>, Vec<f64>, HashMap<String, f64>, TargetStats)> {
    // 1. JSON読み込み
    let mut df = JsonReader::new(std::io::Cursor::new(json_str.as_bytes()))
        .finish()
        .context("Failed to parse JSON")?;

    tracing::info!("Initial columns: {:?}", df.get_column_names());
    tracing::info!("Initial shape: {:?}", df.shape());

    // Struct型カラムを展開 (1階層)
    df = unnest_struct_columns(df)?;

    tracing::info!("After unnesting: {:?}", df.get_column_names());

    // 2. ターゲット列の検証
    if !df.get_column_names().contains(&target_column) {
        anyhow::bail!("Target column '{}' not found", target_column);
    }

    // ターゲット列を取得（Float64化）
    let target_series = df
        .column(target_column)
        .context("Failed to get target column")?
        .cast(&DataType::Float64)
        .context("Failed to cast target to Float64")?;

    // 3. 数値型以外の列を削除 (ターゲット列は保持)
    let numeric_cols: Vec<String> = df
        .get_columns()
        .iter()
        .filter(|col| {
            matches!(
                col.dtype(),
                DataType::Int8
                    | DataType::Int16
                    | DataType::Int32
                    | DataType::Int64
                    | DataType::UInt8
                    | DataType::UInt16
                    | DataType::UInt32
                    | DataType::UInt64
                    | DataType::Float32
                    | DataType::Float64
            )
        })
        .map(|col| col.name().to_string())
        .collect();

    df = df.select(&numeric_cols).context("Failed to select numeric columns")?;

    tracing::info!("After numeric filter: {:?}", df.get_column_names());

    // 4. 欠損値を0.0で埋める
    let fill_cols: Vec<_> = df
        .get_column_names()
        .iter()
        .map(|name| {
            col(name).fill_null(lit(0.0))
        })
        .collect();

    df = df
        .lazy()
        .select(fill_cols)
        .collect()
        .context("Failed to fill nulls")?;

    // 5. 分散が0の列を削除
    let mut variance_filtered_cols = Vec::new();
    for col_name in df.get_column_names() {
        if col_name == target_column {
            variance_filtered_cols.push(col_name.to_string());
            continue;
        }

        let series = df.column(col_name)?;
        let f64_series = series.cast(&DataType::Float64)?;
        let values: Vec<f64> = f64_series
            .f64()?
            .into_iter()
            .filter_map(|v| v)
            .collect();

        if values.is_empty() {
            continue;
        }

        let mean = values.iter().sum::<f64>() / values.len() as f64;
        let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64;

        if variance > 1e-10 {
            variance_filtered_cols.push(col_name.to_string());
        } else {
            tracing::debug!("Dropping zero-variance column: {}", col_name);
        }
    }

    df = df.select(&variance_filtered_cols)?;

    tracing::info!("After variance filter: {:?}", df.get_column_names());

    // 6. 相関係数を計算してフィーチャー選択
    let mut correlations: HashMap<String, f64> = HashMap::new();

    for col_name in df.get_column_names() {
        if col_name == target_column {
            continue;
        }

        let feature_series = df.column(col_name)?;
        let f64_series = feature_series.cast(&DataType::Float64)?;

        let correlation = calculate_spearman_correlation(&f64_series, &target_series)?;
        correlations.insert(col_name.to_string(), correlation);
    }

    // 相関の絶対値でソート
    let mut sorted_features: Vec<_> = correlations.iter().collect();
    sorted_features.sort_by(|a, b| {
        b.1.abs()
            .partial_cmp(&a.1.abs())
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Top-K保証: 最低でもmin_features個は残す
    let selected_features: Vec<String> = sorted_features
        .iter()
        .filter(|(_, corr)| corr.abs() >= correlation_threshold)
        .map(|(name, _)| name.to_string())
        .chain(
            sorted_features
                .iter()
                .take(min_features)
                .map(|(name, _)| name.to_string()),
        )
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    if selected_features.is_empty() {
        anyhow::bail!("No features passed correlation threshold");
    }

    tracing::info!(
        "Selected {} features after correlation filter",
        selected_features.len()
    );

    // 7. 選択されたフィーチャーのみでDataFrameを再構築
    let mut final_cols = selected_features.clone();
    final_cols.push(target_column.to_string());
    df = df.select(&final_cols)?;

    // 8. データとターゲットを抽出
    let data: Vec<Vec<f64>> = (0..df.height())
        .map(|row_idx| {
            selected_features
                .iter()
                .filter_map(|col_name| {
                    df.column(col_name)
                        .ok()
                        .and_then(|col| {
                            col.cast(&DataType::Float64)
                                .ok()
                                .and_then(|series| {
                                    series.f64()
                                        .ok()
                                        .and_then(|ca| ca.get(row_idx))
                                })
                        })
                })
                .collect()
        })
        .collect();

    let targets: Vec<f64> = df
        .column(target_column)?
        .cast(&DataType::Float64)?
        .f64()?
        .into_iter()
        .filter_map(|v| v)
        .collect();

    tracing::info!("Final data shape: {} rows x {} features", data.len(), selected_features.len());

    let target_stats = compute_stats(&targets);

    Ok((selected_features, data, targets, correlations, target_stats))
}

/// Struct型のカラムを展開 (1階層のみ)
fn unnest_struct_columns(df: DataFrame) -> Result<DataFrame> {
    let mut result = df.clone();
    let struct_cols: Vec<String> = result
        .get_columns()
        .iter()
        .filter(|col| matches!(col.dtype(), DataType::Struct(_)))
        .map(|col| col.name().to_string())
        .collect();

    for col_name in struct_cols {
        tracing::debug!("Unnesting struct column: {}", col_name);
        result = result
            .lazy()
            .unnest([col_name.as_str()])
            .collect()
            .context(format!("Failed to unnest column '{}'", col_name))?;
    }

    Ok(result)
}

/// Spearman順位相関を計算 (簡易実装: Pearson相関で代用)
fn calculate_spearman_correlation(feature: &Series, target: &Series) -> Result<f64> {
    let f_values: Vec<f64> = feature
        .cast(&DataType::Float64)?
        .f64()?
        .into_iter()
        .filter_map(|v| v)
        .collect();

    let t_values: Vec<f64> = target
        .cast(&DataType::Float64)?
        .f64()?
        .into_iter()
        .filter_map(|v| v)
        .collect();

    if f_values.len() != t_values.len() || f_values.is_empty() {
        return Ok(0.0);
    }

    let n = f_values.len() as f64;
    let f_mean = f_values.iter().sum::<f64>() / n;
    let t_mean = t_values.iter().sum::<f64>() / n;

    let mut numerator = 0.0;
    let mut f_var = 0.0;
    let mut t_var = 0.0;

    for (f, t) in f_values.iter().zip(t_values.iter()) {
        let f_diff = f - f_mean;
        let t_diff = t - t_mean;
        numerator += f_diff * t_diff;
        f_var += f_diff * f_diff;
        t_var += t_diff * t_diff;
    }

    if f_var == 0.0 || t_var == 0.0 {
        return Ok(0.0);
    }

    Ok(numerator / (f_var.sqrt() * t_var.sqrt()))
}

/// 予測値を量子化して leaf を識別しやすくする
fn quantize_prediction(pred: f64) -> i64 {
    (pred * 1_000_000.0).round() as i64
}

/// 簡易統計を計算
fn compute_stats(values: &[f64]) -> TargetStats {
    if values.is_empty() {
        return TargetStats {
            mean: 0.0,
            std: 0.0,
            min: 0.0,
            max: 0.0,
        };
    }

    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|v| (v - mean).powi(2))
        .sum::<f64>()
        / values.len() as f64;
    let std = variance.sqrt();
    let min = values
        .iter()
        .copied()
        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or(0.0);
    let max = values
        .iter()
        .copied()
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or(0.0);

    TargetStats { mean, std, min, max }
}
