@echo off
setlocal

if "%~1"=="" (
	echo [ERROR] certificate path is required. 1>&2
	exit /b 2
)

set "CERT_PATH=%~f1"
if not exist "%CERT_PATH%" (
	echo [ERROR] certificate file not found: "%CERT_PATH%" 1>&2
	exit /b 3
)

certutil -f -user -addstore Root "%CERT_PATH%"
set "CERTUTIL_EXIT=%ERRORLEVEL%"
if not "%CERTUTIL_EXIT%"=="0" (
	echo [ERROR] certutil failed with exit code %CERTUTIL_EXIT% for "%CERT_PATH%" 1>&2
)

exit /b %CERTUTIL_EXIT%
