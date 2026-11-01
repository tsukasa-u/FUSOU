# -*- coding: utf-8 -*-
"""
KanColle Map Cell Label Extractor via High-Precision Template IoU
Strictly uses FUSOU-PROXY-DATA client assets.
Does not modify or save any map images.
Outputs cell_labels.json for each map and all_map_labels.json.
"""

import os
import json
import cv2
import numpy as np
import brotli

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
REPO_ROOT = os.path.abspath(os.path.join(PKG_DIR, '..', '..'))
PROXY_DATA_DIR = os.path.join(REPO_ROOT, 'packages', 'FUSOU-PROXY-DATA')
OUTPUT_DIR = os.path.join(PKG_DIR, 'output', 'map-resources')

def read_json_or_brotli(path):
    if not os.path.exists(path): return None
    with open(path, 'rb') as f: data = f.read()
    if data.startswith(b'{') or data.startswith(b'['):
        try: return json.loads(data.decode('utf-8'))
        except Exception: pass
    try:
        decomp = brotli.decompress(data)
        return json.loads(decomp.decode('utf-8'))
    except Exception: pass
    return None

def build_letter_templates():
    templates = {}

    # 1. 5-6 (H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z)
    for f_name in ['06_image18', '06_image20', '06_image36']:
        j_p = os.path.join(PROXY_DATA_DIR, '2026-05-29', 'kcs2', 'resources', 'map', '005', f_name + '.json')
        png_p = os.path.join(PROXY_DATA_DIR, '2026-05-29', 'kcs2', 'resources', 'map', '005', f_name + '.png')
        j_data = read_json_or_brotli(j_p)
        if not j_data or not os.path.exists(png_p): continue
        img = cv2.imread(png_p, cv2.IMREAD_UNCHANGED)
        if img is None: continue
        for k, v in j_data.get('frames', {}).items():
            letter = k.split('_')[-1]
            if len(letter) == 1 and 'A' <= letter <= 'Z':
                fr = v['frame']
                crop = img[fr['y']:fr['y']+fr['h'], fr['x']:fr['x']+fr['w'], 3]
                _, th = cv2.threshold(crop, 50, 255, cv2.THRESH_BINARY)
                templates[letter] = th

    # 2. 62-2 (E, F, G)
    j_p = os.path.join(PROXY_DATA_DIR, '2026-08-05', 'kcs2', 'resources', 'map', '062', '02_image15.json')
    png_p = os.path.join(PROXY_DATA_DIR, '2026-08-05', 'kcs2', 'resources', 'map', '062', '02_image15.png')
    j_data = read_json_or_brotli(j_p)
    if j_data and os.path.exists(png_p):
        img = cv2.imread(png_p, cv2.IMREAD_UNCHANGED)
        if img is not None:
            for k, v in j_data.get('frames', {}).items():
                letter = k.split('_')[-1]
                if len(letter) == 1 and 'A' <= letter <= 'Z' and letter not in templates:
                    fr = v['frame']
                    crop = img[fr['y']:fr['y']+fr['h'], fr['x']:fr['x']+fr['w'], 3]
                    _, th = cv2.threshold(crop, 50, 255, cv2.THRESH_BINARY)
                    templates[letter] = th

    # 3. 1-1 (A, B, C)
    p1 = os.path.join(PROXY_DATA_DIR, '2026-10-14', 'kcs2', 'resources', 'map', '001', '01_image.png')
    if os.path.exists(p1):
        img1 = cv2.imread(p1, cv2.IMREAD_UNCHANGED)
        if img1 is not None:
            crop1 = img1[0:720, 1205:1205+1200, 3]
            # Spot 1: A
            sub1 = crop1[328-35:328+35, 597-35:597+35]
            _, th1 = cv2.threshold(sub1, 50, 255, cv2.THRESH_BINARY)
            n, l_im = cv2.connectedComponents(th1)
            for i in range(1, n):
                if np.sum(l_im == i) == 129:
                    ys, xs = np.where(l_im == i)
                    templates['A'] = th1[ys.min():ys.max()+1, xs.min():xs.max()+1]
                    break
            # Spot 2: B
            sub2 = crop1[204-35:204+35, 840-35:840+35]
            _, th2 = cv2.threshold(sub2, 50, 255, cv2.THRESH_BINARY)
            n, l_im = cv2.connectedComponents(th2)
            for i in range(1, n):
                if np.sum(l_im == i) == 148:
                    ys, xs = np.where(l_im == i)
                    templates['B'] = th2[ys.min():ys.max()+1, xs.min():xs.max()+1]
                    break
            # Spot 3: C (broad window 486-20:486+60, 858-20:858+60)
            sub3 = crop1[486-20:486+60, 858-20:858+60]
            _, th3 = cv2.threshold(sub3, 50, 255, cv2.THRESH_BINARY)
            n, l_im = cv2.connectedComponents(th3)
            for i in range(1, n):
                if np.sum(l_im == i) == 146:
                    ys, xs = np.where(l_im == i)
                    templates['C'] = th3[ys.min():ys.max()+1, xs.min():xs.max()+1]
                    break

    # 4. 1-2 (D)
    p12 = os.path.join(PROXY_DATA_DIR, '2026-10-14', 'kcs2', 'resources', 'map', '001', '02_image.png')
    j12 = read_json_or_brotli(os.path.join(PROXY_DATA_DIR, '2026-10-14', 'kcs2', 'resources', 'map', '001', '02_image.json'))
    if os.path.exists(p12) and j12:
        img12 = cv2.imread(p12, cv2.IMREAD_UNCHANGED)
        pf12 = [v['frame'] for k, v in j12['frames'].items() if 'point' in k]
        if img12 is not None and pf12:
            crop12 = img12[pf12[0]['y']:pf12[0]['y']+pf12[0]['h'], pf12[0]['x']:pf12[0]['x']+pf12[0]['w'], 3]
            sub_d = crop12[171-35:171+35, 809-35:809+35]
            _, th_d = cv2.threshold(sub_d, 50, 255, cv2.THRESH_BINARY)
            n, l_im = cv2.connectedComponents(th_d)
            for i in range(1, n):
                if np.sum(l_im == i) == 156:
                    ys, xs = np.where(l_im == i)
                    templates['D'] = th_d[ys.min():ys.max()+1, xs.min():xs.max()+1]
                    break

    return templates

