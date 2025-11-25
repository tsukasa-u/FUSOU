; Ensures "fusou" can be launched directly from the Windows Run dialog or terminals.
; This file is referenced via bundle.windows.nsis.installerHooks.

!include "LogicLib.nsh"

!define Fusou_AppPaths_Key "Software\Microsoft\Windows\CurrentVersion\App Paths\fusou.exe"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKLM "${Fusou_AppPaths_Key}" "" "$INSTDIR\fusou.exe"
  WriteRegStr HKLM "${Fusou_AppPaths_Key}" "Path" "$INSTDIR"

  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \
    "[Environment]::SetEnvironmentVariable(\"Path\", \
    [Environment]::GetEnvironmentVariable(\"Path\", \"Machine\") + \";$INSTDIR\", \
    \"Machine\")"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKLM "${Fusou_AppPaths_Key}"

  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \
    "$p = [Environment]::GetEnvironmentVariable(\"Path\", \"Machine\"); \
    $t = \"$INSTDIR\"; \
    $new = ($p.Split(\";\") | Where-Object { $_ -ne $t }) -join \";\"; \
    [Environment]::SetEnvironmentVariable(\"Path\", $new, \"Machine\")"'
!macroend