import cv2
import numpy as np
import json
import os
import re
import argparse
from collections import Counter

import pandas as pd
from sklearn.cluster import DBSCAN


# Color themes (all colors in BGR for OpenCV)
THEMES = {
    "dark": {
        "rand_color": (0xD4, 0xB4, 0xA1),   # BGR for RGB(0xA1, 0xB4, 0xD4)
        "bound_color": (84, 82, 81),
        "sea_color": (0x45, 0x45, 0x45),
        "undetected_red_sea_color": (0x33, 0x33, 0xCC),
    },
    "light": {
        "rand_color": (0x5F, 0x90, 0x7A),    # BGR for RGB(0x7A, 0x90, 0x5F)
        "bound_color": (84, 82, 81),
        "sea_color": (0xFF, 0xFF, 0xFF),
        "undetected_red_sea_color": (0x66, 0x66, 0xEE),
    },
}

# Per-area DBSCAN eps for LAB clustering
DBSCAN_EPS = {
    "1-1": 10, "1-2": 10, "1-3": 5, "1-4": 10, "1-5": 7,
    "2-1": 10, "2-2": 7, "2-3": 10, "2-5": 10,
    "3-1": 7, "3-2": 10, "3-5": 4,
    "4-5": 10, "5-3": 7, "6-5": 10,
}
DEFAULT_DBSCAN_EPS = 10

# Pre-cluster border blanking (pixels to overwrite with sea-like fill)
DEFAULT_PRE_CLUSTER_TRIM_PX = 0

# Color quantization step before DBSCAN (1 = disabled)
DEFAULT_CLUSTER_QUANT_STEP = 8

# Red-sea filter and unresolved visualization settings.
RED_SEA_MIN_AREA = 80
RED_SEA_AUTO_ENABLE = True
RED_SEA_AUTO_MIN_RATIO = 0.08
RED_SEA_SMOOTH_SIGMA = 4.5
RED_SEA_BLEND_SIGMA = 10.0
RED_SEA_CONTOUR_LEVELS = (56, 88, 120, 152, 184)
RED_SEA_CONTOUR_SMOOTH_WINDOW = 9
RED_SEA_CONTOUR_SMOOTH_PASSES = 2

# Guardrail: skip candidate if it covers more than this fraction
MAX_FORCED_CLUSTER_AREA_RATIO = 0.60

# Default land-selection preset for all areas (balanced approach)
LAND_CANDIDATE = {
    "name": "balanced",
    "sea_border_w": 2.5,
    "sea_area_w": 1.2,
    "sea_blue_w": 0.03,
    "sea_green_w": 0.02,
    "land_blue_penalty": 0.8,
    "land_border_max": 0.75,
    "min_land_ratio": 0.001,
    "fallback_min_ratio": 0.010,
    "fallback_max_ratio": 0.65,
    "mask_open": 0,
    "mask_close": 1,
    "mask_erode": 0,
    "mask_dilate": 0,
    "component_min_area": 24,
    "contour_min_area": 8.0,
}


# ---------------------------------------------------------------------------
# File discovery helpers
# ---------------------------------------------------------------------------

def is_map_image_basename(file_name: str) -> bool:
    lower = file_name.lower()
    return "image" in lower or "imgae" in lower


def find_files(area_dir: str):
    json_files = [
        os.path.join(area_dir, n) for n in os.listdir(area_dir)
        if n.lower().endswith(".json") and is_map_image_basename(n)
    ]
    png_files = [
        os.path.join(area_dir, n) for n in os.listdir(area_dir)
        if n.lower().endswith(".png") and is_map_image_basename(n)
    ]
    if not json_files or not png_files:
        return None, None
    return sorted(json_files)[0], sorted(png_files)[0]


def find_info_file(area_dir: str):
    info_files = [
        os.path.join(area_dir, n) for n in os.listdir(area_dir)
        if n.lower().endswith("info.json")
    ]
    return sorted(info_files)[0] if info_files else None


def find_map_frame_key(frames: dict, area_tag: str) -> str:
    suffix = f"_map{area_tag}"
    for key in frames:
        if key.endswith(suffix):
            return key
    return max(frames.keys(), key=lambda k: frames[k]["frame"]["w"] * frames[k]["frame"]["h"])


# ---------------------------------------------------------------------------
# Image pre-processing
# ---------------------------------------------------------------------------

def apply_border_blank(region: np.ndarray, trim_px: int, trim_sides=None) -> np.ndarray:
    """Overwrite the outer border band with a sea-like fill colour (centre median)."""
    if trim_px <= 0 and not trim_sides:
        return region

    out = region.copy()
    h, w = out.shape[:2]

    # Sample the inner 50% to get a representative sea colour.
    cy0, cy1 = h // 4, h - h // 4
    cx0, cx1 = w // 4, w - w // 4
    centre_pixels = region[cy0:cy1, cx0:cx1, :3].reshape(-1, 3)
    fill_bgr = np.median(centre_pixels, axis=0).astype(np.uint8)
    # Prevent green-dominant fill so border pixels aren't mistaken for land.
    b_v, g_v, r_v = int(fill_bgr[0]), int(fill_bgr[1]), int(fill_bgr[2])
    if g_v >= max(b_v, r_v) - 4:
        g_v = max(0, min(g_v, max(b_v, r_v) - 8))
        fill_bgr = np.array([b_v, g_v, r_v], dtype=np.uint8)
    fill_bgra = np.array([fill_bgr[0], fill_bgr[1], fill_bgr[2], 255], dtype=np.uint8)

    if trim_sides:
        t   = max(0, int(trim_sides.get("top", 0)))
        r_s = max(0, int(trim_sides.get("right", 0)))
        b_s = max(0, int(trim_sides.get("bottom", 0)))
        l   = max(0, int(trim_sides.get("left", 0)))
    else:
        t = r_s = b_s = l = max(0, int(trim_px))

    if t > 0:
        out[:min(h, t), :] = fill_bgra
    if b_s > 0:
        out[max(0, h - b_s):, :] = fill_bgra
    y0_c = min(h, t)
    y1_c = max(y0_c, h - b_s)
    if l > 0 and y1_c > y0_c:
        out[y0_c:y1_c, :min(w, l)] = fill_bgra
    if r_s > 0 and y1_c > y0_c:
        out[y0_c:y1_c, max(0, w - r_s):] = fill_bgra

    print(f"  Border blank: top={t} right={r_s} bottom={b_s} left={l} "
          f"fill_bgr=({int(fill_bgr[0])},{int(fill_bgr[1])},{int(fill_bgr[2])})")
    return out


