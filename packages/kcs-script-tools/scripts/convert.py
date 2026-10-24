import os
import sys
import json
import re
import cv2
import numpy as np

THEMES = {
    "dark": {
        "rand_color": (95, 144, 122),   # #7A905F (BGR)
        "bound_color": (81, 82, 84),    # #545251
        "sea_color": (69, 69, 69),      # #454545
    },
    "light": {
        "rand_color": (95, 144, 122),   # #7A905F
        "bound_color": (81, 82, 84),    # #545251
        "sea_color": (241, 245, 249),   # #f1f5f9
    },
}

def load_all_image_sheets(area_dir):
    sheets = {}
    for f in sorted(os.listdir(area_dir)):
        if f.endswith('.json') and 'image' in f:
            base = f.replace('.json', '')
            png_name = base + '.png'
            png_path = os.path.join(area_dir, png_name)
            if os.path.exists(png_path):
                try:
                    with open(os.path.join(area_dir, f), 'r', encoding='utf-8') as fp:
                        idata = json.load(fp)
                    img = cv2.imread(png_path, cv2.IMREAD_UNCHANGED)
                    if img is not None:
                        sheets[base] = (idata.get('frames', {}), img)
                except Exception as e:
                    print(f'  Warning loading sheet {base}: {e}')
    return sheets

def find_base_map_image(area_dir, area_tag, image_sheets):
    digits = re.findall(r"\d+", area_tag)
    tag_clean = "".join(digits)
    suffix = f"map{area_tag}"

    for base, (frames, img_sheet) in image_sheets.items():
        for k, v in frames.items():
            if "point" in k.lower():
                continue
            if k.endswith("_" + suffix) or k.endswith(suffix):
                mf = v["frame"]
                x, y, w, h = mf["x"], mf["y"], mf["w"], mf["h"]
                return img_sheet[y:y+h, x:x+w]

        for k, v in frames.items():
            if "point" in k.lower():
                continue
            mf = v["frame"]
            if mf["w"] >= 800 and mf["h"] >= 500:
                if "map" in k.lower() and (area_tag in k or (tag_clean and tag_clean in k)):
                    x, y, w, h = mf["x"], mf["y"], mf["w"], mf["h"]
                    return img_sheet[y:y+h, x:x+w]

        candidates = [
            (k, v["frame"]) for k, v in frames.items()
            if "point" not in k.lower() and v["frame"]["w"] >= 800 and v["frame"]["h"] >= 500
        ]
        if candidates:
            candidates.sort(key=lambda c: c[1]["w"] * c[1]["h"], reverse=True)
            mf = candidates[0][1]
            x, y, w, h = mf["x"], mf["y"], mf["w"], mf["h"]
            return img_sheet[y:y+h, x:x+w]

    return None

def load_merged_map_data(area_dir):
    info_files = sorted([
        os.path.join(area_dir, f)
        for f in os.listdir(area_dir)
        if f.endswith('.json') and 'info' in f
    ])
    
    merged_spots = {}
    official_labels = []
    base_bg = []
    merged_enemies = []
    merged_airraids = []

    for f in info_files:
        try:
            with open(f, 'r', encoding='utf-8') as fp:
                d = json.load(fp)
            if not base_bg and d.get('bg'):
                base_bg = d.get('bg')
            for s in d.get('spots', []):
                merged_spots[int(s['no'])] = s
            for l in d.get('labels', []):
                official_labels.append(l)
            for e in d.get('enemies', []):
                merged_enemies.append(e)
            for a in d.get('airraids', []):
                merged_airraids.append(a)
        except Exception as e:
            print(f'  Warning reading {f}: {e}')

    return {
        'spots': merged_spots,
        'official_labels': official_labels,
        'bg': base_bg,
        'enemies': merged_enemies,
        'airraids': merged_airraids,
        'info_files': info_files
    }

