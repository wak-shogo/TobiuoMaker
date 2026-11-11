# -*- coding: utf-8 -*-
"""
トビウオ天秤＆各種オモリ用 グライダー翼 自動設計＆風洞実験シミュレータ
Tobiuo Wing Designer & Wind Tunnel Simulator Web Server
"""

import os
import io
import tempfile
import webbrowser
import threading
import time
import socket
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional

from aero_optimizer import calculate_optimal_wing
from mesh_generator import build_glider_mesh, export_stl_binary, get_mesh_data

app = FastAPI(title="Tobiuo Wing Designer & Wind Tunnel Simulator")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class DesignParams(BaseModel):
    sinker_type: str = "bullet"
    weight_g: float = 14.0
    diameter_mm: float = 10.0
    length_mm: float = 22.0
    angle_of_attack_deg: float = 3.0
    glide_mode: str = "air"
    flight_speed_ms: float = 18.0
    span_mm: Optional[float] = None
    mean_chord_mm: Optional[float] = None
    fin_height_mm: Optional[float] = None


@app.get("/", response_class=HTMLResponse)
async def index():
    html_path = os.path.join(TEMPLATES_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        content = f.read()
    return HTMLResponse(content=content)


@app.post("/api/optimize")
async def api_optimize(params: DesignParams):
    res = calculate_optimal_wing(
        sinker_type=params.sinker_type,
        weight_g=params.weight_g,
        diameter_mm=params.diameter_mm,
        length_mm=params.length_mm,
        angle_of_attack_deg=params.angle_of_attack_deg,
        glide_mode=params.glide_mode,
        custom_span_mm=params.span_mm,
        custom_chord_mm=params.mean_chord_mm,
        custom_fin_height_mm=params.fin_height_mm,
        flight_speed_ms=params.flight_speed_ms
    )
    return JSONResponse(content=res)


@app.post("/api/mesh")
async def api_mesh(params: dict):
    opt = calculate_optimal_wing(
        sinker_type=params.get("sinker_type", "bullet"),
        weight_g=float(params.get("weight_g", 14.0)),
        diameter_mm=float(params.get("diameter_mm", 10.0)),
        length_mm=float(params.get("length_mm", 22.0)),
        angle_of_attack_deg=float(params.get("angle_of_attack_deg", 3.0)),
        glide_mode=params.get("glide_mode", "air"),
        custom_span_mm=float(params["span_mm"]) if params.get("span_mm") else None,
        custom_chord_mm=float(params["mean_chord_mm"]) if params.get("mean_chord_mm") else None,
        custom_fin_height_mm=float(params["fin_height_mm"]) if params.get("fin_height_mm") else None,
        flight_speed_ms=float(params.get("flight_speed_ms", 18.0))
    )
    combined = {**opt, **params}
    mesh_data = get_mesh_data(combined)
    return JSONResponse(content={"mesh": mesh_data, "aero": opt})


@app.post("/api/download_stl")
async def api_download_stl(params: dict):
    opt = calculate_optimal_wing(
        sinker_type=params.get("sinker_type", "bullet"),
        weight_g=float(params.get("weight_g", 14.0)),
        diameter_mm=float(params.get("diameter_mm", 10.0)),
        length_mm=float(params.get("length_mm", 22.0)),
        angle_of_attack_deg=float(params.get("angle_of_attack_deg", 3.0)),
        glide_mode=params.get("glide_mode", "air"),
        custom_span_mm=float(params["span_mm"]) if params.get("span_mm") else None,
        custom_chord_mm=float(params["mean_chord_mm"]) if params.get("mean_chord_mm") else None,
        custom_fin_height_mm=float(params["fin_height_mm"]) if params.get("fin_height_mm") else None,
        flight_speed_ms=float(params.get("flight_speed_ms", 18.0))
    )
    combined = {**opt, **params}
    tris = build_glider_mesh(combined)
    
    sinker_t = combined.get("sinker_type", "sinker")
    weight_str = f"{int(combined.get('weight_g', 14))}g"
    aoa_str = f"{int(combined.get('angle_of_attack_deg', 3))}deg"
    filename = f"TobiuoWing_{sinker_t}_{weight_str}_{aoa_str}.stl"
    
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp_path = tmp.name
        
    export_stl_binary(tris, tmp_path, header_text=f"Tobiuo_{sinker_t}_{weight_str}")
    
    with open(tmp_path, "rb") as f:
        stl_bytes = f.read()
    
    try:
        os.remove(tmp_path)
    except:
        pass
        
    return StreamingResponse(
        io.BytesIO(stl_bytes),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def open_browser_delayed(url: str, delay: float = 1.0):
    time.sleep(delay)
    print(f"\n[ブラウザ起動] 画面を開いています: {url}")
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"ブラウザ起動エラー: {e}")


if __name__ == "__main__":
    import uvicorn
    
    # 使用可能なポートを探索 (8080 -> 8081 -> ...)
    port = 8080
    while is_port_in_use(port) and port < 8090:
        port += 1
        
    url = f"http://127.0.0.1:{port}"
    print("=" * 65)
    print("  トビウオ天秤＆各種オモリ用 グライダー翼 自動設計システム")
    print(f"  URL: {url}")
    print("=" * 65)
    
    # 別スレッドでブラウザを自動オープン
    threading.Thread(target=open_browser_delayed, args=(url, 1.2), daemon=True).start()
    
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
