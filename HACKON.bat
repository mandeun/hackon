@echo off
rem ─────────────────────────────────────────────────────────────
rem  HACK:ON — 더블클릭 한 번. 주소창 없는 앱 창으로 뜬다.
rem  창을 닫으면 서버도 같이 꺼진다.
rem  콘솔까지 안 보이게 하려면 HACKON.vbs 를 쓴다.
rem ─────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title HACK:ON

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js 가 없습니다.
  echo   https://nodejs.org 에서 LTS 를 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

node desktop.js
