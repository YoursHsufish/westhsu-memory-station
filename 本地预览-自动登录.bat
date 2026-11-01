@echo off
chcp 936 >nul
cd /d "%~dp0"
title 本地预览（自动登录）- 记忆小站

set "NODEEXE=C://Users//xucon//.workbuddy//binaries//node//versions//22.22.2-6//node.exe"
if not exist "%NODEEXE%" set "NODEEXE=node"

netstat -ano | findstr ":8787" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo.
  echo   正在启动本地预览服务...
  start "记忆小站 - 本地预览服务" /min "%NODEEXE%" _tools\dev-preview.mjs 8787
  timeout /t 2 >nul
) else (
  echo.
  echo   预览服务已经在运行，直接打开页面。
)

start "" "http://127.0.0.1:8787/index.html#/me"

echo.
echo   页面已打开：http://127.0.0.1:8787/index.html#/me
echo   已自动登录管理员（xucong@westair.cn），云端是本机假云端，不会写正式数据。
echo.
echo   停止服务：关掉那个最小化的「记忆小站 - 本地预览服务」窗口。
echo.
timeout /t 5 >nul
