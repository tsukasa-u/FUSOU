"""
Module 2: CapDetector — Changepoint (kink) detection on filtered curves.

============================================================
What this module does
============================================================
Many game formulas have *caps* (上限): beyond a certain threshold of the
input stat, the output formula changes (e.g. the slope becomes shallower).

This module detects where the **slope (1st derivative)** of the quantile
curve changes abruptly, indicating a formula transition point.

Variables
---------
    Input:  Clean X-Y arrays from NoiseFilter (e.g. firepower → damage_max)
    Output: List of integer thresholds (cap values) and segmented data arrays
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional, Tuple

import numpy as np


@dataclass
class Segment:
    """A single contiguous data segment between changepoints.

    Attributes:
        x: Array of X values for this segment.
        y: Array of Y values for this segment.
        start_x: The starting X value (inclusive).
        end_x: The ending X value (inclusive).
        segment_index: Index of this segment (0-based).
    """

    x: np.ndarray
    y: np.ndarray
    start_x: float
    end_x: float
    segment_index: int


@dataclass
class CapResult:
    """Result of cap/changepoint detection.

    Attributes:
        thresholds: List of detected cap thresholds (integer X values).
        segments: List of ``Segment`` objects split at the thresholds.
        x: Full X array.
        y: Full Y array.
        method: Detection method used ('ruptures' or 'gradient').
    """

    thresholds: List[int]
    segments: List[Segment]
    x: np.ndarray
    y: np.ndarray
    method: str


class CapDetector:
    """Detect formula changepoints (caps) in quantile-filtered curves.

    Uses the ``ruptures`` library (Pelt algorithm) to find points where
    the *derivative* of the curve changes abruptly.  Falls back to a
    gradient-based heuristic if ``ruptures`` is not installed.

    Game design constraint: thresholds are rounded to the nearest integer,
    because in-game stat boundaries are always whole numbers.

    Example:
        >>> detector = CapDetector(min_segment_length=10)
        >>> result = detector.detect(x_array, y_array, max_caps=3)
        >>> print(result.thresholds)  # [150, 220]
        >>> detector.plot(result)
    """

    def __init__(
        self,
        min_segment_length: int = 10,
        penalty_scale: float = 5.0,
    ) -> None:
        """Initialise the cap detector.

        Args:
            min_segment_length: Minimum number of data points per segment.
                                Prevents spurious splits in small intervals.
            penalty_scale: Penalty multiplier for the Pelt algorithm.
                           Higher values = fewer changepoints detected.
        """
        self.min_segment_length = min_segment_length
        self.penalty_scale = penalty_scale

    def detect(
        self,
        x: np.ndarray,
        y: np.ndarray,
        max_caps: int = 5,
    ) -> CapResult:
        """Detect changepoints in the curve y = f(x).

        Args:
            x: Sorted array of X values (e.g. firepower values).
            y: Corresponding Y values (e.g. damage upper-bound).
            max_caps: Maximum number of caps to detect.

        Returns:
            CapResult with detected thresholds and segmented data.
        """
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)

        if len(x) < 2 * self.min_segment_length:
            # Too few points — return single segment
            return self._single_segment(x, y, method="too_few_points")

        # Compute the numerical derivative (slope)
        dx = np.diff(x)
        dy = np.diff(y)
        # Avoid division by zero
        slope = np.where(dx != 0, dy / dx, 0.0)

        try:
            thresholds, method = self._detect_ruptures(
                x, y, slope, max_caps
            )
        except Exception:
            thresholds, method = self._detect_gradient(
                x, y, slope, max_caps
            )

        # Round thresholds to nearest integer (game design constraint)
        thresholds = sorted(set(int(round(t)) for t in thresholds))

        # Filter out thresholds that are too close to the edges or each other
        thresholds = self._filter_thresholds(x, thresholds)

        if not thresholds:
            return self._single_segment(x, y, method=method)

        # Split data into segments
        segments = self._split_segments(x, y, thresholds)

        return CapResult(
            thresholds=thresholds,
            segments=segments,
            x=x,
            y=y,
            method=method,
        )

    def _detect_ruptures(
        self,
        x: np.ndarray,
        y: np.ndarray,
        slope: np.ndarray,
        max_caps: int,
    ) -> Tuple[List[float], str]:
        """Changepoint detection using the ``ruptures`` library.

        Args:
            x: X values.
            y: Y values.
            slope: Pre-computed first derivative.
            max_caps: Max caps.

        Returns:
            Tuple of (threshold_list, method_name).

        Raises:
            ImportError: If ``ruptures`` is not installed.
        """
        import ruptures as rpt

        # Run Pelt on the slope signal
        signal = slope.reshape(-1, 1)
        penalty = np.std(slope) * self.penalty_scale if np.std(slope) > 0 else 1.0

        algo = rpt.Pelt(model="l2", min_size=self.min_segment_length).fit(signal)
        breakpoints = algo.predict(pen=penalty)

        # ruptures returns indices (1-based end positions); convert to X values.
        # Last breakpoint is always len(signal), remove it.
        breakpoints = [b for b in breakpoints if b < len(slope)]

        # Limit to max_caps
        breakpoints = breakpoints[:max_caps]

        # Map index back to X value (breakpoint index *i* corresponds to
        # the transition between x[i] and x[i+1])
        thresholds = [float(x[min(b, len(x) - 1)]) for b in breakpoints]

        return thresholds, "ruptures"

    def _detect_gradient(
        self,
        x: np.ndarray,
        y: np.ndarray,
        slope: np.ndarray,
        max_caps: int,
    ) -> Tuple[List[float], str]:
        """Fallback gradient-based kink detection.

        Finds points where the *second derivative* (change-in-slope)
        exceeds a threshold.

        Args:
            x: X values.
            y: Y values.
            slope: First derivative.
            max_caps: Max number of kinks.

        Returns:
            Tuple of (threshold_list, 'gradient').
        """
        if len(slope) < 3:
            return [], "gradient"

        # Smooth slope with a small rolling window
        kernel_size = max(3, len(slope) // 20)
        if kernel_size % 2 == 0:
            kernel_size += 1
        kernel = np.ones(kernel_size) / kernel_size
        smoothed = np.convolve(slope, kernel, mode="same")

        # Second derivative
        d2 = np.abs(np.diff(smoothed))

        # Threshold: mean + 2*std of |d2|
        threshold = np.mean(d2) + 2.0 * np.std(d2)
        if threshold <= 0:
            return [], "gradient"

        # Find peaks above threshold
        candidates = np.where(d2 > threshold)[0]
        if len(candidates) == 0:
            return [], "gradient"

        # Cluster nearby candidates (within min_segment_length)
        clusters: List[List[int]] = []
        current_cluster: List[int] = [candidates[0]]
        for i in range(1, len(candidates)):
            if candidates[i] - candidates[i - 1] <= self.min_segment_length:
                current_cluster.append(candidates[i])
            else:
                clusters.append(current_cluster)
                current_cluster = [candidates[i]]
        clusters.append(current_cluster)

        # Take the centroid of each cluster
        centroids = [int(np.mean(c)) for c in clusters]
        centroids = centroids[:max_caps]

        # Map back to X values (offset by 1 for the diff operations)
        thresholds = [float(x[min(c + 1, len(x) - 1)]) for c in centroids]

        return thresholds, "gradient"

    def _filter_thresholds(
        self, x: np.ndarray, thresholds: List[int]
    ) -> List[int]:
        """Remove thresholds too close to edges or to each other.

        Args:
            x: X array.
            thresholds: Candidate thresholds.

        Returns:
            Filtered list of thresholds.
        """
        x_min, x_max = float(x.min()), float(x.max())
        x_range = x_max - x_min
        edge_margin = x_range * 0.05  # 5% margin from edges

        filtered = [
            t
            for t in thresholds
            if (x_min + edge_margin) < t < (x_max - edge_margin)
        ]

        # Remove thresholds that are too close to each other
        if len(filtered) < 2:
            return filtered
        min_gap = max(self.min_segment_length, x_range * 0.05)
        result = [filtered[0]]
        for t in filtered[1:]:
            if t - result[-1] >= min_gap:
                result.append(t)
        return result

    def _split_segments(
        self,
        x: np.ndarray,
        y: np.ndarray,
        thresholds: List[int],
    ) -> List[Segment]:
        """Split data into segments at the given thresholds.

        Args:
            x: Full X array.
            y: Full Y array.
            thresholds: Sorted list of threshold X values.

        Returns:
            List of ``Segment`` objects.
        """
        boundaries = [float(x.min())] + [float(t) for t in thresholds] + [float(x.max()) + 1]
        segments: List[Segment] = []

        for i in range(len(boundaries) - 1):
            lo, hi = boundaries[i], boundaries[i + 1]
            mask = (x >= lo) & (x < hi)
            if np.sum(mask) == 0:
                continue
            seg_x = x[mask]
            seg_y = y[mask]
            segments.append(
                Segment(
                    x=seg_x,
                    y=seg_y,
                    start_x=float(seg_x.min()),
                    end_x=float(seg_x.max()),
                    segment_index=i,
                )
            )

        return segments

    def _single_segment(
        self, x: np.ndarray, y: np.ndarray, method: str
    ) -> CapResult:
        """Return a CapResult with a single segment (no caps found).

        Args:
            x: X array.
            y: Y array.
            method: Method name for metadata.

        Returns:
            CapResult with empty thresholds and one segment.
        """
        seg = Segment(
            x=x,
            y=y,
            start_x=float(x.min()),
            end_x=float(x.max()),
            segment_index=0,
        )
        return CapResult(
            thresholds=[],
            segments=[seg],
            x=x,
            y=y,
            method=method,
        )

    @staticmethod
    def plot(
        result: CapResult,
        ax: Optional[Any] = None,
        title: Optional[str] = None,
    ) -> Any:
        """Plot the cap detection result.

        Shows the curve coloured by segment with vertical dashed lines
        at each detected threshold.

        Args:
            result: A ``CapResult`` from ``detect()``.
            ax: Matplotlib Axes (created if ``None``).
            title: Custom title.

        Returns:
            The Axes object.
        """
        import matplotlib.pyplot as plt

        if ax is None:
            _, ax = plt.subplots(figsize=(10, 6))

        colours = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6"]

        for seg in result.segments:
            c = colours[seg.segment_index % len(colours)]
            ax.plot(
                seg.x,
                seg.y,
                color=c,
                linewidth=2,
                label=f"Segment {seg.segment_index} "
                f"[{seg.start_x:.0f}–{seg.end_x:.0f}]",
            )

        for t in result.thresholds:
            ax.axvline(
                t,
                color="#7f8c8d",
                linestyle="--",
                linewidth=1.5,
                alpha=0.8,
                label=f"Cap @ X={t}",
            )

        ax.set_xlabel("X (stat value)", fontsize=12)
        ax.set_ylabel("Y (damage boundary)", fontsize=12)
        ax.set_title(
            title
            or f"Cap Detection ({result.method}): "
            f"{len(result.thresholds)} cap(s) found",
            fontsize=14,
        )
        ax.legend(fontsize=9)
        ax.grid(True, alpha=0.3)

        return ax
