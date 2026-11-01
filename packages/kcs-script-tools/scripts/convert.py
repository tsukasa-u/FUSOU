import os
import json
import re
import cv2
import numpy as np

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

def clean_generated_map_images(map_source_dir, public_dir, dist_client_dir):
    removed = 0

    for area_tag in os.listdir(map_source_dir):
        area_dir = os.path.join(map_source_dir, area_tag)
        if not os.path.isdir(area_dir) or not re.fullmatch(r"\d+-\d+", area_tag):
            continue
        original_path = os.path.join(area_dir, f"{area_tag}_orig.png")
        if os.path.isfile(original_path):
            os.remove(original_path)
            removed += 1

    for base in [public_dir, dist_client_dir]:
        if not base or not os.path.isdir(base):
            continue
        for area_tag in os.listdir(base):
            area_dir = os.path.join(base, area_tag)
            if not os.path.isdir(area_dir) or not re.fullmatch(r"\d+-\d+", area_tag):
                continue
            image_path = os.path.join(area_dir, f"{area_tag}_map.png")
            if os.path.isfile(image_path):
                os.remove(image_path)
                removed += 1

    return removed

def clean_legacy_files(area_tag, public_dir, dist_client_dir):
    parts = area_tag.split('-')
    suffix = f"{int(parts[1]):02d}"
    legacy_names = [
        f"{area_tag}_dark.png",
        f"{area_tag}_light.png",
        f"{area_tag}_orig.png",
        f"{area_tag}_unred.png",
        f"{area_tag}_map.png",
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
        parts = [int(v) for v in area.split("-")]
        area_id = parts[0]
        info_no = parts[1]
        suffix = f"{info_no:02d}"

        entry = {
            "key": area,
            "areaId": area_id,
            "infoNo": info_no,
            "suffix": suffix,
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

def generate_cell_labels_bundle(map_source_dir, public_dir, dist_client_dir):
    areas = sorted([
        d for d in os.listdir(map_source_dir)
        if os.path.isdir(os.path.join(map_source_dir, d)) and re.fullmatch(r"\d+-\d+", d)
    ], key=lambda x: [int(v) for v in x.split("-")])

    bundle = {}
    for area in areas:
        data_path = os.path.join(map_source_dir, area, "data.json")
        with open(data_path, "r", encoding="utf-8") as f:
            map_data = json.load(f)

        labels = map_data.get("labels")
        if not isinstance(labels, dict) or not labels:
            raise ValueError(f"{data_path} has no generated cell labels")

        bundle[area] = {"labels": labels}

    target_dirs = []
    if public_dir:
        target_dirs.append(public_dir)
    if dist_client_dir and os.path.exists(dist_client_dir):
        target_dirs.append(dist_client_dir)

    for target_dir in target_dirs:
        os.makedirs(target_dir, exist_ok=True)
        with open(os.path.join(target_dir, "cell_labels.json"), "w", encoding="utf-8") as f:
            json.dump(bundle, f, indent=2, ensure_ascii=False)

    print(f"Generated cell_labels.json with {len(bundle)} map entries.")

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
    map_source_dir = os.path.join(repo_root, "packages", "kcs-script-tools", "output", "map-resources")
    public_dir = os.path.join(repo_root, "packages", "FUSOU-WEB", "public", "battle-maps")
    dist_client_dir = os.path.join(repo_root, "packages", "FUSOU-WEB", "dist", "client", "battle-maps")

    areas = sorted([
        d for d in os.listdir(map_source_dir)
        if os.path.isdir(os.path.join(map_source_dir, d)) and re.match(r"^\d+-\d+$", d)
    ], key=lambda x: [int(v) for v in x.split("-")])

    removed_images = clean_generated_map_images(map_source_dir, public_dir, dist_client_dir)
    print(f"Removed {removed_images} generated map images.")
    print(f"Starting map data regeneration for {len(areas)} sea areas...")
    total_routes_all = 0

    for area in areas:
        area_dir = os.path.join(map_source_dir, area)
        print(f"Processing {area}...")
        map_data = load_merged_map_data(area_dir)
        image_sheets = load_all_image_sheets(area_dir)

        routes = process_map_routes(area_dir, area, map_data["spots"], image_sheets, public_dir, dist_client_dir)
        labels, ports = process_map_labels(area_dir, area, map_data["spots"], map_data["official_labels"], routes, public_dir, dist_client_dir)
        sync_unified_map_data(area_dir, area, map_data, routes, labels, ports, public_dir, dist_client_dir)
        clean_legacy_files(area, public_dir, dist_client_dir)
        total_routes_all += len(routes)
        print(f"  {area}: {len(map_data['spots'])} spots, {len(routes)} routes, {len(labels)} labels generated.")

    generate_maps_metadata(map_source_dir, public_dir, dist_client_dir)
    generate_cell_labels_bundle(map_source_dir, public_dir, dist_client_dir)
    print(f"\nFinished! Processed {len(areas)} maps and extracted {total_routes_all} routes total.")