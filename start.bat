@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
    echo Electron not found. Run npm install first.
    pause
    exit /b 1
)
set ELECTRON_RUN_AS_NODE=
start "" node_modules\electron\dist\electron.exe .
exit /b
