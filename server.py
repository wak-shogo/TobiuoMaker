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

from aero_optimizer import calculate_optimal_glider
from mesh_generator import build_full_glider_mesh, export_stl_binary

app = FastAPI(title="TobiuoMaker & Wing Designer")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# index.html の探索 (カレントディレクトリ または templates/)
if os.path.exists(os.path.join(BASE_DIR, "index.html")):
    HTML_PATH = os.path.join(BASE_DIR, "index.html")
elif os.path.exists(os.path.join(BASE_DIR, "templates", "index.html")):
    HTML_PATH = os.path.join(BASE_DIR, "templates", "index.html")
else:
    HTML_PATH = os.path.join(BASE_DIR, "index.html")

# 静的ファイルの探索
if os.path.exists(os.path.join(BASE_DIR, "js")):
    app.mount("/js", StaticFiles(directory=os.path.join(BASE_DIR, "js")), name="js")
if os.path.exists(os.path.join(BASE_DIR, "static")):
    app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")


class DesignParams(BaseModel):
    sinker_type: str = "bullet"
    weight_g: float = 14.0
    diameter_mm: float = 10.0
    length_mm: float = 22.0
    angle_of_attack_deg: float = 3.0
    glide_mode: str = "air"
    flight_speed_ms: float = 18.0
    tail_length_mm: Optional[float] = None
    span_mm: Optional[float] = None
    mean_chord_mm: Optional[float] = None


@app.get("/", response_class=HTMLResponse)
async def index():
    with open(HTML_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    return HTMLResponse(content=content)


@app.post("/api/optimize")
async def api_optimize(params: DesignParams):
    res = calculate_optimal_glider(params.model_dump())
    return JSONResponse(content=res)


@app.post("/api/download_stl")
async def api_download_stl(params: dict):
    aero = calculate_optimal_glider(params)
    tris = build_full_glider_mesh(aero)

    sinker_t = aero.get("sinker_type", "sinker")
    weight_str = f"{int(aero.get('weight_g', 14))}g"
    tail_str = f"Tail{int(aero.get('tail_length_mm', 50))}mm"
    filename = f"TobiuoWing_{sinker_t}_{weight_str}_{tail_str}.stl"

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

    port = 8080
    while is_port_in_use(port) and port < 8090:
        port += 1

    url = f"http://127.0.0.1:{port}"
    print("=" * 65)
    print("  トビウオ天秤＆各種オモリ用 グライダー翼 自動設計システム")
    print(f"  URL: {url}")
    print("=" * 65)

    threading.Thread(target=open_browser_delayed, args=(url, 1.2), daemon=True).start()

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
