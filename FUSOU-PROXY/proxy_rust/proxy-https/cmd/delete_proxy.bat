@echo off
reg delete "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v "AutoConfigURL" /f