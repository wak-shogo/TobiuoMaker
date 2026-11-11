@echo off
title Tobiuo Wing Designer
cd /d "%~dp0"

echo =====================================================================
echo   トビウオ天秤 / 各種オモリ用 グライダー翼 自動設計システム
echo   Tobiuo Wing Designer and Wind Tunnel Simulator
echo =====================================================================
echo.
echo サーバーを起動しています...

where python >nul 2>&1
if %errorlevel% equ 0 (
    python server.py
    goto end
)

where py >nul 2>&1
if %errorlevel% equ 0 (
    py -3 server.py
    goto end
)

echo [エラー] Pythonが見つかりませんでした。
echo Pythonがインストールされているか確認してください。

:end
echo.
echo システムが終了しました。
pause
