@echo off

reg query "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" >nul 2>&1
if errorlevel 1 (
	exit /b 0
)

reg delete "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" /f
if errorlevel 1 (
	echo [ERROR] failed to delete AutoConfigURL from registry. 1>&2
	exit /b 3
)

exit /b 0
