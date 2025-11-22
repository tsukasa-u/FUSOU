; Ensures "fusou" can be launched directly from the Windows Run dialog or terminals.
; This file is included by the default Tauri NSIS template (see bundle.windows.nsis.include).

!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\fusou.exe" "" "$INSTDIR\fusou.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\fusou.exe" "Path" "$INSTDIR"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\fusou.exe"
!macroend
