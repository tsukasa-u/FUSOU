import cv2
import numpy as np
import json
import os
import sys
import re
from collections import Counter

import pandas as pd
from sklearn.cluster import DBSCAN


# Color themes (all colors in BGR for OpenCV)
THEMES = {
    "dark": {
        "rand_color": (0xD4, 0xB4, 0xA1),   # BGR for RGB(0xA1, 0xB4, 0xD4)
        "bound_color": (84, 82, 81),          # BGR
        "sea_color": (0x45, 0x45, 0x45),      # BGR
    },
    "light": {
        "rand_color": (0x5F, 0x90, 0x7A),    # BGR for RGB(0x7A, 0x90, 0x5F)
        "bound_color": (84, 82, 81),          # BGR
        "sea_color": (0xFF, 0xFF, 0xFF),      # BGR
    },
}

# Per-area DBSCAN eps
DBSCAN_EPS = {
    "2-2": 7,
    "2-5": 10,
    "4-5": 10,
    "5-3": 7,
    "6-5": 10,
}


def is_map_image_basename(file_name):
    lower = file_name.lower()
    return "image" in lower or "imgae" in lower


def bgr_to_lab(input_color):
    b, g, r = input_color[0] / 255.0, input_color[1] / 255.0, input_color[2] / 255.0
    r = r / 12.92 if r <= 0.04045 else ((r + 0.055) / 1.055) ** 2.4
    g = g / 12.92 if g <= 0.04045 else ((g + 0.055) / 1.055) ** 2.4
    b = b / 12.92 if b <= 0.04045 else ((b + 0.055) / 1.055) ** 2.4

    x = (r * 0.4124) + (g * 0.3576) + (b * 0.1805)
    y = (r * 0.2126) + (g * 0.7152) + (b * 0.0722)
    z = (r * 0.0193) + (g * 0.1192) + (b * 0.9505)
    x *= 100
    y *= 100
    z *= 100

    X_n, Y_n, Z_n = 95.0489, 100.0, 108.8840
    x /= X_n
    y /= Y_n
    z /= Z_n

    delta = 6 / 29
    delta_3 = delta ** 3
    delta__2 = delta ** -2

    def f(t):
        return t ** (1 / 3) if t > delta_3 else delta__2 * t / 3 + 4 / 29

    L = 116 * f(y) - 16
    a = 500 * (f(x) - f(y))
    _b = 200 * (f(y) - f(z))
    return [L, a, _b]


def find_files(area_dir):
    json_files = [
        os.path.join(area_dir, n)
        for n in os.listdir(area_dir)
        if n.lower().endswith(".json") and is_map_image_basename(n)
    ]
    png_files = [
        os.path.join(area_dir, n)
        for n in os.listdir(area_dir)
        if n.lower().endswith(".png") and is_map_image_basename(n)
    ]
    if not json_files or not png_files:
        return None, None
    return sorted(json_files)[0], sorted(png_files)[0]


def find_info_file(area_dir):
    info_files = [
        os.path.join(area_dir, n)
        for n in os.listdir(area_dir)
        if n.lower().endswith("info.json")
    ]
    if not info_files:
        return None
    return sorted(info_files)[0]


def find_map_frame_key(frames, area_tag):
    suffix = f"_map{area_tag}"
    for key in frames:
        if key.endswith(suffix):
            return key
    return max(frames.keys(), key=lambda k: frames[k]["frame"]["w"] * frames[k]["frame"]["h"])


def build_label_mask(region, colors, labels, target_label):
    h, w = region.shape[:2]
    alpha_ok = region[:, :, 3] == 255
    mask = np.zeros((h, w), np.uint8)
    for i, c in enumerate(colors):
        if labels[i] != target_label:
            continue
        matched = np.all(region[:, :, :3] == c, axis=2) & alpha_ok
        mask[matched] = 255
    return mask


def calc_border_ratio(mask):
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


def vote_land_label_from_spots(region, colors, labels, info_path):
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
    votes = Counter()
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


def select_land_label(region, colors, labels, info_path=None):
    h, w = region.shape[:2]
    area_total = h * w
    stats = []

    for label in np.unique(labels):
        mask = build_label_mask(region, colors, labels, label)
        area_px = int(np.count_nonzero(mask))
        if area_px == 0:
            continue

        area_ratio = area_px / area_total
        border_ratio = calc_border_ratio(mask)
        pixels = region[:, :, :3][mask > 0]
        mean_bgr = pixels.mean(axis=0)
        green_score = float(mean_bgr[1] - max(mean_bgr[0], mean_bgr[2]))
        blue_score = float(mean_bgr[0] - max(mean_bgr[1], mean_bgr[2]))
        stats.append(
            {
                "label": int(label),
                "mask": mask,
                "area_px": area_px,
                "area_ratio": area_ratio,
                "border_ratio": border_ratio,
                "mean_bgr": mean_bgr,
                "green_score": green_score,
                "blue_score": blue_score,
            }
        )

    if not stats:
        return None, []

    # Primary rule: land colors are generally greener than sea in this asset set.
    green_candidates = [
        s for s in stats
        if s["area_ratio"] >= 0.001 and s["green_score"] > 2.0
    ]
    if green_candidates:
        best = max(green_candidates, key=lambda s: (s["green_score"], s["area_ratio"]))
        best["selected_by"] = "green_score"
        return best, stats

    # Secondary rule: use map spot coordinates as anchors.
    voted_label, sampled = vote_land_label_from_spots(region, colors, labels, info_path)
    if voted_label is not None:
        for s in stats:
            if s["label"] == voted_label:
                s["selected_by"] = f"spot_votes(sampled={sampled})"
                return s, stats

    # Fallback: ignore tiny noise-like clusters first.
    candidates = [s for s in stats if s["area_ratio"] >= 0.01]
    if not candidates:
        candidates = stats

    # Land is usually interior; sea tends to touch frame borders heavily.
    interior = [s for s in candidates if s["border_ratio"] <= 0.20]
    if interior:
        best = max(interior, key=lambda s: s["area_ratio"])
    else:
        best = min(candidates, key=lambda s: (s["border_ratio"], -s["area_ratio"]))

    best["selected_by"] = "fallback(border_ratio)"

    return best, stats


