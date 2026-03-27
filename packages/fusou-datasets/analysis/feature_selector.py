"""
Module 0: Feature Selector -- Automated identification of relevant variables.

============================================================
What this module does
============================================================
Given a wide dataset with many candidate variables (including noise or
irrelevant game state flags), this module automatically selects the Top-K
most important features that influence the target variable (e.g., damage).

It uses a combination of:
    - Target encoding / Ordinal encoding for categoricals.
    - Random Forest Feature Importance.
    - Mutual Information Regression.

Variables
---------
    Input X (candidate_x_cols): A list of many predictor column names.
    Input Y (y_col): Observed damage.
    Output: DataFrame containing only the selected Top-K variables and Y.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd


@dataclass
class FeatureSelectionResult:
    """Result of the Feature Selector stage.

    Attributes:
        clean_df: DataFrame containing only the selected X columns and Y.
        selected_cols: The subset of X columns chosen.
        importance_scores: Dictionary mapping column name to its score (0 to 1).
        y_col: The target variable.
        method: The algorithmic method used for selection.
    """
    clean_df: pd.DataFrame
    selected_cols: List[str]
    importance_scores: Dict[str, float]
    y_col: str
    method: str


class FeatureSelector:
    """Automatically selects relevant variables from a wide dataset.

    Example:
        >>> selector = FeatureSelector(top_k=3)
        >>> result = selector.select(
        ...     df,
        ...     candidate_x_cols=["karyoku", "soukou", "weather", "noise_1"],
        ...     y_col="damage"
        ... )
        >>> print(result.selected_cols)
        ['karyoku', 'soukou']
    """

    def __init__(
        self,
        top_k: int = 3,
        method: str = "random_forest",
        random_state: int = 42,
    ) -> None:
        """Initialise the feature selector.

        Args:
            top_k: Maximum number of variables to keep.
            method: 'random_forest' or 'mutual_info'.
            random_state: Seed for reproducibility.
        """
        self.top_k = top_k
        if method not in ("random_forest", "mutual_info"):
            raise ValueError(f"Unknown feature selection method: {method}")
        self.method = method
        self.random_state = random_state

    def select(
        self,
        df: pd.DataFrame,
        candidate_x_cols: List[str],
        y_col: str,
        force_keep_cols: Optional[List[str]] = None,
    ) -> FeatureSelectionResult:
        """Select top features correlated with the target.

        Args:
            df: Raw DataFrame containing candidate columns and target.
            candidate_x_cols: List of all possible predictors.
            y_col: The target column to predict.
            force_keep_cols: List of columns to always include in the 
                output regardless of their importance score.

        Returns:
            FeatureSelectionResult holding the selected data and scores.
        """
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.feature_selection import mutual_info_regression
        from sklearn.preprocessing import OrdinalEncoder

        # Ensure all columns exist
        available_cols = [c for c in candidate_x_cols if c in df.columns]
        missing = set(candidate_x_cols) - set(available_cols)
        if missing:
            warnings.warn(f"Missing candidate columns dropped: {missing}")

        if not available_cols:
            raise ValueError("No valid candidate columns available.")
            
        force_keep = force_keep_cols or []
        force_keep = [c for c in force_keep if c in available_cols]

        # Extract data and drop rows with missing target
        work_df = df[available_cols + [y_col]].dropna(subset=[y_col]).copy()

        # Handle NaNs in predictors: fill numeric with median, object with mode
        for col in available_cols:
            is_cat = (
                work_df[col].dtype.name in ("category", "object", "string", "boolean")
                or pd.api.types.is_object_dtype(work_df[col])
                or pd.api.types.is_string_dtype(work_df[col])
            )
            if is_cat:
                mode_val = work_df[col].mode().iloc[0] if not work_df[col].mode().empty else "Unknown"
                work_df[col] = work_df[col].fillna(mode_val)
            else:
                work_df[col] = work_df[col].fillna(work_df[col].median() if not work_df[col].empty else 0)

        X = work_df[available_cols]
        y = work_df[y_col]

        # Encode categorical variables for tree/MI algorithms
        encoders = {}
        X_encoded = X.copy()
        
        cat_cols = [c for c in available_cols if pd.api.types.is_object_dtype(X_encoded[c]) or pd.api.types.is_string_dtype(X_encoded[c]) or pd.api.types.is_categorical_dtype(X_encoded[c]) or pd.api.types.is_bool_dtype(X_encoded[c])]
        if cat_cols:
            encoder = OrdinalEncoder(handle_unknown='use_encoded_value', unknown_value=-1)
            X_encoded[cat_cols] = encoder.fit_transform(X_encoded[cat_cols])
        
        # Calculate Importances
        scores_dict = {}
        if self.method == "random_forest":
            model = RandomForestRegressor(
                n_estimators=50, 
                max_depth=7,
                random_state=self.random_state,
                n_jobs=-1
            )
            model.fit(X_encoded, y)
            importances = model.feature_importances_
            
            # Normalize to 0-1
            max_imp = importances.max() if importances.max() > 0 else 1.0
            for col, imp in zip(available_cols, importances):
                scores_dict[col] = float(imp / max_imp)

        elif self.method == "mutual_info":
            importances = mutual_info_regression(X_encoded, y, random_state=self.random_state)
            max_imp = importances.max() if importances.max() > 0 else 1.0
            for col, imp in zip(available_cols, importances):
                scores_dict[col] = float(imp / max_imp)

        # Sort columns by score descending
        sorted_cols = sorted(scores_dict.items(), key=lambda x: x[1], reverse=True)
        top_candidates = [col for col, score in sorted_cols]

        # Final selection: Start with force_keep, then add top candidates until top_k
        final_selection = list(force_keep)
        for col in top_candidates:
            if len(final_selection) >= self.top_k:
                break
            if col not in final_selection:
                final_selection.append(col)

        # Ensure we always have at least 1 feature
        if not final_selection and top_candidates:
            final_selection.append(top_candidates[0])

        # To keep X_cols ordered properly (primary feature first based on importance)
        final_selection = sorted(
            final_selection, 
            key=lambda x: scores_dict.get(x, 0.0), 
            reverse=True
        )

        # Filter the original dataframe correctly
        out_df = df[final_selection + [y_col]].copy()

        return FeatureSelectionResult(
            clean_df=out_df,
            selected_cols=final_selection,
            importance_scores=scores_dict,
            y_col=y_col,
            method=self.method,
        )

    @staticmethod
    def plot(
        result: FeatureSelectionResult,
        ax=None,
        title: Optional[str] = None,
    ):
        """Plot the feature importance scores as a horizontal bar chart."""
        import matplotlib.pyplot as plt

        if ax is None:
            _, ax = plt.subplots(figsize=(8, 6))

        # Sort for plotting (lowest at bottom, highest at top)
        sorted_scores = sorted(result.importance_scores.items(), key=lambda x: x[1])
        cols = [x[0] for x in sorted_scores]
        scores = [x[1] for x in sorted_scores]

        # Highlight selected columns
        colors = ["#2ecc71" if col in result.selected_cols else "#bdc3c7" for col in cols]

        y_pos = np.arange(len(cols))
        ax.barh(y_pos, scores, color=colors)
        ax.set_yticks(y_pos)
        ax.set_yticklabels(cols)
        ax.set_xlabel("Normalized Importance Score")
        ax.set_title(title or f"Feature Selection ({result.method})")
        
        # Add legend workaround
        from matplotlib.patches import Patch
        legend_elements = [
            Patch(facecolor='#2ecc71', label='Selected'),
            Patch(facecolor='#bdc3c7', label='Discarded')
        ]
        ax.legend(handles=legend_elements, loc='lower right')
        ax.grid(axis='x', linestyle='--', alpha=0.7)
        
        return ax
