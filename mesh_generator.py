# -*- coding: utf-8 -*-
"""
TobiuoMaker Parametric 3D Mesh & STL Generator (Python版)
"""

import math
import struct
import numpy as np

def generate_jedelsky_airfoil(chord: float, thickness: float = 2.0, num_points: int = 18):
    s = np.linspace(0.0, 1.0, num_points)
    camber_max = 0.065 * chord
    camber = 4.0 * camber_max * s * (1.0 - s) * (1.0 - 0.2 * s)
    t_dist = np.maximum(1.0, thickness * (0.85 * np.sqrt(s + 1e-4) * (1.0 - 0.5 * s) + 0.15 * (1.0 - s)))
    
    y_lower = s * chord
    z_lower = camber - 0.5 * t_dist
    y_upper = s * chord
    z_upper = camber + 0.5 * t_dist
    
    y_profile = np.concatenate([y_lower, y_upper[::-1]])
    z_profile = np.concatenate([z_lower, z_upper[::-1]])
    return y_profile, z_profile

def build_full_glider_mesh(params: dict) -> np.ndarray:
    triangles = []
    
    sinker_type = params.get("sinker_type", "bullet")
    dia = float(params.get("diameter_mm", 10.0))
    length = float(params.get("length_mm", 22.0))
    aoa_deg = float(params.get("angle_of_attack_deg", 3.0))
    aoa_rad = math.radians(aoa_deg)
    
    span = float(params.get("span_mm", 55.0))
    root_chord = float(params.get("root_chord_mm", 18.0))
    tip_chord = float(params.get("tip_chord_mm", 14.0))
    sweep_deg = float(params.get("sweep_back_deg", 8.0))
    dihedral_deg = float(params.get("dihedral_deg", -3.5))
    wing_thick = float(params.get("wing_thickness_mm", 2.0))
    
    tail_length = float(params.get("tail_length_mm", 50.0))
    horiz_span = float(params.get("horiz_span_mm", 26.0))
    horiz_chord = float(params.get("horiz_chord_mm", 10.0))
    horiz_trim_rad = math.radians(float(params.get("horiz_trim_deg", -2.0)))
    
    fin_height = float(params.get("fin_height_mm", 14.0))
    fin_chord = float(params.get("fin_chord_mm", 10.0))
    
    r_in = (dia / 2.0) + 0.28
    clamp_wall = 1.7
    r_out = r_in + clamp_wall
    clamp_len = min(length * 0.90, max(14.0, length * 0.75))
    z_center = -r_out * 0.35
    
    # 1. 主翼 (Main Wing)
    num_span_sections = 14
    num_airfoil_pts = 18
    semi_span = span / 2.0
    half_clamp_w = max(r_out * 0.85, 4.5)
    
    def get_wing_section(x_pos):
        eta = max(0.0, min(1.0, (abs(x_pos) - half_clamp_w) / max(1.0, semi_span - half_clamp_w)))
        local_chord = root_chord * (1.0 - eta) + tip_chord * eta
        fillet_factor = 1.0 + 0.45 * ((1.0 - (eta / 0.25)) ** 2) if eta < 0.25 else 1.0
        local_thick = wing_thick * fillet_factor * (1.0 - 0.2 * eta)
        
        z_sweep = abs(x_pos) * math.tan(math.radians(sweep_deg))
        y_dihedral = abs(x_pos) * math.tan(math.radians(dihedral_deg))
        
        y_prof, z_prof = generate_jedelsky_airfoil(local_chord, local_thick, num_airfoil_pts)
        cos_a = math.cos(aoa_rad)
        sin_a = math.sin(aoa_rad)
        
        z_rot = y_prof * cos_a - z_prof * sin_a + z_sweep
        y_rot = y_prof * sin_a + z_prof * cos_a + y_dihedral
        x_pts = np.full_like(z_rot, x_pos)
        return np.column_stack([x_pts, y_rot, z_rot])

    x_stations = np.linspace(half_clamp_w, semi_span, num_span_sections)
    sec_right = [get_wing_section(x) for x in x_stations]
    sec_left = [get_wing_section(-x) for x in x_stations]

    def loft_sections(sec_list, flip=False):
        n_rings = len(sec_list)
        n_pts = len(sec_list[0])
        for i in range(n_rings - 1):
            r1 = sec_list[i]
            r2 = sec_list[i+1]
            for j in range(n_pts):
                jn = (j + 1) % n_pts
                p1, p2, p3, p4 = r1[j], r1[jn], r2[jn], r2[j]
                if not flip:
                    triangles.append([p1, p2, p3])
                    triangles.append([p1, p3, p4])
                else:
                    triangles.append([p1, p3, p2])
                    triangles.append([p1, p4, p3])

    loft_sections(sec_right, False)
    loft_sections(sec_left, True)

    def cap_section(sec, flip=False):
        c = np.mean(sec, axis=0)
        n = len(sec)
        for j in range(n):
            jn = (j + 1) % n
            if not flip:
                triangles.append([c, sec[j], sec[jn]])
            else:
                triangles.append([c, sec[jn], sec[j]])

    cap_section(sec_right[-1], False)
    cap_section(sec_left[-1], True)

    # 翼中央ルート接続
    r_root = sec_right[0]
    l_root = sec_left[0]
    for j in range(len(r_root)):
        jn = (j + 1) % len(r_root)
        triangles.append([r_root[j], l_root[jn], r_root[jn]])
        triangles.append([r_root[j], l_root[j], l_root[jn]])

    # 2. オモリ保持クランプ
    num_circ = 16
    num_len = 8
    phi_start = math.radians(45.0)
    phi_end = math.radians(315.0)
    z_clamp_start = -clamp_len * 0.45
    z_clamp_end = clamp_len * 0.55

    outer_rings = []
    inner_rings = []
    for i in range(num_len):
        z_c = z_clamp_start + (z_clamp_end - z_clamp_start) * (i / (num_len - 1))
        taper = 1.0
        if sinker_type == "bullet" and z_c < 0:
            taper = max(0.60, 1.0 + 0.40 * (z_c / abs(z_clamp_start)))
        elif sinker_type == "drop" and z_c < 0:
            taper = max(0.55, 1.0 + 0.45 * (z_c / abs(z_clamp_start)))

        rib_inner = 0.5 if (i == 0 or i == num_len - 1) else 0.0
        r_i = max(2.0, (r_in * taper) - rib_inner)
        r_o = r_out * taper

        in_pts = []
        out_pts = []
        for j in range(num_circ):
            phi = phi_start + (phi_end - phi_start) * (j / (num_circ - 1))
            in_pts.append([r_i * math.sin(phi), z_center - r_i * math.cos(phi), z_c])
            out_pts.append([r_o * math.sin(phi), z_center - r_o * math.cos(phi), z_c])
        inner_rings.append(in_pts)
        outer_rings.append(out_pts)

    for i in range(num_len - 1):
        for j in range(num_circ - 1):
            p1, p2, p3, p4 = outer_rings[i][j], outer_rings[i][j+1], outer_rings[i+1][j+1], outer_rings[i+1][j]
            triangles.append([p1, p3, p2]); triangles.append([p1, p4, p3])
            p1, p2, p3, p4 = inner_rings[i][j], inner_rings[i][j+1], inner_rings[i+1][j+1], inner_rings[i+1][j]
            triangles.append([p1, p2, p3]); triangles.append([p1, p3, p4])

    for idx in [0, num_len - 1]:
        flip = (idx == num_len - 1)
        for j in range(num_circ - 1):
            p1, p2, p3, p4 = outer_rings[idx][j], outer_rings[idx][j+1], inner_rings[idx][j+1], inner_rings[idx][j]
            if not flip:
                triangles.append([p1, p2, p3]); triangles.append([p1, p3, p4])
            else:
                triangles.append([p1, p3, p2]); triangles.append([p1, p4, p3])

    for side in [0, num_circ - 1]:
        flip = (side == 0)
        for i in range(num_len - 1):
            p1, p2, p3, p4 = outer_rings[i][side], outer_rings[i+1][side], inner_rings[i+1][side], inner_rings[i][side]
            if not flip:
                triangles.append([p1, p2, p3]); triangles.append([p1, p3, p4])
            else:
                triangles.append([p1, p3, p2]); triangles.append([p1, p4, p3])

    # 3. テールブーム (Telescoping Tail Boom)
    boom_z_start = z_clamp_end
    boom_z_end = z_clamp_end + tail_length
    boom_w = 2.4
    boom_h = 3.2
    boom_y_center = z_center + (r_out * 0.4)

    b1 = [-boom_w/2, boom_y_center - boom_h/2, boom_z_start]
    b2 = [ boom_w/2, boom_y_center - boom_h/2, boom_z_start]
    b3 = [ boom_w/2, boom_y_center + boom_h/2, boom_z_start]
    b4 = [-boom_w/2, boom_y_center + boom_h/2, boom_z_start]

    b5 = [-boom_w/2, boom_y_center - boom_h/2, boom_z_end]
    b6 = [ boom_w/2, boom_y_center - boom_h/2, boom_z_end]
    b7 = [ boom_w/2, boom_y_center + boom_h/2, boom_z_end]
    b8 = [-boom_w/2, boom_y_center + boom_h/2, boom_z_end]

    triangles.append([b4, b3, b7]); triangles.append([b4, b7, b8])
    triangles.append([b1, b6, b2]); triangles.append([b1, b5, b6])
    triangles.append([b1, b8, b5]); triangles.append([b1, b4, b8])
    triangles.append([b2, b6, b7]); triangles.append([b2, b7, b3])
    triangles.append([b5, b7, b6]); triangles.append([b5, b8, b7])

    # 4. 水平尾翼 (Horizontal Stabilizer)
    h_z_lead = boom_z_end - horiz_chord
    h_thick = 1.6
    h_semi_span = horiz_span / 2.0
    h_cos = math.cos(horiz_trim_rad)
    h_sin = math.sin(horiz_trim_rad)

    def get_h_verts(x_h):
        z1 = h_z_lead
        y1 = boom_y_center
        z2 = h_z_lead + horiz_chord * h_cos
        y2 = boom_y_center + horiz_chord * h_sin
        return {
            "fl": [x_h, y1 - h_thick/2, z1], "fu": [x_h, y1 + h_thick/2, z1],
            "rl": [x_h, y2 - h_thick/2, z2], "ru": [x_h, y2 + h_thick/2, z2]
        }

    h_root = get_h_verts(boom_w/2)
    h_tip_r = get_h_verts(h_semi_span)
    h_root_l = get_h_verts(-boom_w/2)
    h_tip_l = get_h_verts(-h_semi_span)

    # 右水平尾翼
    triangles.append([h_root["fu"], h_tip_r["fu"], h_tip_r["ru"]]); triangles.append([h_root["fu"], h_tip_r["ru"], h_root["ru"]])
    triangles.append([h_root["fl"], h_tip_r["rl"], h_tip_r["fl"]]); triangles.append([h_root["fl"], h_root["rl"], h_tip_r["rl"]])
    triangles.append([h_root["fu"], h_tip_r["fl"], h_tip_r["fu"]]); triangles.append([h_root["fu"], h_root["fl"], h_tip_r["fl"]])
    triangles.append([h_root["ru"], h_tip_r["ru"], h_tip_r["rl"]]); triangles.append([h_root["ru"], h_tip_r["rl"], h_root["rl"]])
    triangles.append([h_tip_r["fu"], h_tip_r["fl"], h_tip_r["ru"]]); triangles.append([h_tip_r["fl"], h_tip_r["rl"], h_tip_r["ru"]])

    # 左水平尾翼
    triangles.append([h_root_l["fu"], h_tip_l["ru"], h_tip_l["fu"]]); triangles.append([h_root_l["fu"], h_root_l["ru"], h_tip_l["ru"]])
    triangles.append([h_root_l["fl"], h_tip_l["fl"], h_tip_l["rl"]]); triangles.append([h_root_l["fl"], h_tip_l["rl"], h_root_l["rl"]])
    triangles.append([h_root_l["fu"], h_tip_l["fu"], h_tip_l["fl"]]); triangles.append([h_root_l["fu"], h_tip_l["fl"], h_root_l["fl"]])
    triangles.append([h_root_l["ru"], h_tip_l["rl"], h_tip_l["ru"]]); triangles.append([h_root_l["ru"], h_root_l["rl"], h_tip_l["rl"]])
    triangles.append([h_tip_l["fu"], h_tip_l["ru"], h_tip_l["fl"]]); triangles.append([h_tip_l["fl"], h_tip_l["ru"], h_tip_l["rl"]])

    # 5. 垂直尾翼 (Vertical Stabilizer)
    v_thick = 1.6
    v_z_start = boom_z_end - fin_chord
    v_z_end = boom_z_end
    v_y_base = boom_y_center + boom_h/2
    v_y_top = v_y_base + fin_height
    v_sweep_z = fin_height * 0.28

    v1 = [-v_thick/2, v_y_base, v_z_start]
    v2 = [ v_thick/2, v_y_base, v_z_start]
    v3 = [ v_thick/2, v_y_base, v_z_end]
    v4 = [-v_thick/2, v_y_base, v_z_end]
    v5 = [-v_thick/2, v_y_top, v_z_start + v_sweep_z]
    v6 = [ v_thick/2, v_y_top, v_z_start + v_sweep_z]
    v7 = [ v_thick/2, v_y_top, v_z_end + v_sweep_z * 0.6]
    v8 = [-v_thick/2, v_y_top, v_z_end + v_sweep_z * 0.6]

    triangles.append([v2, v3, v7]); triangles.append([v2, v7, v6])
    triangles.append([v1, v8, v4]); triangles.append([v1, v5, v8])
    triangles.append([v2, v6, v5]); triangles.append([v2, v5, v1])
    triangles.append([v3, v4, v8]); triangles.append([v3, v8, v7])
    triangles.append([v5, v6, v7]); triangles.append([v5, v7, v8])

    return np.array(triangles, dtype=np.float32)

