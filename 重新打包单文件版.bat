@echo off
cd /d "%~dp0"
title 重新打包单文件版 - 记忆小站

echo.
echo   正在把源码打包成单文件版，请稍等...
echo.

set "NODEEXE=C://Users//xucon//.workbuddy//binaries//node//versions//22.22.2-6//node.exe"
if not exist "%NODEEXE%" set "NODEEXE=node"

"%NODEEXE%" _tools\build-single.mjs

if errorlevel 1 (
  echo.
  echo   [失败] 打包没有成功，请把上面的提示发给许琮。
) else (
  echo.
  echo   [完成] 已生成新的 记忆小站.html
  echo          现在双击它，就能看到你改的效果了。
)

echo.
echo   本窗口可以直接关掉。
pause >nul
