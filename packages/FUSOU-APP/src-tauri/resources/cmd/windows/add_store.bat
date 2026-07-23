@echo off
setlocal EnableExtensions

echo [INFO] add_store.bat started. 1>&2

if "%~1"=="" (
	echo [ERROR] certificate path is required. 1>&2
	exit /b 2
)

set "CERT_PATH=%~f1"
if not exist "%CERT_PATH%" (
	echo [ERROR] certificate file not found: "%CERT_PATH%" 1>&2
	exit /b 3
)

echo [INFO] running certutil addstore for: "%CERT_PATH%" 1>&2
certutil -f -user -addstore Root "%CERT_PATH%"
set "CERTUTIL_EXIT=%ERRORLEVEL%"

if not "%CERTUTIL_EXIT%"=="0" (
	echo [ERROR] certutil addstore failed with exit code %CERTUTIL_EXIT%. 1>&2
	echo [ERROR] certificate path: "%CERT_PATH%" 1>&2
	echo [ERROR] command: certutil -f -user -addstore Root "%%CERT_PATH%%" 1>&2
	exit /b %CERTUTIL_EXIT%
)

echo [INFO] certificate installed to CurrentUser\Root: "%CERT_PATH%"

exit /b %CERTUTIL_EXIT%