def compute_best_iou(comp, tmpl):
    c_h, c_w = comp.shape[:2]
    t_h, t_w = tmpl.shape[:2]
    if abs(c_h - t_h) > 3 or abs(c_w - t_w) > 4:
        return 0.0
    best_iou = 0.0
    b_comp = comp > 0
    b_tmpl = tmpl > 0
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            y1_c, y2_c = max(0, -dy), min(c_h, t_h - dy)
            x1_c, x2_c = max(0, -dx), min(c_w, t_w - dx)
            y1_t, y2_t = max(0, dy), min(t_h, c_h + dy)
            x1_t, x2_t = max(0, dx), min(t_w, c_w + dx)
            if y2_c <= y1_c or x2_c <= x1_c or y2_t <= y1_t or x2_t <= x1_t:
                continue
            inter = np.sum(b_comp[y1_c:y2_c, x1_c:x2_c] & b_tmpl[y1_t:y2_t, x1_t:x2_t])
            union = np.sum(b_comp) + np.sum(b_tmpl) - inter
            iou = inter / union if union > 0 else 0.0
            if iou > best_iou:
                best_iou = iou
    return best_iou

def match_letter_at_spot(point_crop, sx, sy, templates):
    h_c, w_c = point_crop.shape[:2]
    # Optimal window centered slightly down-right of spot
    y1, y2 = max(0, sy - 35), min(h_c, sy + 60)
    x1, x2 = max(0, sx - 35), min(w_c, sx + 60)

    sub = point_crop[y1:y2, x1:x2]
    if sub.shape[0] < 10 or sub.shape[1] < 10:
        return None, 0.0

    _, th = cv2.threshold(sub, 50, 255, cv2.THRESH_BINARY)
    n, l_im = cv2.connectedComponents(th)

    best_char = None
    best_score = 0.0

    for i in range(1, n):
        area = np.sum(l_im == i)
        ys, xs = np.where(l_im == i)
        h, w = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1

        # Letter bounding box filters
        if not (13 <= h <= 21 and 4 <= w <= 22 and 60 <= area <= 260):
            continue

        comp_img = th[ys.min():ys.max()+1, xs.min():xs.max()+1]

        for char, tmpl in templates.items():
            score = compute_best_iou(comp_img, tmpl)
            if score > best_score:
                best_score = score
                best_char = char

    return best_char, best_score