def apply_cluster_quantization(region: np.ndarray, step: int) -> np.ndarray:
    if step <= 1:
        return region
    out = region.copy()
    bgr = out[:, :, :3].astype(np.int16)
    q = ((bgr + (step // 2)) // step) * step
    out[:, :, :3] = np.clip(q, 0, 255).astype(np.uint8)
    return out


# ---------------------------------------------------------------------------
# Mask / morphology helpers
# ---------------------------------------------------------------------------

def remove_small_components(mask: np.ndarray, min_area: int = 20) -> np.ndarray:
    num_labels, label_map, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    refined = np.zeros_like(mask)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            refined[label_map == i] = 255
    return refined


def keep_border_connected(mask: np.ndarray) -> np.ndarray:
    if np.count_nonzero(mask) == 0:
        return mask
    h, w = mask.shape[:2]
    num_labels, label_map, _, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros_like(mask)
    for i in range(1, num_labels):
        comp = label_map == i
        if (np.any(comp[0, :]) or np.any(comp[h - 1, :]) or
                np.any(comp[:, 0]) or np.any(comp[:, w - 1])):
            keep[comp] = 255
    return keep


def remove_border_connected(mask: np.ndarray) -> np.ndarray:
    border = keep_border_connected(mask)
    return cv2.bitwise_and(mask, cv2.bitwise_not(border))


def suppress_axis_grid_lines(mask: np.ndarray, area_tag: str) -> np.ndarray:
    return mask


# ---------------------------------------------------------------------------
# LAB colour conversion
# ---------------------------------------------------------------------------

def bgr_to_lab(input_color) -> list:
    b, g, r = input_color[0] / 255.0, input_color[1] / 255.0, input_color[2] / 255.0
    r = r / 12.92 if r <= 0.04045 else ((r + 0.055) / 1.055) ** 2.4
    g = g / 12.92 if g <= 0.04045 else ((g + 0.055) / 1.055) ** 2.4
    b = b / 12.92 if b <= 0.04045 else ((b + 0.055) / 1.055) ** 2.4

    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.950489
    y =  r * 0.2126 + g * 0.7152 + b * 0.0722
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08884

    delta = 6.0 / 29.0

    def f(t: float) -> float:
        return t ** (1.0 / 3.0) if t > delta ** 3 else t / (3.0 * delta ** 2) + 4.0 / 29.0

    L  = 116.0 * f(y) - 16.0
    a  = 500.0 * (f(x) - f(y))
    _b = 200.0 * (f(y) - f(z))
    return [L, a, _b]


# ---------------------------------------------------------------------------
# Cluster / label helpers
# ---------------------------------------------------------------------------

def build_label_mask(region: np.ndarray, colors: np.ndarray,
                     labels: np.ndarray, target_label: int) -> np.ndarray:
    h, w = region.shape[:2]
    alpha_ok = region[:, :, 3] == 255
    mask = np.zeros((h, w), np.uint8)
    for i, c in enumerate(colors):
        if labels[i] != target_label:
            continue
        matched = np.all(region[:, :, :3] == c, axis=2) & alpha_ok
        mask[matched] = 255
    return mask


def calc_border_ratio(mask: np.ndarray) -> float:
    h, w = mask.shape
    border_px = (
        int(np.count_nonzero(mask[0, :]))
        + int(np.count_nonzero(mask[h - 1, :]))
        + int(np.count_nonzero(mask[:, 0]))
        + int(np.count_nonzero(mask[:, w - 1]))
        - int(mask[0, 0] > 0)
        - int(mask[0, w - 1] > 0)
        - int(mask[h - 1, 0] > 0)
        - int(mask[h - 1, w - 1] > 0)
    )
    border_total = (2 * w) + (2 * h) - 4
    return border_px / border_total if border_total > 0 else 1.0


def vote_label_from_spots(region: np.ndarray, colors: np.ndarray,
                          labels: np.ndarray, info_path) -> tuple:
    if not info_path or not os.path.exists(info_path):
        return None, 0
    with open(info_path, "r", encoding="utf-8") as f:
        info_data = json.load(f)
    spots = info_data.get("spots", [])
    if not spots:
        return None, 0

    color_to_label = {
        tuple(int(v) for v in colors[i]): int(labels[i])
        for i in range(len(colors))
    }
    h, w = region.shape[:2]
    votes: Counter = Counter()
    sampled = 0
    for spot in spots:
        x = int(spot.get("x", -1))
        y = int(spot.get("y", -1))
        if not (0 <= x < w and 0 <= y < h):
            continue
        px = region[y, x]
        if px[3] != 255:
            continue
        sampled += 1
        label = color_to_label.get((int(px[0]), int(px[1]), int(px[2])))
        if label is not None:
            votes[label] += 1
    if not votes:
        return None, sampled
    return votes.most_common(1)[0][0], sampled


# ---------------------------------------------------------------------------
# Land / sea mask builders
# ---------------------------------------------------------------------------

def build_land_mask_by_color(region: np.ndarray) -> np.ndarray:
    """Green-dominant pixel heuristic for land seeds."""
    b = region[:, :, 0].astype(np.int16)
    g = region[:, :, 1].astype(np.int16)
    r = region[:, :, 2].astype(np.int16)
    alpha_ok = region[:, :, 3] == 255
    green_dom = g - np.maximum(b, r)
    blue_dom  = b - np.maximum(g, r)
    mask = (alpha_ok & (g >= 38) & (green_dom >= 4) & (blue_dom <= 10)).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    return remove_small_components(mask, min_area=40)


def build_coastline_land_assist_mask(region: np.ndarray) -> np.ndarray:
    """Find land components that touch a detected sea/land coastline edge."""
    alpha_ok = region[:, :, 3] == 255
    if not np.any(alpha_ok):
        return np.zeros(region.shape[:2], np.uint8)

    bgr = region[:, :, :3]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), threshold1=32, threshold2=96)

    b = bgr[:, :, 0].astype(np.int16)
    g = bgr[:, :, 1].astype(np.int16)
    r = bgr[:, :, 2].astype(np.int16)

    land_seed = (alpha_ok & (g >= 28) & (g >= b - 5) & (g >= r - 8)).astype(np.uint8) * 255
    sea_seed = (alpha_ok & (
        ((b >= g + 4) & (b >= r - 4)) | ((r >= g + 10) & (g <= b + 6))
    )).astype(np.uint8) * 255

    k3 = np.ones((3, 3), np.uint8)
    near_land = cv2.dilate(land_seed, k3)
    near_sea  = cv2.dilate(sea_seed, k3)
    coast = cv2.bitwise_and(cv2.bitwise_and(edges, near_land), near_sea)
    coast = cv2.morphologyEx(coast, cv2.MORPH_DILATE, k3)

    num_labels, label_map, stats, _ = cv2.connectedComponentsWithStats(land_seed, connectivity=8)
    assist = np.zeros_like(land_seed)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] < 6:
            continue
        if np.any(coast[label_map == i] > 0):
            assist[label_map == i] = 255
    assist = cv2.morphologyEx(assist, cv2.MORPH_CLOSE, k3)
    return remove_small_components(assist, min_area=8)