def remove_grid_lines(img_bgr):
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)).mean(axis=0)
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)).mean(axis=1)

    period = 47
    best_x, best_y = 0, 0
    best_xs, best_ys = 0, 0
    for x0 in range(period):
        s = gx[np.arange(x0, w, period)].mean()
        if s > best_xs:
            best_xs, best_x = s, x0
    for y0 in range(period):
        s = gy[np.arange(y0, h, period)].mean()
        if s > best_ys:
            best_ys, best_y = s, y0

    grid_mask = np.zeros((h, w), dtype=np.uint8)
    for x in range(best_x, w, period):
        cv2.line(grid_mask, (x, 0), (x, h), 255, 2)
    for y in range(best_y, h, period):
        cv2.line(grid_mask, (0, y), (w, y), 255, 2)

    return cv2.inpaint(img_bgr, grid_mask, 3, cv2.INPAINT_TELEA)

def extract_land_mask(region, spots, area_tag):
    h, w = region.shape[:2]
    alpha_chan = region[:, :, 3] if region.shape[2] == 4 else np.full((h, w), 255, dtype=np.uint8)
    opaque = (alpha_chan == 255)

    # 1. 47px 格子線・高周波ノイズの除去 (3x3 メディアンブラー)
    bgr_raw = region[:, :, :3]
    bgr = cv2.medianBlur(bgr_raw, 3)

    bx, by = 34, 36
    bottom_border = 58
    inner = np.zeros((h, w), dtype=bool)
    inner[by:h - bottom_border, bx:w - bx] = True

    b = bgr[:, :, 0].astype(float)
    g = bgr[:, :, 1].astype(float)
    r = bgr[:, :, 2].astype(float)

    # 2. 赤いグラデーション海域の完全な剥がし（Red-Excess Unblending）
    # R > B のピクセルについて、赤色過剰分を青色成分に変換して海面を完全青化
    red_excess = np.maximum(0.0, r - b)
    unred_b = np.clip(b + red_excess, 0, 255)
    unred_r = np.clip(r - red_excess, 0, 255)
    unred_g = g

    unred = cv2.merge([unred_b.astype(np.uint8), unred_g.astype(np.uint8), unred_r.astype(np.uint8)])

    # 3. 復元海図上での精密な島抽出（青い海の実績ある高精度ロジック）
    ub = unred[:, :, 0].astype(float)
    ug = unred[:, :, 1].astype(float)
    ur = unred[:, :, 2].astype(float)
    uhsv = cv2.cvtColor(unred, cv2.COLOR_BGR2HSV)
    uH = uhsv[:, :, 0]
    uS = uhsv[:, :, 1]
    uV = uhsv[:, :, 2]

    # 青い海（画像全体が一様な青海になっているためシンプルかつ確実に除外）
    blue_sea = (ub > ug) & (ub > ur + 10) & (ub > 40)
    deep_blue = (ub > ur) & (ub > ug - 8) & (ub < 48) & (ur < 38)
    all_sea = blue_sea | deep_blue

    # 真正な島の判定
    # 緑の山林・森林: H in 22..95, G優位
    green_island = (uH >= 22) & (uH <= 95) & (ug > ub - 12) & (ug > ur - 15) & (uV > 30)
    # 白い砂浜・岩礁・海岸線・雪山
    bright_beach = (uV > 90) & (uS < 75) & (ub < 165) & ~all_sea
    # 茶色・黄土色の岩肌・土壌
    brown_island = (uH >= 10) & (uH <= 30) & (ur > ub + 5) & (ug > ub - 10) & (uV > 45) & ~all_sea

    # 統合陸地マスク（島を細切れ・散り散りにせず、しっかりした塊として抽出）
    land = (green_island | bright_beach | brown_island | (~all_sea & (ug > ur - 5))) & inner & ~all_sea

    # モルフォロジー閉演算（4x4楕円カーネルで島の穴あきや隙間を結合）
    k4 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (4, 4))
    land_u8 = cv2.morphologyEx(land.astype(np.uint8) * 255, cv2.MORPH_CLOSE, k4)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(land_u8)
    clean_land = np.zeros_like(land_u8)

    for i in range(1, num_labels):
        sz = stats[i, cv2.CC_STAT_AREA]
        cw = stats[i, cv2.CC_STAT_WIDTH]
        ch = stats[i, cv2.CC_STAT_HEIGHT]
        cx = stats[i, cv2.CC_STAT_LEFT]
        cy = stats[i, cv2.CC_STAT_TOP]

        if sz < 8 or cw > 960 or ch > 590:
            continue
        # コンパスローズ（左上）除外
        if cx < 220 and cy < 220 and 0.8 < float(cw) / max(1, ch) < 1.2 and sz > 800:
            continue
        # 右上・右端の枠線残り除外
        if cx > 900 and cy < 75:
            continue
        if cx > 1140:
            continue

        clean_land[labels == i] = 255

    clean_land = clean_land & (opaque.astype(np.uint8) * 255)
    return clean_land

