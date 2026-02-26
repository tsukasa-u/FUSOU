"""Phase 1: Data-driven feature selection.

Ranks input variables by their relevance to the target using three
complementary, assumption-free methods:

1. **Mutual information** (``sklearn.feature_selection.mutual_info_regression``)
   — captures arbitrary (non-linear) statistical dependence.
2. **Tree-based importance** (``sklearn.ensemble.RandomForestRegressor``)
   — measures impurity-based feature importance.
3. **Permutation importance** (``sklearn.inspection.permutation_importance``)
   — measures importance by performance drop when a feature is shuffled.

References
----------
- Kraskov, Stögbauer & Grassberger (2004) — MI estimation via k-NN.
- Breiman (2001) — Random Forest feature importance.
- Altman & Toloşi (2010) — Permutation importance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.feature_selection import mutual_info_regression
from sklearn.inspection import permutation_importance


@dataclass
class FeatureRank:
    """Importance score for a single feature.

    Attributes
    ----------
    name : str
        Column name.
    mi_score : float
        Mutual information score (bits).
    tree_importance : float
        Mean Decrease Impurity from Random Forest.
    permutation_importance : float
        Mean drop in R² when the feature is permuted.
    combined_rank : float
        Aggregated rank (lower is more important).
    """

    name: str
    mi_score: float = 0.0
    tree_importance: float = 0.0
    permutation_importance: float = 0.0
    combined_rank: float = 0.0


@dataclass
class FeatureSelectionResult:
    """Result of Phase 1 feature selection.

    Attributes
    ----------
    rankings : list of FeatureRank
        Features ranked by combined importance (most important first).
    selected_features : list of str
        Features meeting the selection threshold.
    all_features : list of str
        All candidate features evaluated.
    target_col : str
        The target column.
    metadata : dict
        Additional info (thresholds, RF out-of-bag score, etc.).
    """

    rankings: List[FeatureRank] = field(default_factory=list)
    selected_features: List[str] = field(default_factory=list)
    all_features: List[str] = field(default_factory=list)
    target_col: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


class FeatureSelector:
    """Select relevant features using data-driven importance measures.

    Parameters
    ----------
    n_estimators : int
        Number of trees in the Random Forest.
    mi_neighbors : int
        Number of neighbors for MI estimation (k in k-NN).
    n_permutations : int
        Number of permutation repeats for permutation importance.
    selection_threshold : float
        Minimum combined normalised score (0–1) to keep a feature.
        Features below this threshold are dropped.
    max_features : int or None
        Maximum number of features to select.  If *None*, no limit
        (only *selection_threshold* applies).
    random_state : int
        Seed for reproducibility.
    """

    def __init__(
        self,
        n_estimators: int = 200,
        mi_neighbors: int = 5,
        n_permutations: int = 10,
        selection_threshold: float = 0.05,
        max_features: Optional[int] = None,
        random_state: int = 42,
    ) -> None:
        self.n_estimators = n_estimators
        self.mi_neighbors = mi_neighbors
        self.n_permutations = n_permutations
        self.selection_threshold = selection_threshold
        self.max_features = max_features
        self.random_state = random_state

    def fit(
        self,
        df: pd.DataFrame,
        target_col: str,
        candidate_features: List[str],
    ) -> FeatureSelectionResult:
        """Evaluate and rank all candidate features.

        Parameters
        ----------
        df : DataFrame
            Input data.
        target_col : str
            Target column name.
        candidate_features : list of str
            Candidate feature column names.

        Returns
        -------
        FeatureSelectionResult
        """
        if target_col not in df.columns:
            raise ValueError(f"Target column '{target_col}' not in DataFrame")

        # Filter to valid features present in the DataFrame
        features = [c for c in candidate_features if c in df.columns]
        if not features:
            raise ValueError("No valid candidate features found in DataFrame")

        # Prepare clean numeric arrays
        work = df[features + [target_col]].copy()
        work = work.dropna().reset_index(drop=True)

        if len(work) < 10:
            raise ValueError(
                f"Not enough non-NaN rows ({len(work)}) for feature selection"
            )

        X = work[features].values.astype(np.float64)
        y = work[target_col].values.astype(np.float64)

        # --- 1. Mutual Information ---
        mi_scores = mutual_info_regression(
            X, y,
            n_neighbors=self.mi_neighbors,
            random_state=self.random_state,
        )

        # --- 2. Tree-based importance ---
        rf = RandomForestRegressor(
            n_estimators=self.n_estimators,
            max_depth=None,
            random_state=self.random_state,
            n_jobs=-1,
            oob_score=True,
        )
        rf.fit(X, y)
        tree_importances = rf.feature_importances_
        oob_score = rf.oob_score_

        # --- 3. Permutation importance ---
        perm_result = permutation_importance(
            rf, X, y,
            n_repeats=self.n_permutations,
            random_state=self.random_state,
            n_jobs=-1,
        )
        perm_importances = perm_result.importances_mean

        # --- Aggregate rankings ---
        rankings = self._aggregate_rankings(
            features, mi_scores, tree_importances, perm_importances,
        )

        # --- Select features ---
        selected = self._select_features(rankings)

        return FeatureSelectionResult(
            rankings=rankings,
            selected_features=selected,
            all_features=features,
            target_col=target_col,
            metadata={
                "n_samples": len(work),
                "oob_r2": float(oob_score),
                "selection_threshold": self.selection_threshold,
                "max_features": self.max_features,
            },
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _aggregate_rankings(
        self,
        features: List[str],
        mi_scores: np.ndarray,
        tree_importances: np.ndarray,
        perm_importances: np.ndarray,
    ) -> List[FeatureRank]:
        """Combine three importance measures into a single ranking.

        Each measure is normalised to [0, 1] by dividing by its maximum,
        then averaged.  The combined score is used to produce the final
        ranking (higher = more important).
        """
        n = len(features)

        def _normalise(arr: np.ndarray) -> np.ndarray:
            mx = arr.max()
            if mx > 0:
                return arr / mx
            return np.zeros(n)

        mi_norm = _normalise(mi_scores)
        tree_norm = _normalise(tree_importances)
        perm_norm = _normalise(np.clip(perm_importances, 0.0, None))

        combined = (mi_norm + tree_norm + perm_norm) / 3.0

        rankings: List[FeatureRank] = []
        for i, fname in enumerate(features):
            rankings.append(FeatureRank(
                name=fname,
                mi_score=float(mi_scores[i]),
                tree_importance=float(tree_importances[i]),
                permutation_importance=float(perm_importances[i]),
                combined_rank=float(combined[i]),
            ))

        # Sort descending by combined score
        rankings.sort(key=lambda r: r.combined_rank, reverse=True)
        return rankings

    def _select_features(
        self,
        rankings: List[FeatureRank],
    ) -> List[str]:
        """Apply threshold and max_features to produce the final list."""
        selected = [
            r.name for r in rankings if r.combined_rank >= self.selection_threshold
        ]
        if not selected:
            # Always keep at least the top feature
            selected = [rankings[0].name] if rankings else []
        if self.max_features is not None and len(selected) > self.max_features:
            selected = selected[: self.max_features]
        return selected
