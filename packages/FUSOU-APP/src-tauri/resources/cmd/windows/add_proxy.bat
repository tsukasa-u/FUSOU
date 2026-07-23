@echo off
setlocal EnableExtensions

echo [INFO] add_proxy.bat started. 1>&2
if "%~1"=="" (
    echo [ERROR] pac url is required. 1>&2
    exit /b 2
)

set "PAC_URL=%~1"
echo [INFO] setting AutoConfigURL to "%PAC_URL%" 1>&2

reg add "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" /t REG_SZ /d "%PAC_URL%" /f
set "REG_EXIT=%ERRORLEVEL%"
if not "%REG_EXIT%"=="0" (
    echo [ERROR] failed to set AutoConfigURL in registry. 1>&2
    echo [ERROR] reg exit code: %REG_EXIT% 1>&2
    echo [ERROR] command: reg add ... /d "%PAC_URL%" /f 1>&2
    exit /b %REG_EXIT%
)

echo [INFO] AutoConfigURL updated successfully. 1>&2

exit /b 0