def export_stl_binary(triangles: np.ndarray, file_path: str, header_text: str = "TobiuoMakerGlider") -> int:
    n_tri = len(triangles)
    # STL標準座標系に変換 (X:スパン, Y:前後, Z:高さ)
    v0 = triangles[:, 0, [0, 2, 1]]
    v1 = triangles[:, 1, [0, 2, 1]]
    v2 = triangles[:, 2, [0, 2, 1]]
    
    normals = np.cross(v1 - v0, v2 - v0)
    norm_lens = np.linalg.norm(normals, axis=1, keepdims=True)
    norm_lens[norm_lens == 0] = 1.0
    normals = normals / norm_lens

    with open(file_path, "wb") as f:
        header = header_text.encode('ascii')[:80].ljust(80, b'\0')
        f.write(header)
        f.write(struct.pack("<I", n_tri))
        records = np.zeros(n_tri, dtype=np.dtype([
            ('normal', '<f4', (3,)),
            ('v1', '<f4', (3,)),
            ('v2', '<f4', (3,)),
            ('v3', '<f4', (3,)),
            ('attr', '<u2')
        ]))
        records['normal'] = normals
        records['v1'] = v0
        records['v2'] = v1
        records['v3'] = v2
        records['attr'] = 0
        records.tofile(f)
    return n_tri