def merge_with_coastline_assist(mask: np.ndarray, region: np.ndarray) -> np.ndarray:
    assist = build_coastline_land_assist_mask(region)
    if np.count_nonzero(assist) == 0:
        return mask
    return remove_small_components(cv2.bitwise_or(mask, assist), min_area=8)


def build_land_mask_by_border_sea_split(region: np.ndarray, area_tag: str) -> np.ndarray:
    """Identify land as non-sea interior after border-flood-filling the sea."""
    h, w = region.shape[:2]
    alpha_ok = region[:, :, 3] == 255
    if not np.any(alpha_ok):
        return np.zeros((h, w), np.uint8)

    b = region[:, :, 0].astype(np.int16)
    g = region[:, :, 1].astype(np.int16)
    r = region[:, :, 2].astype(np.int16)

    sea_like = (
        alpha_ok & (g <= np.maximum(b, r) + 8) & ((b >= g - 6) | (r >= g + 2))
    ).astype(np.uint8) * 255
    sea_connected = keep_border_connected(sea_like)
    sea_connected = cv2.morphologyEx(sea_connected, cv2.MORPH_CLOSE,
                                      np.ones((3, 3), np.uint8))

    land_mask = np.zeros((h, w), np.uint8)
    land_mask[alpha_ok & (sea_connected == 0)] = 255
    land_mask = cv2.bitwise_or(land_mask, build_land_mask_by_color(region))
    land_mask = cv2.bitwise_or(land_mask, build_coastline_land_assist_mask(region))
    land_mask = suppress_axis_grid_lines(land_mask, area_tag)
    return remove_small_components(land_mask, min_area=12)



def detect_red_sea_mask(region: np.ndarray, area_tag: str) -> np.ndarray:
    """Detect border-connected red sea regions to mark potential detection blind spots."""
    h, w = region.shape[:2]
    alpha_ok = region[:, :, 3] == 255
    if not alpha_ok.any():
        return np.zeros((h, w), np.uint8)

    bgr = region[:, :, :3]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h_ch = hsv[:, :, 0]
    s_ch = hsv[:, :, 1]
    v_ch = hsv[:, :, 2]

    b_ch = bgr[:, :, 0].astype(np.int16)
    g_ch = bgr[:, :, 1].astype(np.int16)
    r_ch = bgr[:, :, 2].astype(np.int16)

    # Hue wraps around in HSV: red is near 0 and near 179.
    hue_red = (h_ch <= 16) | (h_ch >= 155)
    sat_ok = s_ch >= 40
    val_ok = v_ch >= 35
    red_dom = r_ch >= (g_ch + 12)
    non_blue = b_ch <= (r_ch + 8)

    red_like = (alpha_ok & hue_red & sat_ok & val_ok & red_dom & non_blue).astype(np.uint8) * 255
    red_like = cv2.morphologyEx(
        red_like,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    )
    red_like = remove_small_components(red_like, min_area=RED_SEA_MIN_AREA)
    red_like = cv2.morphologyEx(
        red_like,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
    )
    red_like = cv2.morphologyEx(
        red_like,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
    )

    # Smooth and reconnect red-sea boundary so transitions are less jagged.
    red_soft = cv2.GaussianBlur(
        red_like.astype(np.float32), (0, 0), sigmaX=3.0, sigmaY=3.0
    )
    red_like = np.where(red_soft >= 88.0, 255, 0).astype(np.uint8)
    red_like = cv2.morphologyEx(
        red_like,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)),
    )
    red_like = remove_small_components(red_like, min_area=RED_SEA_MIN_AREA)

    if RED_SEA_AUTO_ENABLE:
        ratio = float(np.count_nonzero(red_like)) / float(max(1, h * w))
        if ratio >= RED_SEA_AUTO_MIN_RATIO:
            return red_like
    return np.zeros((h, w), np.uint8)


def create_red_sea_free_region(region: np.ndarray, red_sea_mask: np.ndarray) -> np.ndarray:
    """Create a version of the region with red-sea areas blued-out for cleaner processing."""
    if np.count_nonzero(red_sea_mask) == 0:
        return region
    
    result = region.copy()
    red_sea_px = red_sea_mask > 0
    
    # Replace red-sea pixels with nearby non-red-sea colors (blue sea fill)
    if np.any(red_sea_px):
        # Sample blue sea color from non-red areas
        non_red = cv2.bitwise_not(red_sea_mask)
        if np.count_nonzero(non_red) > 100:
            non_red_pixels = region[:, :, :3][non_red > 0]
            blue_sea_fill = np.median(non_red_pixels, axis=0).astype(np.uint8)
        else:
            blue_sea_fill = np.array([100, 100, 100], dtype=np.uint8)
        
        result[red_sea_px, :3] = blue_sea_fill
    
    return result