def process_sea_area(area_dir, output_dir):
    area_tag = os.path.basename(area_dir)
    print(f"Processing {area_tag}...")

    json_path, png_path = find_files(area_dir)
    info_path = find_info_file(area_dir)
    if not json_path or not png_path:
        print(f"  Skipping: missing JSON or PNG files")
        return
    if info_path:
        print(f"  Info: {os.path.basename(info_path)}")

    with open(json_path, "r") as f:
        json_data = json.load(f)

    image = cv2.imread(png_path, cv2.IMREAD_UNCHANGED)
    if image is None:
        print(f"  Skipping: cannot read image {png_path}")
        return

    # Ensure 4-channel BGRA
    if image.shape[2] == 3:
        alpha = np.full((*image.shape[:2], 1), 255, dtype=np.uint8)
        image = np.concatenate([image, alpha], axis=2)

    map_key = find_map_frame_key(json_data["frames"], area_tag)
    xywh = json_data["frames"][map_key]["frame"]
    x0, y0, w, h = xywh["x"], xywh["y"], xywh["w"], xywh["h"]
    print(f"  Frame: {map_key} ({w}x{h} at {x0},{y0})")

    # Extract map region (BGRA)
    region = image[y0 : y0 + h, x0 : x0 + w]

    # Get unique opaque colors (BGR)
    flat = region.reshape(-1, 4)
    opaque = flat[flat[:, 3] == 255]
    colors = np.unique(opaque[:, :3], axis=0)
    print(f"  Unique opaque colors: {len(colors)}")

    # Convert to LAB and cluster
    lab_colors = np.array([bgr_to_lab(c) for c in colors])
    pd_data = pd.DataFrame(
        dict(R=lab_colors[:, 2], G=lab_colors[:, 1], B=lab_colors[:, 0])
    )
    eps = DBSCAN_EPS.get(area_tag, 10)
    labels = DBSCAN(eps=eps, min_samples=2).fit_predict(pd_data)
    print(f"  DBSCAN eps={eps}, clusters: {np.unique(labels)}")

    # Build binary mask for land using automatic label selection.
    selected, label_stats = select_land_label(region, colors, labels, info_path)
    if selected is None:
        print("  Skipping: cannot determine land label")
        return

    for s in sorted(label_stats, key=lambda x: x["label"]):
        mean_b, mean_g, mean_r = s["mean_bgr"]
        print(
            f"    label={s['label']:>2} area={s['area_ratio']:.3f} border={s['border_ratio']:.3f} "
            f"green={s['green_score']:.1f} blue={s['blue_score']:.1f} "
            f"mean_bgr=({mean_b:.1f},{mean_g:.1f},{mean_r:.1f})"
        )
    print(
        f"  Selected land label: {selected['label']} (area={selected['area_ratio']:.3f}, border={selected['border_ratio']:.3f}, by={selected.get('selected_by', 'unknown')})"
    )
    bicolor = selected["mask"]

    # Find contours
    contours, hierarchy = cv2.findContours(bicolor, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    min_contour_area = 8.0

    if selected["area_ratio"] > 0.5 and hierarchy is not None:
        # If the selected mask is mostly sea, use hole contours as land islands.
        selected_contours = [
            contours[i]
            for i, h_info in enumerate(hierarchy[0])
            if h_info[3] != -1 and cv2.contourArea(contours[i]) >= min_contour_area
        ]
        contour_mode = "sea_holes"
        if not selected_contours:
            selected_contours = [c for c in contours if cv2.contourArea(c) >= min_contour_area]
            contour_mode = "all"
    else:
        selected_contours = [c for c in contours if cv2.contourArea(c) >= min_contour_area]
        contour_mode = "all"

    print(f"  Contours found: {len(contours)} (used: {len(selected_contours)}, mode={contour_mode})")

    # Generate themed images
    os.makedirs(output_dir, exist_ok=True)

    for theme_name, theme in THEMES.items():
        rand_color = theme["rand_color"]
        bound_color = theme["bound_color"]
        sea_color = theme["sea_color"]

        # Cell 12: Draw contour boundaries on white image (BGR)
        img = np.ones((h, w, 3), np.uint8) * 255
        cv2.drawContours(img, selected_contours, -1, bound_color, 3)

        # Cell 13: Fill contours with land color
        for cnt in selected_contours:
            cv2.drawContours(img, [cnt], 0, rand_color, -1)

        # Apply sea color to remaining white pixels
        white_mask = np.all(img == 255, axis=2)
        img[white_mask] = sea_color

        # Save
        output_path = os.path.join(output_dir, f"{area_tag}_{theme_name}.png")
        cv2.imwrite(output_path, img)
        print(f"  Saved: {output_path}")


if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(script_dir, "output")

    if len(sys.argv) > 1:
        areas = sys.argv[1:]
    else:
        areas = sorted([
            d for d in os.listdir(script_dir)
            if os.path.isdir(os.path.join(script_dir, d)) and re.match(r"\d+-\d+", d)
        ])

    for area in areas:
        area_dir = os.path.join(script_dir, area)
        if os.path.isdir(area_dir):
            process_sea_area(area_dir, output_dir)
