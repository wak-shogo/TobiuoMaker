# -*- coding: utf-8 -*-
"""
TobiuoMaker Aero & Tail Optimization Engine (Python版)
"""

import math

def calculate_optimal_glider(params: dict) -> dict:
    sinker_type = params.get("sinker_type", "bullet")
    weight_g = float(params.get("weight_g", 14.0))
    diameter_mm = float(params.get("diameter_mm", 10.0))
    length_mm = float(params.get("length_mm", 22.0))
    aoa_deg = float(params.get("angle_of_attack_deg", 3.0))
    glide_mode = params.get("glide_mode", "air")
    flight_speed = float(params.get("flight_speed_ms", 18.0))

    rho = 1025.0 if glide_mode == "water" else 1.225
    g_acc = 9.80665
    lead_density = 11.34

    effective_mass_g = weight_g
    speed = flight_speed
    if glide_mode == "water":
        buoyancy_factor = 1.0 - (1.025 / lead_density)
        effective_mass_g = weight_g * buoyancy_factor
        speed = min(speed, 2.5)

    weight_n = (effective_mass_g / 1000.0) * g_acc

    cd_body_map = {
        "bullet": 0.28,
        "king_tenbin": 0.36,
        "drop": 0.44,
        "cylinder": 0.72,
        "custom": 0.35
    }
    cd_body = cd_body_map.get(sinker_type, 0.35)
    body_radius_m = (diameter_mm / 2.0) / 1000.0
    body_frontal_area_m2 = math.pi * (body_radius_m ** 2)

    alpha_0_deg = -3.5
    cl_slope = 0.095
    stall_angle_deg = 13.5
    is_stalled = (aoa_deg > stall_angle_deg)

    if aoa_deg <= stall_angle_deg:
        cl_wing = cl_slope * (aoa_deg - alpha_0_deg)
    else:
        cl_peak = cl_slope * (stall_angle_deg - alpha_0_deg)
        excess = aoa_deg - stall_angle_deg
        cl_wing = max(0.2, cl_peak * math.exp(-0.16 * excess))

    cl_wing = max(0.05, cl_wing)
    target_ar = 3.6
    oswald_e = 0.85

    target_lift_ratio = 0.36 if glide_mode == "air" else 0.50
    target_lift_n = weight_n * target_lift_ratio
    dyn_pressure = 0.5 * rho * (speed ** 2)

    needed_area_m2 = target_lift_n / (dyn_pressure * cl_wing)
    needed_area_mm2 = max(700.0, min(5000.0, needed_area_m2 * 1e6))

    opt_span_mm = math.sqrt(needed_area_mm2 * target_ar)
    opt_mean_chord_mm = opt_span_mm / target_ar

    span_mm = float(params["span_mm"]) if params.get("span_mm") else opt_span_mm
    mean_chord_mm = float(params["mean_chord_mm"]) if params.get("mean_chord_mm") else opt_mean_chord_mm

    root_chord_mm = mean_chord_mm * 1.12
    tip_chord_mm = mean_chord_mm * 0.88
    actual_area_mm2 = span_mm * mean_chord_mm
    actual_area_m2 = actual_area_mm2 * 1e-6
    actual_ar = (span_mm ** 2) / actual_area_mm2

    # テール自動伸縮
    weight_factor = min(1.5, max(0.6, weight_g / 20.0))
    opt_tail_length = (mean_chord_mm * 2.2 * math.sqrt(weight_factor)) + (length_mm * 0.5) + 10.0
    if sinker_type == "king_tenbin":
        opt_tail_length = max(opt_tail_length, 65.0)
    else:
        opt_tail_length = max(35.0, min(120.0, opt_tail_length))

    tail_length_mm = float(params["tail_length_mm"]) if params.get("tail_length_mm") else opt_tail_length

    # 水平尾翼 (Horizontal Stabilizer) 連動
    target_vh = 0.44
    horiz_area_mm2 = max(120.0, (target_vh * actual_area_mm2 * mean_chord_mm) / max(15.0, tail_length_mm))
    horiz_ar = 3.2
    horiz_span_mm = math.sqrt(horiz_area_mm2 * horiz_ar)
    horiz_chord_mm = horiz_area_mm2 / horiz_span_mm

    # 垂直尾翼 (Vertical Stabilizer) 連動
    target_vv = 0.040
    vert_area_mm2 = max(80.0, (target_vv * actual_area_mm2 * span_mm) / max(15.0, tail_length_mm))
    vert_ar = 1.35
    vert_height_mm = math.sqrt(vert_area_mm2 * vert_ar)
    vert_chord_mm = vert_area_mm2 / vert_height_mm

    # 静的縦安定余裕度
    x_cg = mean_chord_mm * 0.20
    x_ac = mean_chord_mm * 0.25
    downwash_factor = 1.0 - (2.0 * cl_slope * 57.3) / (math.pi * actual_ar)
    tail_lift_ratio = (0.075 / cl_slope) * max(0.4, downwash_factor) * (horiz_area_mm2 / actual_area_mm2)
    x_np = x_ac + (tail_length_mm * tail_lift_ratio)
    static_margin = ((x_np - x_cg) / mean_chord_mm) * 100.0

    cd_induced = (cl_wing ** 2) / (math.pi * oswald_e * actual_ar)
    cd_profile_wing = 0.022 + (0.16 if is_stalled else 0.0)
    cd_tails = (0.015 * horiz_area_mm2 + 0.015 * vert_area_mm2) / actual_area_mm2
    cd_body_ref = cd_body * (body_frontal_area_m2 / actual_area_m2)
    total_cd = cd_profile_wing + cd_induced + cd_tails + cd_body_ref

    lift_n = dyn_pressure * actual_area_m2 * cl_wing
    drag_n = dyn_pressure * actual_area_m2 * total_cd
    lift_g = (lift_n / g_acc) * 1000.0
    drag_g = (drag_n / g_acc) * 1000.0
    lift_drag_ratio = lift_n / max(0.001, drag_n)
    glide_angle_deg = math.degrees(math.atan2(drag_n, max(0.001, lift_n)))

    distance_factor = 0.82 if is_stalled else (1.0 + min(0.38, (lift_drag_ratio / 6.0) * 0.30) if 2.0 <= aoa_deg <= 5.0 else 1.08)
    estimated_distance_m = 75.0 * distance_factor

    return {
        "sinker_type": sinker_type,
        "weight_g": weight_g,
        "diameter_mm": diameter_mm,
        "length_mm": length_mm,
        "angle_of_attack_deg": aoa_deg,
        "glide_mode": glide_mode,
        "flight_speed_ms": speed,
        "span_mm": round(span_mm, 1),
        "root_chord_mm": round(root_chord_mm, 1),
        "tip_chord_mm": round(tip_chord_mm, 1),
        "mean_chord_mm": round(mean_chord_mm, 1),
        "area_cm2": round(actual_area_mm2 / 100.0, 1),
        "aspect_ratio": round(actual_ar, 2),
        "sweep_back_deg": 8.0,
        "dihedral_deg": -3.5,
        "wing_thickness_mm": 2.0,
        "tail_length_mm": round(tail_length_mm, 1),
        "horiz_span_mm": round(horiz_span_mm, 1),
        "horiz_chord_mm": round(horiz_chord_mm, 1),
        "horiz_trim_deg": -2.0,
        "fin_height_mm": round(vert_height_mm, 1),
        "fin_chord_mm": round(vert_chord_mm, 1),
        "static_margin_pct": round(static_margin, 1),
        "cl": round(cl_wing, 3),
        "cd": round(total_cd, 3),
        "lift_g": round(lift_g, 1),
        "drag_g": round(drag_g, 1),
        "lift_drag_ratio": round(lift_drag_ratio, 2),
        "glide_angle_deg": round(glide_angle_deg, 1),
        "estimated_distance_m": round(estimated_distance_m, 1),
        "is_stalled": is_stalled
    }