def extract_all_map_labels():
    print('[extract-labels] Building authoritative A-Z templates from Proxy data...')
    templates = build_letter_templates()
    print(f'[extract-labels] Collected {len(templates)} / 26 letter templates: {sorted(templates.keys())}')

    dates = sorted([d for d in os.listdir(PROXY_DATA_DIR) if len(d) == 10 and d.count('-') == 2])

    all_maps = {}
    for d in dates:
        map_dir = os.path.join(PROXY_DATA_DIR, d, 'kcs2', 'resources', 'map')
        if not os.path.exists(map_dir): continue
        for area in os.listdir(map_dir):
            a_dir = os.path.join(map_dir, area)
            if not os.path.isdir(a_dir): continue
            try: a_num = int(area)
            except ValueError: continue
            for f in os.listdir(a_dir):
                if f.endswith('.json') and 'info' in f:
                    base = f.split('_')[0]
                    try: m_num = int(base)
                    except ValueError: continue
                    mapKey = f'{a_num}-{m_num}'
                    if mapKey not in all_maps: all_maps[mapKey] = []
                    all_maps[mapKey].append((d, os.path.join(a_dir, f)))

    print(f'[extract-labels] Found {len(all_maps)} sea areas across Proxy history.')

    results = {}
    total_spots_all = 0
    total_ocr_matched = 0
    total_official_matched = 0
    total_ports = 0

    for mapKey in sorted(all_maps.keys(), key=lambda x: [int(v) for v in x.split('-')]):
        a_num, m_num = mapKey.split('-')
        a_pad = f'{int(a_num):03d}'
        no_pad = f'{int(m_num):02d}'

        merged_spots = {}
        official_labels = []
        for d, f_path in all_maps[mapKey]:
            info_data = read_json_or_brotli(f_path)
            if not info_data: continue
            arr = info_data.get('spots')
            if arr:
                for s in arr: merged_spots[s['no']] = s
            l_arr = info_data.get('labels')
            if l_arr:
                official_labels.extend(l_arr)

        point_crop = None
        for d in reversed(dates):
            img_p = os.path.join(PROXY_DATA_DIR, d, 'kcs2', 'resources', 'map', a_pad, f'{no_pad}_image.png')
            json_p = os.path.join(PROXY_DATA_DIR, d, 'kcs2', 'resources', 'map', a_pad, f'{no_pad}_image.json')
            if os.path.exists(img_p) and os.path.exists(json_p):
                img_data = read_json_or_brotli(json_p)
                if not img_data: continue
                pf_list = [v['frame'] for k, v in img_data.get('frames', {}).items() if 'point' in k]
                if pf_list:
                    img = cv2.imread(img_p, cv2.IMREAD_UNCHANGED)
                    if img is not None:
                        pf = pf_list[0]
                        point_crop = img[pf['y']:pf['y']+pf['h'], pf['x']:pf['x']+pf['w'], 3]
                        break

        labels = {}
        used_sno = set()
        for l in official_labels:
            lx, ly, name = l['x'], l['y'], l['img']
            closest_sno = None
            min_dist = 999999
            for sno, s in merged_spots.items():
                if sno == 0: continue
                dist = ((s['x'] - lx)**2 + (s['y'] - ly)**2)**0.5
                if dist < min_dist:
                    min_dist = dist
                    closest_sno = sno
            if closest_sno is not None and min_dist <= 40.0:
                labels[str(closest_sno)] = name
                used_sno.add(closest_sno)
                total_official_matched += 1

        coord_to_canon = {}
        for sno, s in merged_spots.items():
            c = (s['x'], s['y'])
            if c not in coord_to_canon: coord_to_canon[c] = sno

        for sno, s in sorted(merged_spots.items()):
            s_key = str(sno)
            total_spots_all += 1
            if sno == 0 or 'line' not in s or not s.get('line'):
                labels[s_key] = '港'
                total_ports += 1
                continue
            if s_key in labels:
                continue

            canon_no = coord_to_canon.get((s['x'], s['y']), sno)
            if str(canon_no) in labels:
                labels[s_key] = labels[str(canon_no)]
                continue

            if point_crop is not None:
                char, score = match_letter_at_spot(point_crop, s['x'], s['y'], templates)
                if char and score >= 0.70:
                    labels[s_key] = char
                    total_ocr_matched += 1
                    continue

            labels[s_key] = ''

        results[mapKey] = labels

    print(f'[extract-labels] Summary:')
    print(f'  Total spots: {total_spots_all}')
    print(f'  Ports / Starts: {total_ports}')
    print(f'  Official JSON labels matched: {total_official_matched}')
    print(f'  Image OCR/IoU matched: {total_ocr_matched}')
    total_identified = total_ports + total_official_matched + total_ocr_matched
    print(f'  Overall label coverage: {total_identified} / {total_spots_all} ({total_identified / total_spots_all * 100:.1f}%)')

    out_all = os.path.join(PKG_DIR, 'output', 'all_map_labels.json')
    os.makedirs(os.path.dirname(out_all), exist_ok=True)
    with open(out_all, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f'[extract-labels] Saved all map labels to: {out_all}')

    for mapKey, lbls in results.items():
        map_out_dir = os.path.join(OUTPUT_DIR, mapKey)
        os.makedirs(map_out_dir, exist_ok=True)
        lbl_file = os.path.join(map_out_dir, 'cell_labels.json')
        with open(lbl_file, 'w', encoding='utf-8') as f:
            json.dump(lbls, f, indent=2, ensure_ascii=False)

if __name__ == '__main__':
    extract_all_map_labels()
