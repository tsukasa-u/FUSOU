; Ensures "fusou" can be launched directly from the Windows Run dialog or terminals.
; This file is referenced via bundle.windows.nsis.installerHooks so we can
; register the fusou executable in HKCU\...\App Paths after installation.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\fusou.exe" "" "$INSTDIR\fusou.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\fusou.exe" "Path" "$INSTDIR"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\fusou.exe"
!macroend
