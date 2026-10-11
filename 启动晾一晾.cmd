@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Run npm install in this folder first.
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "."