def build_redness_strength_map(region: np.ndarray) -> np.ndarray:
    """Return per-pixel redness strength (0..255) for non-land visualization."""
    alpha_ok = region[:, :, 3] == 255
    if not alpha_ok.any():
        return np.zeros(region.shape[:2], np.uint8)

    bgr = region[:, :, :3]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h_ch = hsv[:, :, 0].astype(np.float32)
    s_ch = hsv[:, :, 1].astype(np.float32)
    v_ch = hsv[:, :, 2].astype(np.float32)

    b_ch = bgr[:, :, 0].astype(np.float32)
    g_ch = bgr[:, :, 1].astype(np.float32)
    r_ch = bgr[:, :, 2].astype(np.float32)

    hue_dist = np.minimum(h_ch, 180.0 - h_ch)
    hue_score = np.clip(1.0 - (hue_dist / 35.0), 0.0, 1.0)
    sat_score = np.clip(s_ch / 255.0, 0.0, 1.0)
    val_score = np.clip(v_ch / 255.0, 0.0, 1.0)
    dom_score = np.clip((r_ch - np.maximum(g_ch, b_ch) + 20.0) / 80.0, 0.0, 1.0)

    score = (
        0.45 * hue_score
        + 0.25 * sat_score
        + 0.15 * val_score
        + 0.15 * dom_score
    )
    score = np.clip(score, 0.0, 1.0)
    score[~alpha_ok] = 0.0
    return (score * 255.0).astype(np.uint8)


def render_redness_heatmap(strength_u8: np.ndarray) -> np.ndarray:
    """Render a readable redness heatmap image from strength map."""
    return cv2.applyColorMap(strength_u8, cv2.COLORMAP_HOT)


