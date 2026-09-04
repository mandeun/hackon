@echo off
rem ─────────────────────────────────────────────────────────────
rem  HACK:ON — 윈도우에서 더블클릭 한 번으로 켜는 프로그램
rem  하는 일: 서버를 띄우고 기본 브라우저로 화면을 연다. 창을 닫으면 꺼진다.
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

echo.
echo   HACK:ON 을 켭니다.  창을 닫으면 꺼집니다.
echo   주소: http://localhost:8788
echo.

start "" http://localhost:8788
node server.js
pause
