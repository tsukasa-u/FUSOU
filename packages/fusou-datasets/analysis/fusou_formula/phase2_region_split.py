"""Phase 2: Data-driven region splitting (structural change-point detection).

Identifies sub-regions in the data where different functional relationships
may hold, using two complementary methods:

1. **CART regression tree** (``sklearn.tree.DecisionTreeRegressor``)
   — recursively partitions the feature space into regions of
   homogeneous residual behaviour.  The tree depth is selected via
   cost-complexity pruning with cross-validation.

2. **PELT change-point detection** (``ruptures.Pelt``)
   — finds abrupt distributional shifts in the target along each
   feature dimension.

The union of discovered split conditions is returned so that Phase 3
can run symbolic regression per-region independently.

References
----------
- Breiman et al. (1984) — CART.
- Killick, Fearnhead & Eckley (2012) — PELT algorithm.
- Truong, Oudre & Vayer (2020) — ``ruptures`` library.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeRegressor


@dataclass
class SplitCondition:
    """A single axis-aligned split discovered in the data.

    Attributes
    ----------
    feature : str
        The feature on which the split occurs.
    threshold : float
        The threshold value.
    method : str
        ``"cart"`` or ``"pelt"``.
    score : float
        A quality measure (e.g. variance reduction or BIC improvement).
    """

    feature: str
    threshold: float
    method: str = ""
    score: float = 0.0


@dataclass
class Region:
    """A rectangular sub-region defined by a set of conditions.

    Attributes
    ----------
    conditions : list of tuple
        List of ``(feature, op, threshold)`` triples, e.g.
        ``[("x", "<=", 50.0), ("z", ">", 10.0)]``.
    n_samples : int
        Number of data points in this region.
    y_mean : float
        Mean of the target in this region.
    y_std : float
        Std of the target in this region.
    """

    conditions: List[Tuple[str, str, float]] = field(default_factory=list)
    n_samples: int = 0
    y_mean: float = 0.0
    y_std: float = 0.0


@dataclass
class RegionSplitResult:
    """Result of Phase 2 region splitting.

    Attributes
    ----------
    splits : list of SplitCondition
        Unique split conditions discovered.
    regions : list of Region
        Resulting data regions after splitting.
    n_total_samples : int
        Total data points.
    split_tree_depth : int
        Depth of the pruned CART tree (0 = no split found).
    metadata : dict
        Additional info (pruning alpha, BIC values, etc.).
    """

    splits: List[SplitCondition] = field(default_factory=list)
    regions: List[Region] = field(default_factory=list)
    n_total_samples: int = 0
    split_tree_depth: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


class RegionSplitter:
    """Discover structural regions in the data.

    Parameters
    ----------
    max_depth : int
        Maximum depth for the CART tree (limits the number of splits).
    min_samples_leaf : int
        Minimum samples per leaf — prevents excessively small regions.
    pelt_penalty : str
        Penalty model for PELT (``"bic"``, ``"aic"``, or a float string).
    pelt_min_size : int
        Minimum segment size for PELT.
    use_pelt : bool
        Whether to run PELT in addition to CART.
    random_state : int
        Seed for reproducibility.
    """

    def __init__(
        self,
        max_depth: int = 4,
        min_samples_leaf: int = 30,
        pelt_penalty: str = "bic",
        pelt_min_size: int = 30,
        use_pelt: bool = True,
        random_state: int = 42,
    ) -> None:
        self.max_depth = max_depth
        self.min_samples_leaf = min_samples_leaf
        self.pelt_penalty = pelt_penalty
        self.pelt_min_size = pelt_min_size
        self.use_pelt = use_pelt
        self.random_state = random_state

    def fit(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> RegionSplitResult:
        """Find structural splits in the data.

        Parameters
        ----------
        df : DataFrame
            Input data.
        target_col : str
            Target column.
        feature_cols : list of str
            Feature columns to consider for splitting.

        Returns
        -------
        RegionSplitResult
        """
        work = df[feature_cols + [target_col]].dropna().reset_index(drop=True)
        if len(work) < 2 * self.min_samples_leaf:
            # Not enough data to split
            return RegionSplitResult(
                splits=[],
                regions=[self._make_single_region(work, target_col)],
                n_total_samples=len(work),
                split_tree_depth=0,
                metadata={"reason": "insufficient_data"},
            )

        X = work[feature_cols].values.astype(np.float64)
        y = work[target_col].values.astype(np.float64)

        # --- CART splits ---
        cart_splits, tree_depth, ccp_alpha = self._cart_splits(
            X, y, feature_cols,
        )

        # --- PELT splits (per feature) ---
        pelt_splits: List[SplitCondition] = []
        if self.use_pelt:
            pelt_splits = self._pelt_splits(work, target_col, feature_cols)

        # --- Merge and deduplicate ---
        all_splits = self._merge_splits(cart_splits, pelt_splits)

        # --- Build regions from the merged splits ---
        regions = self._build_regions(work, target_col, feature_cols, all_splits)

        return RegionSplitResult(
            splits=all_splits,
            regions=regions,
            n_total_samples=len(work),
            split_tree_depth=tree_depth,
            metadata={
                "ccp_alpha": ccp_alpha,
                "n_cart_splits": len(cart_splits),
                "n_pelt_splits": len(pelt_splits),
            },
        )

    def get_region_masks(
        self,
        df: pd.DataFrame,
        splits: List[SplitCondition],
        feature_cols: List[str],
    ) -> List[np.ndarray]:
        """Return boolean masks for each region defined by *splits*.

        Uses the CART-style recursive bisection: the first split divides
        the data into two halves, etc.  For simple usage, we use only
        the top-level splits and the masks are a Cartesian product of
        the binary conditions.
        """
        n = len(df)
        if not splits:
            return [np.ones(n, dtype=bool)]

        # Build condition masks per split
        cond_masks: List[Tuple[np.ndarray, np.ndarray]] = []
        for sp in splits:
            if sp.feature not in df.columns:
                continue
            vals = df[sp.feature].values.astype(np.float64)
            left = vals <= sp.threshold
            right = ~left
            cond_masks.append((left, right))

        if not cond_masks:
            return [np.ones(n, dtype=bool)]

        # Cartesian product of all masks
        region_masks: List[np.ndarray] = [np.ones(n, dtype=bool)]
        for left_mask, right_mask in cond_masks:
            new_masks: List[np.ndarray] = []
            for existing in region_masks:
                m_left = existing & left_mask
                m_right = existing & right_mask
                if m_left.any():
                    new_masks.append(m_left)
                if m_right.any():
                    new_masks.append(m_right)
            region_masks = new_masks if new_masks else region_masks

        return region_masks

    # ------------------------------------------------------------------
    # CART-based splits
    # ------------------------------------------------------------------

    def _cart_splits(
        self,
        X: np.ndarray,
        y: np.ndarray,
        feature_names: List[str],
    ) -> Tuple[List[SplitCondition], int, float]:
        """Run cost-complexity-pruned CART and extract splits.

        Returns (splits, tree_depth, best_ccp_alpha).
        """
        # Step 1: Grow a full tree then find the best alpha via pruning path
        full_tree = DecisionTreeRegressor(
            max_depth=self.max_depth,
            min_samples_leaf=self.min_samples_leaf,
            random_state=self.random_state,
        )
        full_tree.fit(X, y)

        # If the full tree has no splits, return empty
        if full_tree.tree_.node_count <= 1:
            return [], 0, 0.0

        # Cost-complexity pruning path
        path = full_tree.cost_complexity_pruning_path(X, y)
        ccp_alphas = path.ccp_alphas
        impurities = path.impurities

        # Select alpha that minimises BIC-like criterion:
        # BIC ≈ n·log(MSE) + k·log(n)
        n = len(y)
        best_alpha = 0.0
        best_bic = float("inf")
        best_tree: Optional[DecisionTreeRegressor] = None

        for alpha in ccp_alphas:
            tree = DecisionTreeRegressor(
                ccp_alpha=alpha,
                max_depth=self.max_depth,
                min_samples_leaf=self.min_samples_leaf,
                random_state=self.random_state,
            )
            tree.fit(X, y)
            y_pred = tree.predict(X)
            mse = float(np.mean((y - y_pred) ** 2))
            n_leaves = tree.get_n_leaves()
            if mse <= 0:
                mse = 1e-15
            bic = n * np.log(mse) + n_leaves * np.log(n)
            if bic < best_bic:
                best_bic = bic
                best_alpha = float(alpha)
                best_tree = tree

        if best_tree is None or best_tree.tree_.node_count <= 1:
            return [], 0, best_alpha

        # Extract split thresholds from the pruned tree
        splits = self._extract_tree_splits(best_tree, feature_names)
        depth = int(best_tree.get_depth())

        return splits, depth, best_alpha

    @staticmethod
    def _extract_tree_splits(
        tree: DecisionTreeRegressor,
        feature_names: List[str],
    ) -> List[SplitCondition]:
        """Walk the tree and collect internal-node split conditions."""
        t = tree.tree_
        splits: List[SplitCondition] = []
        seen: set[Tuple[str, float]] = set()

        for node_id in range(t.node_count):
            # Internal nodes have feature >= 0
            if t.feature[node_id] >= 0:
                feat_idx = t.feature[node_id]
                threshold = float(t.threshold[node_id])
                feat_name = feature_names[feat_idx]

                key = (feat_name, round(threshold, 8))
                if key not in seen:
                    seen.add(key)

                    # Score: weighted variance reduction
                    n_left = t.n_node_samples[t.children_left[node_id]]
                    n_right = t.n_node_samples[t.children_right[node_id]]
                    n_total = t.n_node_samples[node_id]
                    parent_var = t.impurity[node_id]
                    left_var = t.impurity[t.children_left[node_id]]
                    right_var = t.impurity[t.children_right[node_id]]
                    reduction = parent_var - (
                        n_left / n_total * left_var + n_right / n_total * right_var
                    )

                    splits.append(SplitCondition(
                        feature=feat_name,
                        threshold=threshold,
                        method="cart",
                        score=float(reduction),
                    ))

        return splits

    # ------------------------------------------------------------------
    # PELT-based splits
    # ------------------------------------------------------------------

    def _pelt_splits(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
    ) -> List[SplitCondition]:
        """Run PELT per feature dimension and collect change-points."""
        import ruptures as rpt  # type: ignore[import-untyped]

        splits: List[SplitCondition] = []

        for feat in feature_cols:
            vals = df[[feat, target_col]].dropna()
            if len(vals) < 2 * self.pelt_min_size:
                continue

            # Sort by feature value
            vals = vals.sort_values(feat).reset_index(drop=True)
            signal = vals[target_col].values.astype(np.float64)

            # Determine penalty
            if self.pelt_penalty == "bic":
                pen = np.log(len(signal)) * 2
            elif self.pelt_penalty == "aic":
                pen = 4.0
            else:
                pen = float(self.pelt_penalty)

            try:
                algo = rpt.Pelt(
                    model="l2",
                    min_size=self.pelt_min_size,
                ).fit(signal)
                change_points = algo.predict(pen=pen)
            except Exception:
                continue

            # Remove the terminal point (always == len(signal))
            internal = [cp for cp in change_points if cp < len(signal)]

            for cp_idx in internal:
                # Map index back to feature value (midpoint of adjacent values)
                if cp_idx <= 0 or cp_idx >= len(vals):
                    continue
                threshold = float(
                    (vals[feat].iloc[cp_idx - 1] + vals[feat].iloc[cp_idx]) / 2
                )

                # Score: variance reduction
                left_y = signal[:cp_idx]
                right_y = signal[cp_idx:]
                total_var = float(np.var(signal))
                if total_var == 0:
                    score = 0.0
                else:
                    weighted_var = (
                        len(left_y) * np.var(left_y)
                        + len(right_y) * np.var(right_y)
                    ) / len(signal)
                    score = (total_var - weighted_var) / total_var

                splits.append(SplitCondition(
                    feature=feat,
                    threshold=threshold,
                    method="pelt",
                    score=float(score),
                ))

        return splits

    # ------------------------------------------------------------------
    # Merging and region building
    # ------------------------------------------------------------------

    @staticmethod
    def _merge_splits(
        cart_splits: List[SplitCondition],
        pelt_splits: List[SplitCondition],
    ) -> List[SplitCondition]:
        """Merge CART and PELT splits, deduplicating close thresholds."""
        all_splits = list(cart_splits)

        for ps in pelt_splits:
            is_dup = False
            for cs in all_splits:
                if cs.feature == ps.feature:
                    # Consider duplicates if within 5 % of the feature range
                    if abs(cs.threshold - ps.threshold) < abs(cs.threshold) * 0.05 + 1e-8:
                        is_dup = True
                        # Keep the one with higher score
                        if ps.score > cs.score:
                            cs.threshold = ps.threshold
                            cs.score = ps.score
                            cs.method = "pelt+cart"
                        break
            if not is_dup:
                all_splits.append(ps)

        # Sort by score descending
        all_splits.sort(key=lambda s: s.score, reverse=True)
        return all_splits

    def _build_regions(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: List[str],
        splits: List[SplitCondition],
    ) -> List[Region]:
        """Partition data into regions using the discovered splits."""
        masks = self.get_region_masks(df, splits, feature_cols)

        regions: List[Region] = []
        for mask in masks:
            sub = df.loc[mask]
            y = sub[target_col].values.astype(np.float64)

            # Determine conditions that define this region
            conditions: List[Tuple[str, str, float]] = []
            for sp in splits:
                if sp.feature not in sub.columns:
                    continue
                vals = sub[sp.feature].values
                if np.all(vals <= sp.threshold):
                    conditions.append((sp.feature, "<=", sp.threshold))
                elif np.all(vals > sp.threshold):
                    conditions.append((sp.feature, ">", sp.threshold))

            regions.append(Region(
                conditions=conditions,
                n_samples=len(sub),
                y_mean=float(np.mean(y)) if len(y) > 0 else 0.0,
                y_std=float(np.std(y)) if len(y) > 0 else 0.0,
            ))

        return regions

    @staticmethod
    def _make_single_region(
        df: pd.DataFrame,
        target_col: str,
    ) -> Region:
        """Create a single region covering all data."""
        y = df[target_col].values.astype(np.float64)
        return Region(
            conditions=[],
            n_samples=len(df),
            y_mean=float(np.mean(y)) if len(y) > 0 else 0.0,
            y_std=float(np.std(y)) if len(y) > 0 else 0.0,
        )
