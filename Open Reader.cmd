@echo off
setlocal
pushd "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
    python -B reader.py %*
) else (
    py -3 -B reader.py %*
)
if errorlevel 1 pause
popd
