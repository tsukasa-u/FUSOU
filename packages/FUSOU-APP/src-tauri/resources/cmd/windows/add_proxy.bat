@echo off
if "%~1"=="" (
    echo [ERROR] pac url is required. 1>&2
    exit /b 2
)

reg add "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" /t REG_SZ /d "%~1" /f
if errorlevel 1 (
    echo [ERROR] failed to set AutoConfigURL in registry. 1>&2
    exit /b 3
)

exit /b 0
