use anyhow::{Context, Result};
use polars::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanJobData {
    pub feature_names: Vec<String>,
    pub correlations: HashMap<String, f64>,
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

/// JSONを読み込み、前処理とフィーチャー選択を実行
pub fn clean_and_select_features(
    json_str: &str,
    target_column: &str,
    correlation_threshold: f64,
    min_features: usize,
) -> Result<CleanJobData> {
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

    // ターゲット列を取得
    let target_series = df
        .column(target_column)
        .context("Failed to get target column")?
        .cast(&DataType::Float64)
        .context("Failed to cast target to Float64")?;

    // ターゲット統計
    let target_vec: Vec<f64> = target_series
        .f64()
        .context("Failed to convert target to f64")?
        .into_iter()
        .filter_map(|v| v)
        .collect();

    let target_mean = target_vec.iter().sum::<f64>() / target_vec.len() as f64;
    let target_variance = target_vec.iter().map(|v| (v - target_mean).powi(2)).sum::<f64>()
        / target_vec.len() as f64;
    let target_std = target_variance.sqrt();

    let target_stats = TargetStats {
        mean: target_mean,
        std: target_std,
        min: target_vec
            .iter()
            .copied()
            .min_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(0.0),
        max: target_vec
            .iter()
            .copied()
            .max_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(0.0),
    };

    tracing::info!(
        "Target stats: mean={:.2}, std={:.2}, min={:.2}, max={:.2}",
        target_stats.mean,
        target_stats.std,
        target_stats.min,
        target_stats.max
    );

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

    // 8. データを Vec<Vec<f64>> に変換 (ターゲット列は除外)
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

    tracing::info!("Final data shape: {} rows x {} features", data.len(), selected_features.len());

    Ok(CleanJobData {
        feature_names: selected_features,
        correlations: correlations
            .into_iter()
            .filter(|(name, _)| final_cols.contains(name))
            .collect(),
        data,
        target_stats,
    })
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
