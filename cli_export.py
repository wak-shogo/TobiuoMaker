# -*- coding: utf-8 -*-
"""
TobiuoMaker CLI Export Tool
"""

import argparse
import os
import sys

from aero_optimizer import calculate_optimal_glider
from mesh_generator import build_full_glider_mesh, export_stl_binary

def main():
    parser = argparse.ArgumentParser(description="TobiuoMaker: 最適グライダー翼・テール・尾翼 STL自動出力ツール")
    parser.add_argument("--type", choices=["bullet", "king_tenbin", "drop", "cylinder", "custom"], default="bullet", help="オモリの種類")
    parser.add_argument("--weight", type=float, default=14.0, help="オモリの重量 (g)")
    parser.add_argument("--dia", type=float, default=10.0, help="オモリの直径 (mm)")
    parser.add_argument("--len", type=float, default=22.0, help="オモリの全長 (mm)")
    parser.add_argument("--aoa", type=float, default=3.0, help="迎角 (度)")
    parser.add_argument("--tail", type=float, default=None, help="テールブーム長 (mm, 指定なしで自動計算)")
    parser.add_argument("--output", "-o", type=str, default=None, help="出力STLファイルパス")

    args = parser.parse_args()

    params = {
        "sinker_type": args.type,
        "weight_g": args.weight,
        "diameter_mm": args.dia,
        "length_mm": args.len,
        "angle_of_attack_deg": args.aoa,
        "tail_length_mm": args.tail
    }

    aero = calculate_optimal_glider(params)
    print("=== 最適設計結果 ===")
    print(f"  主翼スパン: {aero['span_mm']} mm, 平均弦長: {aero['mean_chord_mm']} mm")
    print(f"  自動伸縮テール長: {aero['tail_length_mm']} mm")
    print(f"  水平尾翼: スパン {aero['horiz_span_mm']} mm × 弦長 {aero['horiz_chord_mm']} mm (トリム角: {aero['horiz_trim_deg']}°)")
    print(f"  垂直尾翼: 高さ {aero['fin_height_mm']} mm × 弦長 {aero['fin_chord_mm']} mm")
    print(f"  静的縦安定性 (Static Margin): {aero['static_margin_pct']}%")
    print(f"  揚抗比 (L/D): {aero['lift_drag_ratio']}, 推定飛距離: {aero['estimated_distance_m']} m")

    mesh = build_full_glider_mesh(aero)

    out_path = args.output or f"TobiuoWing_{args.type}_{int(args.weight)}g_Tail{int(aero['tail_length_mm'])}mm.stl"
    n_tri = export_stl_binary(mesh, out_path, header_text=f"Tobiuo_{args.type}_{int(args.weight)}g")
    print(f"[OK] STL生成完了: {os.path.abspath(out_path)} ({n_tri} 三角形)")

if __name__ == "__main__":
    main()
