@echo off
setlocal EnableExtensions

echo [INFO] delete_proxy.bat started. 1>&2

reg query "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" >nul 2>&1
set "QUERY_EXIT=%ERRORLEVEL%"
if not "%QUERY_EXIT%"=="0" (
	echo [INFO] AutoConfigURL does not exist. nothing to delete. 1>&2
	exit /b 0
)

reg delete "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" /f
set "DEL_EXIT=%ERRORLEVEL%"
if not "%DEL_EXIT%"=="0" (
	echo [ERROR] failed to delete AutoConfigURL from registry. 1>&2
	echo [ERROR] reg exit code: %DEL_EXIT% 1>&2
	echo [ERROR] command: reg delete ... /v "AutoConfigURL" /f 1>&2
	exit /b %DEL_EXIT%
)

echo [INFO] AutoConfigURL deleted successfully. 1>&2

exit /b 0