def process_map_images(area_dir, area_tag, map_region, spots, output_dir, public_dir, dist_client_dir):
    if map_region is None:
        return
    h, w = map_region.shape[:2]
    custom_mask_path = os.path.join(area_dir, "land_mask.png")
    if os.path.exists(custom_mask_path):
        clean_mask = cv2.imread(custom_mask_path, cv2.IMREAD_GRAYSCALE)
        if clean_mask.shape[:2] != (h, w):
            clean_mask = cv2.resize(clean_mask, (w, h), interpolation=cv2.INTER_NEAREST)
        print(f"  Map {area_tag}: Using custom land_mask.png")
    else:
        clean_mask = extract_land_mask(map_region, spots, area_tag)
    contours, _ = cv2.findContours(clean_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    land_pixels = np.count_nonzero(clean_mask)
    pct = (land_pixels / (w * h)) * 100
    print(f"  Map {area_tag}: Land={land_pixels} px ({pct:.2f}%)")

    target_dirs = []
    if output_dir:
        target_dirs.append(output_dir)
    if public_dir:
        target_dirs.append(os.path.join(public_dir, area_tag))
    if dist_client_dir and os.path.exists(dist_client_dir):
        target_dirs.append(os.path.join(dist_client_dir, area_tag))

    for td in target_dirs:
        os.makedirs(td, exist_ok=True)

    # 兼用マップ画像 (BGRA): 海はAlpha=0の完全透過、島と輪郭線のみ描画
    map_img = np.zeros((h, w, 4), dtype=np.uint8)
    island_bgr = (95, 144, 122) # #7A905F
    bound_bgr = (81, 82, 84)    # #545251

    for cnt in contours:
        cv2.drawContours(map_img, [cnt], 0, (*island_bgr, 255), -1)
    cv2.drawContours(map_img, contours, -1, (*bound_bgr, 255), 2)

    for td in target_dirs:
        # 兼用海図画像 (海透過PNGのみ出力)
        cv2.imwrite(os.path.join(td, f"{area_tag}_map.png"), map_img)

    # 開発ツール下敷き用の元画像 (ローカル作業ディレクトリ area_dir のみに保存、publicには出さない)
    orig_out = map_region[:, :, :3] if map_region.shape[2] == 4 else map_region
    cv2.imwrite(os.path.join(area_dir, f"{area_tag}_orig.png"), orig_out)

def process_map_routes(area_dir, area_tag, spots, image_sheets, public_dir, dist_client_dir):
    canonical_map = {}
    coord_to_canon = {}
    for sno, s in spots.items():
        c = (s["x"], s["y"])
        if c not in coord_to_canon:
            coord_to_canon[c] = sno
        canonical_map[sno] = coord_to_canon[c]

    spot_dict = {sno: (float(s["x"]), float(s["y"])) for sno, s in spots.items()}
    routes = []

    for sno, s in sorted(spots.items()):
        line = s.get("line")
        if not line:
            continue
        sx, sy = float(s["x"]), float(s["y"])
        lx, ly = sx + float(line.get("x", 0)), sy + float(line.get("y", 0))
        img_name = line.get("img")
        route_obj = s.get("route")
        if not img_name and route_obj:
            img_name = route_obj.get("img")

        matched_frame = None
        matched_sheet = None
        for sname, (frames, img_sheet) in image_sheets.items():
            if img_name:
                for fk, fv in frames.items():
                    if fk.endswith("_" + img_name) or fk == img_name:
                        matched_frame = fv["frame"]
                        matched_sheet = img_sheet
                        break
            if not matched_frame:
                for fk, fv in frames.items():
                    if f"route_{sno}" in fk or f"root{sno}" in fk:
                        matched_frame = fv["frame"]
                        matched_sheet = img_sheet
                        break
            if matched_frame:
                break

        if not matched_frame or matched_sheet is None:
            continue

        fx, fy, fw, fh = matched_frame["x"], matched_frame["y"], matched_frame["w"], matched_frame["h"]
        crop = matched_sheet[fy:fy+fh, fx:fx+fw]
        if crop.shape[2] < 4:
            continue
        alpha = crop[:, :, 3]
        ys, xs = np.where(alpha > 30)
        if len(xs) < 10:
            continue

        pts = np.column_stack([xs + lx, ys + ly]).astype(float)
        mean = np.mean(pts, axis=0)
        _, eigvecs = np.linalg.eigh(np.cov(pts, rowvar=False))
        proj = (pts - mean) @ eigvecs[:, 1]
        end1 = pts[np.argmin(proj)]
        end2 = pts[np.argmax(proj)]

        d1_s = np.hypot(end1[0] - sx, end1[1] - sy)
        d2_s = np.hypot(end2[0] - sx, end2[1] - sy)
        end_to = end1 if d1_s < d2_s else end2
        end_from = end2 if d1_s < d2_s else end1

        dest_canon = canonical_map[sno]
        other_spots = []
        for num, sp in spot_dict.items():
            if np.hypot(sp[0] - sx, sp[1] - sy) < 15.0:
                continue
            dist_to_from = np.hypot(end_from[0] - sp[0], end_from[1] - sp[1])
            other_spots.append((canonical_map[num], dist_to_from))

        if not other_spots:
            continue
        other_spots.sort(key=lambda x: x[1])
        from_no = other_spots[0][0]
        to_no = dest_canon

        if to_no == 0 and from_no != 0:
            from_no, to_no = to_no, from_no
            end_from, end_to = end_to, end_from

        from_spot = spot_dict[from_no]
        to_spot = spot_dict[to_no]

        V = np.array([to_spot[0] - from_spot[0], to_spot[1] - from_spot[1]])
        dist_spots = np.hypot(V[0], V[1]) or 1.0
        u = V / dist_spots

        projs = (pts - from_spot) @ u
        p_min, p_max = np.min(projs), np.max(projs)
        t = np.clip((projs - p_min) / (p_max - p_min + 1e-6), 0.0, 1.0)

        p_start_raw = np.mean(pts[t <= 0.08], axis=0)
        p_end_raw = np.mean(pts[t >= 0.92], axis=0)

        # 1. 前のセルと線分の間に十分なスペース(余白)を保つ(公式スプライト本来の端点位置を採用)
        P0 = p_start_raw
        P1 = p_end_raw
        d_from = np.hypot(P0[0] - from_spot[0], P0[1] - from_spot[1])
        if d_from < 22.0:
            P0 = from_spot + u * 28.0
        d_to = np.hypot(P1[0] - to_spot[0], P1[1] - to_spot[1])
        if d_to < 22.0:
            P1 = to_spot - u * 28.0

        # 2. 直線・曲線の厳密判定(直線からの最大・平均乖離を測定)
        chord = P1 - P0
        L = np.hypot(chord[0], chord[1]) or 1.0
        perp_dists = np.abs(chord[0] * (pts[:, 1] - P0[1]) - chord[1] * (pts[:, 0] - P0[0])) / L
        max_dev = float(np.max(perp_dists))
        mean_dev = float(np.mean(perp_dists))

        # 最大乖離が小さければ完全な直線として扱う
        if max_dev < 6.0 or mean_dev < 2.5:
            curv = 0.0
            Pc = (P0 + P1) / 2.0
        else:
            w_pts = 2.0 * (1.0 - t) * t
            denom = np.sum(w_pts ** 2)
            if denom < 1e-5:
                Pc = (P0 + P1) / 2.0
                curv = 0.0
            else:
                residuals = pts - (1.0 - t[:, None])**2 * P0 - (t[:, None])**2 * P1
                Pc = np.sum(w_pts[:, None] * residuals, axis=0) / denom
                cross = chord[0] * (P0[1] - Pc[1]) - chord[1] * (P0[0] - Pc[0])
                h_ctrl = abs(cross) / L
                sign = 1.0 if cross >= 0 else -1.0
                curv = 0.5 * h_ctrl * sign

        # 3. 公式の arrow スプライト判定(arrow名が含まれるもののみ矢印)
        is_arrow = bool(img_name and "arrow" in img_name.lower())

        routes.append({
            "from": int(from_no),
            "to": int(to_no),
            "startX": round(float(P0[0]), 1),
            "startY": round(float(P0[1]), 1),
            "ctrlX": round(float(Pc[0]), 1),
            "ctrlY": round(float(Pc[1]), 1),
            "endX": round(float(P1[0]), 1),
            "endY": round(float(P1[1]), 1),
            "isArrow": is_arrow
        })

    # routes are now saved in unified data.json

    return routes

def alpha_fallback_label(cell_id):
    if not cell_id or cell_id <= 0:
        return "スタート" if cell_id == 0 else ""
    res = ""
    num = cell_id
    while num > 0:
        rem = (num - 1) % 26
        res = chr(65 + rem) + res
        num = (num - 1) // 26
    return res

def identify_ports(spots, routes):
    to_nodes = {r['to'] for r in routes}
    from_nodes = {r['from'] for r in routes}
    ports = set()
    for sno, s in spots.items():
        if sno == 0:
            ports.add(sno)
        elif 'line' not in s or not s.get('line'):
            ports.add(sno)
        elif sno in from_nodes and sno not in to_nodes:
            ports.add(sno)
    return sorted(list(ports))

def process_map_labels(area_dir, area_tag, spots, official_labels, routes, public_dir, dist_client_dir):
    labels = {}
    ports = identify_ports(spots, routes)
    port_set = set(ports)

    used_spots = set()
    for l in official_labels:
        lx, ly, name = l['x'], l['y'], l['img']
        closest_sno = None
        min_dist = 999999
        for sno, s in spots.items():
            if sno in port_set:
                continue
            dist = ((s['x'] - lx)**2 + (s['y'] - ly)**2)**0.5
            if dist < min_dist:
                min_dist = dist
                closest_sno = sno
        if closest_sno is not None and min_dist <= 40.0:
            labels[str(closest_sno)] = name
            used_spots.add(closest_sno)

    existing_labels = {}
    for candidate in [os.path.join(area_dir, 'cell_labels.json'),
                      os.path.join(public_dir, area_tag, 'cell_labels.json') if public_dir else None]:
        if candidate and os.path.exists(candidate):
            try:
                with open(candidate, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        for k, v in data.items():
                            existing_labels[int(k)] = str(v)
                if existing_labels:
                    break
            except Exception:
                pass

    coord_to_canon = {}
    for sno, s in spots.items():
        c = (s['x'], s['y'])
        if c not in coord_to_canon:
            coord_to_canon[c] = sno

    for sno, s in sorted(spots.items()):
        s_key = str(sno)
        if sno in port_set:
            if len(ports) == 1:
                labels[s_key] = '1'
            else:
                idx = ports.index(sno)
                labels[s_key] = str(idx + 1)
            continue

        if s_key in labels:
            continue
        canon_no = coord_to_canon.get((s['x'], s['y']), sno)
        if str(canon_no) in labels:
            labels[s_key] = labels[str(canon_no)]
        elif sno in existing_labels and existing_labels[sno] not in ('港', 'スタート', 'S'):
            labels[s_key] = existing_labels[sno]
        elif canon_no in existing_labels and existing_labels[canon_no] not in ('港', 'スタート', 'S'):
            labels[s_key] = existing_labels[canon_no]
        else:
            labels[s_key] = alpha_fallback_label(canon_no)

    return labels, ports
def sync_unified_map_data(area_dir, area_tag, map_data, routes, labels, ports, public_dir, dist_client_dir):
    port_set = set(ports)
    slim_spots = []
    for s in map_data["spots"].values():
        spot_dict = {
            "no": s["no"],
            "x": s["x"],
            "y": s["y"]
        }
        if s["no"] in port_set:
            spot_dict["isPort"] = True
        if "line" in s and s["line"]:
            spot_dict["line"] = s["line"]
        slim_spots.append(spot_dict)

    unified_data = {
        "ports": ports,
        "spots": slim_spots,
        "labels": labels,
        "routes": routes
    }

    target_dirs = [area_dir]
    if public_dir:
        target_dirs.append(os.path.join(public_dir, area_tag))
    if dist_client_dir and os.path.exists(dist_client_dir):
        target_dirs.append(os.path.join(dist_client_dir, area_tag))

    for td in target_dirs:
        os.makedirs(td, exist_ok=True)
        with open(os.path.join(td, "data.json"), "w", encoding="utf-8") as f:
            json.dump(unified_data, f, indent=2, ensure_ascii=False)

def clean_legacy_files(area_tag, public_dir, dist_client_dir):
    parts = area_tag.split('-')
    suffix = f"{int(parts[1]):02d}"
    legacy_names = [
        f"{area_tag}_dark.png",
        f"{area_tag}_light.png",
        f"{area_tag}_orig.png",
        f"{area_tag}_unred.png",
        f"{suffix}_info.json",
        f"{suffix}_image.json",
        "cell_labels.json",
        "routes.json"
    ]
    for base in [public_dir, dist_client_dir]:
        if not base or not os.path.exists(base):
            continue
        d = os.path.join(base, area_tag)
        if not os.path.isdir(d):
            continue
        for name in legacy_names:
            p = os.path.join(d, name)
            if os.path.exists(p):
                os.remove(p)

def generate_maps_metadata(map_source_dir, public_dir, dist_client_dir):
    metadata_list = []
    areas = sorted([
        d for d in os.listdir(map_source_dir)
        if os.path.isdir(os.path.join(map_source_dir, d)) and re.match(r"^\d+-\d+$", d)
    ], key=lambda x: [int(v) for v in x.split("-")])

    for area in areas:
        area_dir = os.path.join(map_source_dir, area)
        parts = [int(v) for v in area.split("-")]
        area_id = parts[0]
        info_no = parts[1]
        suffix = f"{info_no:02d}"

        entry = {
            "key": area,
            "areaId": area_id,
            "infoNo": info_no,
            "suffix": suffix,
            "hasLabels": True,
            "origUrl": f"/src/assets/map/{area}/{area}_orig.png",
            "mapUrl": f"/battle-maps/{area}/{area}_map.png",
            "dataUrl": f"/battle-maps/{area}/data.json"
        }
        metadata_list.append(entry)

    target_dirs = []
    if public_dir:
        target_dirs.append(public_dir)
    if dist_client_dir and os.path.exists(dist_client_dir):
        target_dirs.append(dist_client_dir)

    for td in target_dirs:
        os.makedirs(td, exist_ok=True)
        with open(os.path.join(td, "maps_metadata.json"), "w", encoding="utf-8") as f:
            json.dump(metadata_list, f, indent=2, ensure_ascii=False)

    print(f"Generated maps_metadata.json with {len(metadata_list)} map entries.")

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
    map_source_dir = os.path.join(repo_root, "packages", "FUSOU-WEB", "src", "assets", "map")
    output_dir = None
    public_dir = os.path.join(repo_root, "packages", "FUSOU-WEB", "public", "battle-maps")
    dist_client_dir = os.path.join(repo_root, "packages", "FUSOU-WEB", "dist", "client", "battle-maps")

    areas = sorted([
        d for d in os.listdir(map_source_dir)
        if os.path.isdir(os.path.join(map_source_dir, d)) and re.match(r"^\d+-\d+$", d)
    ], key=lambda x: [int(v) for v in x.split("-")])

    print(f"Starting complete reprocessing of {len(areas)} sea areas...")
    total_routes_all = 0

    for area in areas:
        area_dir = os.path.join(map_source_dir, area)
        print(f"Processing {area}...")
        map_data = load_merged_map_data(area_dir)
        image_sheets = load_all_image_sheets(area_dir)
        map_region = find_base_map_image(area_dir, area, image_sheets)

        process_map_images(area_dir, area, map_region, map_data["spots"], output_dir, public_dir, dist_client_dir)
        routes = process_map_routes(area_dir, area, map_data["spots"], image_sheets, public_dir, dist_client_dir)
        labels, ports = process_map_labels(area_dir, area, map_data["spots"], map_data["official_labels"], routes, public_dir, dist_client_dir)
        sync_unified_map_data(area_dir, area, map_data, routes, labels, ports, public_dir, dist_client_dir)
        clean_legacy_files(area, public_dir, dist_client_dir)
        total_routes_all += len(routes)
        print(f"  {area}: {len(map_data['spots'])} spots, {len(routes)} routes, {len(labels)} labels generated.")

    generate_maps_metadata(map_source_dir, public_dir, dist_client_dir)
    print(f"\nFinished! Processed {len(areas)} maps and extracted {total_routes_all} routes total.")