def build_red_zone_land_assist_mask(region: np.ndarray, area_tag: str) -> np.ndarray:
    """Recover likely island components inside red-sea zones.

    Red/blue mixed maps may miss islands near the red side because red sea and island
    shades are close after colour transforms. This helper works on original colours and
    keeps only small/medium low-saturation components inside a red-dominant zone.
    """
    h, w = region.shape[:2]
    alpha_ok = region[:, :, 3] == 255
    if not alpha_ok.any():
        return np.zeros((h, w), np.uint8)

    red_gate = detect_red_sea_mask(region, area_tag)
    red_gate_ratio = float(np.count_nonzero(red_gate)) / float(max(1, h * w))
    if red_gate_ratio < 0.04:
        return np.zeros((h, w), np.uint8)

    bgr = region[:, :, :3]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h_ch = hsv[:, :, 0]
    s_ch = hsv[:, :, 1].astype(np.int16)
    v_ch = hsv[:, :, 2].astype(np.int16)

    b_ch = bgr[:, :, 0].astype(np.int16)
    g_ch = bgr[:, :, 1].astype(np.int16)
    r_ch = bgr[:, :, 2].astype(np.int16)

    red_hue = (h_ch <= 18) | (h_ch >= 150)
    red_dom = r_ch >= (g_ch + 6)
    blue_not_dom = b_ch <= (r_ch + 16)
    red_zone = alpha_ok & red_hue & red_dom & blue_not_dom & (v_ch >= 28)

    # Islands in the red zone are typically lower saturation than the surrounding red sea.
    # Keep moderate luminance to avoid near-black frame noise and bright haze bands.
    island_like = red_zone & (s_ch <= 135) & (v_ch >= 42) & (v_ch <= 185)
    mask = island_like.astype(np.uint8) * 255

    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    num_labels, label_map, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = np.zeros_like(mask)
    area_total = float(max(1, h * w))
    for i in range(1, num_labels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < 10:
            continue
        area_ratio = area / area_total
        if area_ratio > 0.020:
            continue

        comp = label_map == i
        border_touch = (
            int(np.count_nonzero(comp[0, :]))
            + int(np.count_nonzero(comp[h - 1, :]))
            + int(np.count_nonzero(comp[:, 0]))
            + int(np.count_nonzero(comp[:, w - 1]))
        )
        if border_touch > 220:
            continue

        mean_sat = float(np.mean(s_ch[comp])) if np.any(comp) else 255.0
        mean_val = float(np.mean(v_ch[comp])) if np.any(comp) else 0.0
        if mean_sat > 125.0 or mean_val < 38.0 or mean_val > 190.0:
            continue

        out[comp] = 255

    out = suppress_axis_grid_lines(out, area_tag)
    return remove_small_components(out, min_area=10)


def detect_islands_in_red_sea(region: np.ndarray, red_sea_mask: np.ndarray, area_tag: str) -> np.ndarray:
    """Dedicated island detection for red-sea zones using color and saturation heuristics."""
    h, w = region.shape[:2]
    if np.count_nonzero(red_sea_mask) == 0:
        return np.zeros((h, w), np.uint8)
    
    bgr = region[:, :, :3]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h_ch = hsv[:, :, 0]
    s_ch = hsv[:, :, 1]
    v_ch = hsv[:, :, 2]
    
    alpha_ok = region[:, :, 3] == 255
    in_red_sea = (red_sea_mask > 0) & alpha_ok
    
    # Islands in red sea are typically:
    # - Lower saturation than pure red sea
    # - Moderate value (not too bright, not too dark)
    # - Non-red hue (greens/browns instead of reds)
    green_hue = ((h_ch >= 25) & (h_ch <= 90))
    brown_hue = ((h_ch >= 100) & (h_ch <= 150))
    low_sat = s_ch <= 120
    moderate_val = (v_ch >= 50) & (v_ch <= 200)
    
    island_in_red = (in_red_sea & ((green_hue | brown_hue) & low_sat & moderate_val)).astype(np.uint8) * 255
    
    island_in_red = cv2.morphologyEx(island_in_red, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    island_in_red = remove_small_components(island_in_red, min_area=8)
    
    return island_in_red




# ---------------------------------------------------------------------------
# Contour builders
# ---------------------------------------------------------------------------

def is_land_contour(cnt: np.ndarray, min_area: float = 12.0) -> bool:
    area = float(cv2.contourArea(cnt))
    if area < min_area:
        return False
    x, y, w, h = cv2.boundingRect(cnt)
    rect_area  = float(max(1, w * h))
    fill_ratio = area / rect_area
    perimeter  = float(cv2.arcLength(cnt, True))
    compactness = (4.0 * np.pi * area) / (perimeter * perimeter) if perimeter > 0 else 0.0
    aspect = float(max(w, h)) / float(max(1, min(w, h)))
    # Reject tiny, elongated stroke-like contours (grid lines).
    if area < 120.0 and fill_ratio < 0.045 and compactness < 0.03:
        return False
    if min(w, h) <= 2 and max(w, h) >= 14:
        return False
    if fill_ratio < 0.08 and aspect >= 10.0:
        return False
    return True


def build_contours_from_mask(mask: np.ndarray,
                               component_min_area: int = 20,
                               contour_min_area: float = 8.0) -> list:
    tuned = remove_small_components(mask, min_area=component_min_area)
    contours, _ = cv2.findContours(tuned, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    return [c for c in contours if is_land_contour(c, min_area=contour_min_area)]


def build_contours_from_mask_with_area(mask: np.ndarray, area_tag: str,
                                        component_min_area: int = 20,
                                        contour_min_area: float = 8.0) -> list:
    tuned = suppress_axis_grid_lines(mask, area_tag)
    return build_contours_from_mask(tuned, component_min_area, contour_min_area)


def remove_border_touching_contours(contours: list, w: int, h: int, margin: int = 2) -> list:
    out = []
    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        touches = (x <= margin) or (y <= margin) or (x + cw >= w - margin) or (y + ch >= h - margin)
        if not touches:
            out.append(cnt)
    return out


# ---------------------------------------------------------------------------
# Land label selection (DBSCAN cluster approach)
# ---------------------------------------------------------------------------

def select_land_label(region: np.ndarray, colors: np.ndarray,
                      labels: np.ndarray, candidate: dict,
                      info_path=None) -> tuple:
    h, w = region.shape[:2]
    area_total = h * w
    stats = []

    for label in np.unique(labels):
        mask = build_label_mask(region, colors, labels, label)
        area_px = int(np.count_nonzero(mask))
        if area_px == 0:
            continue
        area_ratio   = area_px / area_total
        border_ratio = calc_border_ratio(mask)
        pixels   = region[:, :, :3][mask > 0]
        mean_bgr = pixels.mean(axis=0)
        green_score = float(mean_bgr[1] - max(mean_bgr[0], mean_bgr[2]))
        blue_score  = float(mean_bgr[0] - max(mean_bgr[1], mean_bgr[2]))
        stats.append({
            "label":        int(label),
            "mask":         mask,
            "area_px":      area_px,
            "area_ratio":   area_ratio,
            "border_ratio": border_ratio,
            "mean_bgr":     mean_bgr,
            "green_score":  green_score,
            "blue_score":   blue_score,
        })

    if not stats:
        return None, []

    voted_label, sampled = vote_label_from_spots(region, colors, labels, info_path)

    # Step 1: identify sea cluster (highest score on border/area/blue metrics).
    sea_rank = []
    for s in stats:
        vote_bonus  = 1.5 if voted_label is not None and s["label"] == voted_label else 0.0
        large_bonus = 0.5 if s["area_ratio"] >= 0.35 else 0.0
        sea_score = (
            candidate["sea_border_w"] * s["border_ratio"]
            + candidate["sea_area_w"]  * s["area_ratio"]
            + candidate["sea_blue_w"]  * s["blue_score"]
            - candidate["sea_green_w"] * s["green_score"]
            + vote_bonus + large_bonus
        )
        sea_rank.append((sea_score, s))
    _, sea = max(sea_rank, key=lambda x: x[0])

    # Step 2: choose land from non-sea labels.
    candidates = [
        s for s in stats
        if s["label"] != sea["label"] and s["area_ratio"] >= candidate["min_land_ratio"]
    ]
    if not candidates:
        candidates = [s for s in stats if s["label"] != sea["label"]]
    if not candidates:
        return None, stats

    interior = [s for s in candidates if s["border_ratio"] <= candidate["land_border_max"]]
    if interior:
        candidates = interior

    best = max(
        candidates,
        key=lambda s: (
            s["green_score"] - candidate["land_blue_penalty"] * s["blue_score"],
            -s["border_ratio"],
            s["area_ratio"],
        ),
    )
    best["selected_by"] = (
        f"non_sea(sea_label={sea['label']}, sampled={sampled})"
    )
    return best, stats


def tune_mask_by_candidate(mask: np.ndarray) -> np.ndarray:
    tuned  = mask.copy()
    kernel = np.ones((3, 3), np.uint8)
    if LAND_CANDIDATE["mask_open"] > 0:
        tuned = cv2.morphologyEx(tuned, cv2.MORPH_OPEN, kernel,
                                  iterations=int(LAND_CANDIDATE["mask_open"]))
    if LAND_CANDIDATE["mask_close"] > 0:
        tuned = cv2.morphologyEx(tuned, cv2.MORPH_CLOSE, kernel,
                                  iterations=int(LAND_CANDIDATE["mask_close"]))
    if LAND_CANDIDATE["mask_erode"] > 0:
        tuned = cv2.erode(tuned, kernel, iterations=int(LAND_CANDIDATE["mask_erode"]))
    if LAND_CANDIDATE["mask_dilate"] > 0:
        tuned = cv2.dilate(tuned, kernel, iterations=int(LAND_CANDIDATE["mask_dilate"]))
    return remove_small_components(tuned, min_area=int(LAND_CANDIDATE["component_min_area"]))


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def render_theme_image(h: int, w: int, selected_contours: list, theme: dict) -> np.ndarray:
    img = np.ones((h, w, 3), np.uint8) * 255
    cv2.drawContours(img, selected_contours, -1, theme["bound_color"], 3)
    for cnt in selected_contours:
        cv2.drawContours(img, [cnt], 0, theme["rand_color"], -1)
    img[np.all(img == 255, axis=2)] = theme["sea_color"]
    return img


def render_binary_overlay(mask_u8: np.ndarray, fg_bgr: tuple, bg_bgr: tuple = (255, 255, 255)) -> np.ndarray:
    img = np.full((mask_u8.shape[0], mask_u8.shape[1], 3), bg_bgr, dtype=np.uint8)
    img[mask_u8 > 0] = np.array(fg_bgr, dtype=np.uint8)
    return img


def build_soft_mask(mask_u8: np.ndarray, sigma: float) -> np.ndarray:
    if np.count_nonzero(mask_u8) == 0:
        return np.zeros(mask_u8.shape, dtype=np.float32)
    soft = cv2.GaussianBlur(mask_u8.astype(np.float32) / 255.0, (0, 0), sigmaX=sigma, sigmaY=sigma)
    return np.clip(soft, 0.0, 1.0)


def smooth_contour_points(
    cnt: np.ndarray,
    window: int = RED_SEA_CONTOUR_SMOOTH_WINDOW,
    passes: int = RED_SEA_CONTOUR_SMOOTH_PASSES,
) -> np.ndarray:
    """Smooth a closed contour without polygonal simplification."""
    pts = cnt.reshape(-1, 2).astype(np.float32)
    n = int(pts.shape[0])
    if n < 8:
        return cnt

    w = max(3, int(window))
    if w % 2 == 0:
        w += 1
    half = w // 2

    for _ in range(max(1, int(passes))):
        ext = np.vstack([pts[-half:], pts, pts[:half]])
        kernel = np.ones(w, dtype=np.float32) / float(w)
        xs = np.convolve(ext[:, 0], kernel, mode="valid")
        ys = np.convolve(ext[:, 1], kernel, mode="valid")
        pts = np.stack([xs, ys], axis=1)

    pts_i = np.round(pts).astype(np.int32).reshape(-1, 1, 2)
    return pts_i


def render_contours_on_background(
    strength_u8: np.ndarray,
    mask_u8: np.ndarray,
    bg_bgr: tuple = (245, 245, 245),
) -> np.ndarray:
    """Render red-sea intensity with multi-level isolines (等高線)."""
    h, w = mask_u8.shape[:2]
    img = np.full((h, w, 3), bg_bgr, dtype=np.uint8)

    if np.count_nonzero(mask_u8) == 0:
        return img

    masked_strength = cv2.bitwise_and(strength_u8, mask_u8)
    smooth_strength = cv2.GaussianBlur(
        masked_strength, (0, 0), sigmaX=RED_SEA_SMOOTH_SIGMA, sigmaY=RED_SEA_SMOOTH_SIGMA
    )
    smooth_strength = np.where(mask_u8 > 0, smooth_strength, 0).astype(np.uint8)

    # Add subtle base heat tint so contour lines have context.
    heat = cv2.applyColorMap(smooth_strength, cv2.COLORMAP_HOT)
    alpha = (build_soft_mask(mask_u8, RED_SEA_BLEND_SIGMA) * 0.30)[:, :, None]
    img = np.clip((img.astype(np.float32) * (1.0 - alpha)) + (heat.astype(np.float32) * alpha), 0, 255).astype(np.uint8)

    # Draw isolines from low to high redness; higher levels are brighter and thicker.
    level_count = max(1, len(RED_SEA_CONTOUR_LEVELS) - 1)
    for idx, level in enumerate(RED_SEA_CONTOUR_LEVELS):
        level_mask = np.where(smooth_strength >= int(level), 255, 0).astype(np.uint8)
        level_mask = cv2.morphologyEx(
            level_mask,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
        )
        if np.count_nonzero(level_mask) == 0:
            continue
        contours, _ = cv2.findContours(level_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        t = idx / level_count
        color = (
            int(20 + 40 * t),
            int(40 + 70 * t),
            int(160 + 95 * t),
        )
        thickness = 1 if idx < 2 else 2
        valid_contours = [c for c in contours if cv2.contourArea(c) >= 24.0]
        if not valid_contours:
            continue

        # Keep the outermost contour shape as-is so map-edge lines do not bend unnaturally.
        largest_idx = int(np.argmax([cv2.contourArea(c) for c in valid_contours]))
        for i, c in enumerate(valid_contours):
            draw_cnt = c if i == largest_idx else smooth_contour_points(c)
            cv2.drawContours(img, [draw_cnt], -1, color, thickness, lineType=cv2.LINE_AA)

    return img


# ---------------------------------------------------------------------------
# Main area processor
# ---------------------------------------------------------------------------

def process_sea_area(
    area_dir: str,
    output_dir: str,
) -> None:
    area_tag = os.path.basename(area_dir)
    print(f"\nProcessing {area_tag}...")

    json_path, png_path = find_files(area_dir)
    info_path = find_info_file(area_dir)
    if not json_path or not png_path:
        print("  Skipping: missing JSON or PNG files")
        return
    if info_path:
        print(f"  Info: {os.path.basename(info_path)}")

    with open(json_path, "r", encoding="utf-8") as f:
        json_data = json.load(f)
    image = cv2.imread(png_path, cv2.IMREAD_UNCHANGED)
    if image is None:
        print(f"  Skipping: cannot read image {png_path}")
        return
    if image.ndim == 2 or image.shape[2] == 3:
        alpha = np.full((*image.shape[:2], 1), 255, dtype=np.uint8)
        image = np.concatenate([image[:, :, :3], alpha], axis=2)

    map_key = find_map_frame_key(json_data["frames"], area_tag)
    fr = json_data["frames"][map_key]["frame"]
    x0, y0, w, h = int(fr["x"]), int(fr["y"]), int(fr["w"]), int(fr["h"])
    print(f"  Frame: {map_key} ({w}x{h} at {x0},{y0})")
    region = image[y0:y0 + h, x0:x0 + w].copy()

    # ------------------------------------------------------------------
    # Pre-process: border blank + quantization
    # ------------------------------------------------------------------
    analysis_region = apply_border_blank(region, DEFAULT_PRE_CLUSTER_TRIM_PX)
    analysis_region = apply_cluster_quantization(analysis_region, DEFAULT_CLUSTER_QUANT_STEP)
    print(f"  Cluster quant step: {DEFAULT_CLUSTER_QUANT_STEP}")

    # ------------------------------------------------------------------
    # Detect red sea and create red-sea-free analysis region
    # ------------------------------------------------------------------
    red_sea_mask = detect_red_sea_mask(region, area_tag)
    red_sea_ratio = float(np.count_nonzero(red_sea_mask)) / float(max(1, h * w))
    if np.count_nonzero(red_sea_mask) > 0:
        print(f"  Red-sea detected: {red_sea_ratio:.4f} of total area")
        # Use red-sea-free region for DBSCAN to ensure clean blue-sea clustering
        analysis_region = create_red_sea_free_region(analysis_region, red_sea_mask)
        print(f"  Using red-sea-free region for blue-sea land detection")

    # ------------------------------------------------------------------
    # DBSCAN clustering in LAB colour space (on blue sea only if red sea present)
    # ------------------------------------------------------------------
    flat   = analysis_region.reshape(-1, 4)
    opaque = flat[flat[:, 3] == 255]
    colors = np.unique(opaque[:, :3], axis=0)
    print(f"  Unique opaque colors: {len(colors)}")

    lab_colors = np.array([bgr_to_lab(c) for c in colors])
    pd_data = pd.DataFrame({"R": lab_colors[:, 2], "G": lab_colors[:, 1], "B": lab_colors[:, 0]})
    eps = DBSCAN_EPS.get(area_tag, DEFAULT_DBSCAN_EPS)
    labels = DBSCAN(eps=eps, min_samples=2).fit_predict(pd_data)
    print(f"  DBSCAN eps={eps}, clusters: {np.unique(labels)}")

    # Log cluster statistics
    for s in sorted(
        select_land_label(analysis_region, colors, labels, LAND_CANDIDATE, info_path)[1],
        key=lambda x: x["label"],
    ):
        mb, mg, mr = s["mean_bgr"]
        print(
            f"    label={s['label']:>2} area={s['area_ratio']:.3f} "
            f"border={s['border_ratio']:.3f} "
            f"green={s['green_score']:.1f} blue={s['blue_score']:.1f} "
            f"mean_bgr=({mb:.1f},{mg:.1f},{mr:.1f})"
        )

    os.makedirs(output_dir, exist_ok=True)

    # ------------------------------------------------------------------
    # Contour builder using unified LAND_CANDIDATE preset
    # ------------------------------------------------------------------
    selected, label_stats = select_land_label(
        analysis_region, colors, labels, LAND_CANDIDATE, info_path
    )

    if selected is None:
        # Single-cluster edge case: fall back to colour-dominance mask.
        fallback = build_land_mask_by_color(analysis_region)
        fallback = tune_mask_by_candidate(fallback)
        fallback_contours = build_contours_from_mask_with_area(
            fallback, area_tag,
            component_min_area=int(LAND_CANDIDATE["component_min_area"]),
            contour_min_area=float(LAND_CANDIDATE["contour_min_area"]),
        )
        fallback_ratio = float(np.count_nonzero(fallback)) / float(h * w)
        if fallback_contours and fallback_ratio > 0.0005:
            selected = {
                "label": -999,
                "area_ratio": fallback_ratio,
                "selected_by": "color_fallback",
            }
            selected_contours = fallback_contours
        else:
            print("  Candidate selection failed; trying border-sea-split fallback...")
            fallback_mask = build_land_mask_by_border_sea_split(analysis_region, area_tag)
            ratio = float(np.count_nonzero(fallback_mask)) / float(h * w)
            if np.count_nonzero(fallback_mask) > 0 and ratio > 0.0005:
                selected_contours = build_contours_from_mask_with_area(
                    fallback_mask, area_tag,
                    component_min_area=int(LAND_CANDIDATE["component_min_area"]),
                    contour_min_area=float(LAND_CANDIDATE["contour_min_area"]),
                )
                selected = {"label": -1, "area_ratio": ratio, "selected_by": "border_sea_split"}
            else:
                print("  Skipping: cannot determine land")
                return
    else:
        bicolor = remove_small_components(
            selected["mask"], min_area=int(LAND_CANDIDATE["component_min_area"])
        )
        selected_ratio = float(np.count_nonzero(bicolor)) / float(h * w)

        # Fall back to colour mask when the cluster is implausibly small.
        if selected_ratio < LAND_CANDIDATE["fallback_min_ratio"]:
            fallback = build_land_mask_by_color(analysis_region)
            fallback_ratio = float(np.count_nonzero(fallback)) / float(h * w)
            if fallback_ratio > selected_ratio and fallback_ratio <= LAND_CANDIDATE["fallback_max_ratio"]:
                bicolor = fallback
                print(
                    f"  Land mask fallback: color_dominance "
                    f"({selected_ratio:.4f} -> {fallback_ratio:.4f})"
                )

        bicolor = tune_mask_by_candidate(bicolor)
        bicolor = suppress_axis_grid_lines(bicolor, area_tag)
        bicolor = merge_with_coastline_assist(bicolor, analysis_region)

        if np.count_nonzero(red_sea_mask) > 0:
            # Prioritize reliable blue-sea islands by excluding red-sea core from base mask.
            red_core = cv2.erode(
                red_sea_mask,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
                iterations=1,
            )
            before_blue = int(np.count_nonzero(bicolor))
            bicolor = cv2.bitwise_and(bicolor, cv2.bitwise_not(red_core))
            after_blue = int(np.count_nonzero(bicolor))
            if before_blue > 0 and after_blue < before_blue:
                print(
                    f"  Blue-sea prioritization: removed {before_blue - after_blue} px from red-sea core"
                )

        contours, hierarchy = cv2.findContours(bicolor, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

        # Detect islands specifically in red-sea zones (if red sea is present)
        if np.count_nonzero(red_sea_mask) > 0:
            red_sea_islands = detect_islands_in_red_sea(region, red_sea_mask, area_tag)
            red_island_ratio = float(np.count_nonzero(red_sea_islands)) / float(h * w)
            if red_island_ratio > 0.0001:
                bicolor = cv2.bitwise_or(bicolor, red_sea_islands)
                bicolor = suppress_axis_grid_lines(bicolor, area_tag)
                bicolor = remove_small_components(
                    bicolor, min_area=int(LAND_CANDIDATE["component_min_area"])
                )
                print(f"  Red-sea islands detected: +{red_island_ratio:.4f} land from red zone")
                contours, hierarchy = cv2.findContours(
                    bicolor, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE
                )

        # Additional red-zone assist for mixed red/blue sea maps.
        red_land_assist = build_red_zone_land_assist_mask(region, area_tag)
        red_assist_ratio = float(np.count_nonzero(red_land_assist)) / float(h * w)
        if 0.0003 < red_assist_ratio < 0.02:
            bicolor = cv2.bitwise_or(bicolor, red_land_assist)
            bicolor = suppress_axis_grid_lines(bicolor, area_tag)
            bicolor = remove_small_components(
                bicolor, min_area=int(LAND_CANDIDATE["component_min_area"])
            )
            print(f"  Red-zone assist: +{red_assist_ratio:.4f} land from original")
            contours, hierarchy = cv2.findContours(
                bicolor, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE
            )

        min_area = float(LAND_CANDIDATE["contour_min_area"])

        # When selected cluster is very large (likely sea), use its holes as land.
        if selected["area_ratio"] > 0.5 and hierarchy is not None:
            selected_contours = [
                contours[i]
                for i, h_info in enumerate(hierarchy[0])
                if h_info[3] != -1 and is_land_contour(contours[i], min_area)
            ]
            if not selected_contours:
                selected_contours = [c for c in contours if is_land_contour(c, min_area)]
        else:
            selected_contours = [c for c in contours if is_land_contour(c, min_area)]

        selected_contours = remove_border_touching_contours(
            selected_contours, w, h, margin=2
        )

    print(
        f"  Selected: {LAND_CANDIDATE['name']} | "
        f"label={selected.get('label')} area={selected['area_ratio']:.3f} | "
        f"by={selected.get('selected_by')}"
    )
    print(f"  Contours used: {len(selected_contours)}")

    selected_land_mask = np.zeros((h, w), np.uint8)
    if selected_contours:
        cv2.drawContours(selected_land_mask, selected_contours, -1, 255, -1)

    red_sea_mask = detect_red_sea_mask(region, area_tag)
    unresolved_red_mask = cv2.bitwise_and(red_sea_mask, cv2.bitwise_not(selected_land_mask))
    unresolved_ratio = float(np.count_nonzero(unresolved_red_mask)) / float(max(1, h * w))
    red_strength_map = build_redness_strength_map(region)
    red_strength_on_sea = cv2.bitwise_and(red_strength_map, red_sea_mask)

    if np.count_nonzero(red_sea_mask) > 0:
        red_sea_path = os.path.join(output_dir, f"{area_tag}_red_sea_mask.png")
        unresolved_path = os.path.join(output_dir, f"{area_tag}_red_sea_unresolved.png")
        redness_heatmap_path = os.path.join(output_dir, f"{area_tag}_redness_heatmap.png")
        # Render red-sea mask as contour outlines (等高線)
        cv2.imwrite(red_sea_path, render_contours_on_background(red_strength_on_sea, red_sea_mask, bg_bgr=(245, 245, 245)))
        cv2.imwrite(unresolved_path, render_contours_on_background(red_strength_on_sea, unresolved_red_mask, bg_bgr=(255, 255, 255)))
        cv2.imwrite(redness_heatmap_path, render_redness_heatmap(red_strength_on_sea))

        sea_vals = red_strength_on_sea[red_sea_mask > 0]
        mild = float(np.mean(sea_vals >= 64)) if sea_vals.size > 0 else 0.0
        mid = float(np.mean(sea_vals >= 128)) if sea_vals.size > 0 else 0.0
        strong = float(np.mean(sea_vals >= 192)) if sea_vals.size > 0 else 0.0
        print(
            f"  Red-sea filter(contours): total={int(np.count_nonzero(red_sea_mask))} "
            f"unresolved={int(np.count_nonzero(unresolved_red_mask))} ({unresolved_ratio:.4f})"
        )
        print(
            f"  Redness levels(sea): mild={mild:.3f} mid={mid:.3f} strong={strong:.3f}"
        )
        print(f"  Saved: {red_sea_path}")
        print(f"  Saved: {unresolved_path}")
        print(f"  Saved: {redness_heatmap_path}")

    for theme_name, theme in THEMES.items():
        img      = render_theme_image(h, w, selected_contours, theme)
        if np.count_nonzero(red_sea_mask) > 0:
            # Visualize red-sea intensity on non-land pixels as a gradient,
            # instead of forcing red-side land detection.
            sea_only = (red_sea_mask > 0) & (selected_land_mask == 0)
            if np.any(sea_only):
                base = np.array(theme["sea_color"], dtype=np.float32)
                hot = np.array(theme["undetected_red_sea_color"], dtype=np.float32)
                soft_edge = build_soft_mask(red_sea_mask, RED_SEA_BLEND_SIGMA)
                weight = ((red_strength_on_sea.astype(np.float32) / 255.0) * soft_edge)[:, :, None]
                blended = (base[None, None, :] * (1.0 - weight)) + (hot[None, None, :] * weight)
                img[sea_only] = np.clip(blended[sea_only], 0, 255).astype(np.uint8)
        out_path = os.path.join(output_dir, f"{area_tag}_{theme_name}.png")
        cv2.imwrite(out_path, img)
        print(f"  Saved: {out_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate land-mask images from KanColle map sprite sheets."
    )
    parser.add_argument(
        "areas", nargs="*",
        help="Area tags to process (e.g. 1-1). Omit to process all detected areas.",
    )
    cli = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(script_dir, "output")

    if cli.areas:
        areas = cli.areas
    else:
        areas = sorted([
            d for d in os.listdir(script_dir)
            if os.path.isdir(os.path.join(script_dir, d)) and re.match(r"\d+-\d+", d)
        ])

    for area in areas:
        area_dir = os.path.join(script_dir, area)
        if os.path.isdir(area_dir):
            process_sea_area(
                area_dir,
                output_dir,
            )
