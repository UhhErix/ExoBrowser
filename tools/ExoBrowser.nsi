; Exo Browser's install engine (NSIS), as Exo Launcher's is: Exo Browser Setup (setup\) runs it silently and shows
; its steps in its own window; without WebView2 it runs on its own, with NSIS's plain progress screen.
; It installs per user, no admin: %LOCALAPPDATA%\ExoBrowser\app, staged beside it and swapped in whole, a Start menu
; shortcut, an optional desktop one, an uninstaller, and Exo Browser listed among Windows' browsers (Default apps).
; Your data (history, sign-ins, bookmarks, Exo Vault) lives beside app\, never inside it, so updates never touch it.
;   makensis /DPAYLOAD_DIR=<folder> [/DSETUP_SHELL=ExoSetup.exe] [/DOUTFILE=engine.exe] [/DEXO_TEST_ROOT=<folder>] ExoBrowser.nsi
; From Setup's window: /S /NOLAUNCH /DESKTOP=0|1 /STATUSFILE=<file>.
!ifndef PRODUCT_VERSION
  !searchparse /file "..\VERSION" "" PRODUCT_VERSION
!endif
!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR required"
!endif
!ifndef OUTFILE
  !define OUTFILE "ExoBrowser-Engine.exe"
!endif
!define ICON "..\src\app.ico"

!define PRODUCT_NAME "Exo Browser"
!define PRODUCT_PUBLISHER "Erix (UhhErix)"
!define PRODUCT_WEB "https://github.com/UhhErix/ExoBrowser"
!ifdef EXO_TEST_ROOT
  ; A walk-through build (/DEXO_TEST_ROOT=<folder>): installs under that folder with its own registry entries,
  ; shortcut names and browser listing, never over the real Exo Browser.
  !define ROOT "${EXO_TEST_ROOT}"
  !define LINK_NAME "Exo Browser (test)"
  !define REG_NAME "ExoBrowserTest"
!else
  !define ROOT "$LOCALAPPDATA\ExoBrowser"
  !define LINK_NAME "Exo Browser"
  !define REG_NAME "ExoBrowser"
!endif
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\${REG_NAME}.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${REG_NAME}"
; Windows' browser listing (StartMenuInternet + RegisteredApplications) and the ProgIds it opens links and pages with.
; The app checks these names (src/main.cpp IsRegistered, IsDefaultBrowser).
!define CLIENT_KEY "Software\Clients\StartMenuInternet\${REG_NAME}"
!define PROGID_HTML "${REG_NAME}HTML"
!define PROGID_URL "${REG_NAME}URL"

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
CRCCheck on
XPStyle on

Name "${PRODUCT_NAME}"
Caption "${PRODUCT_NAME} Setup"
UninstallCaption "Uninstall ${PRODUCT_NAME}"
OutFile "${OUTFILE}"
InstallDir "${ROOT}\app"
ShowInstDetails nevershow
ShowUnInstDetails nevershow
AutoCloseWindow true
BrandingText " "
Icon "${ICON}"
UninstallIcon "${ICON}"

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinMessages.nsh"

Page instfiles
UninstPage instfiles

Var StatusFile  ; /STATUSFILE=: where each step is written for Setup's window
Var DesktopLink ; /DESKTOP=: "" leaves the desktop shortcut as it is, "0" or "1"
Var NoLaunch    ; /NOLAUNCH: Launch Exo Browser is left to Setup's window

!macro Status TEXT
  DetailPrint "${TEXT}"
  ${If} $StatusFile != ""
    FileOpen $R4 "$StatusFile" a
    FileSeek $R4 0 END
    FileWrite $R4 "${TEXT}$\r$\n"
    FileClose $R4
  ${EndIf}
!macroend

; Closes the Exo Browser running from this app folder (its window saves your tabs as it closes) and waits for it to
; exit. A copy running from anywhere else is left alone. $0 is "0" once none is left, "1" if one would not close.
!macro CloseApp UN
Function ${UN}CloseApp
  StrCpy $5 0
  close_next:
    FindWindow $1 "ExoBrowserWindow" "" "" $5
    StrCmp $1 0 close_done
    StrCpy $5 $1
    System::Call 'user32::GetWindowThreadProcessId(p r1, *i .r2)'
    System::Call 'kernel32::OpenProcess(i 0x101000, i 0, i r2) p .r3'
    StrCmp $3 0 close_next
    StrCpy $4 ""
    System::Call 'kernel32::QueryFullProcessImageNameW(p r3, i 0, w .r4, *i ${NSIS_MAX_STRLEN})'
    ${If} $4 == "$INSTDIR\ExoBrowser.exe"
      SendMessage $1 ${WM_CLOSE} 0 0 /TIMEOUT=5000
      System::Call 'kernel32::WaitForSingleObject(p r3, i 15000) i .r6'
      System::Call 'kernel32::CloseHandle(p r3)'
      ${If} $6 != 0
        StrCpy $0 1
        Return
      ${EndIf}
      ; Its window is gone: look again from the start.
      StrCpy $5 0
      Goto close_next
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r3)'
    Goto close_next
  close_done:
  StrCpy $0 0
FunctionEnd
!macroend
!insertmacro CloseApp ""
!insertmacro CloseApp "un."

; Exo Browser runs on WebView2, part of Windows 11 and of most Windows 10 PCs. Where it's missing (or registered with
; its files gone), Microsoft's own installer is fetched and run, after checking it is signed by Microsoft.
Function EnsureWebView2
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "location"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ReadRegStr $1 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "location"
  ${EndIf}
  ${If} $0 == ""
    Goto webview_install
  ${EndIf}
  ${If} $1 != ""
    IfFileExists "$1\$0\msedgewebview2.exe" webview_ok webview_try_pf
  ${EndIf}
  webview_try_pf:
  IfFileExists "$PROGRAMFILES32\Microsoft\EdgeWebView\Application\$0\msedgewebview2.exe" webview_ok webview_try_user
  webview_try_user:
  IfFileExists "$LOCALAPPDATA\Microsoft\EdgeWebView\Application\$0\msedgewebview2.exe" webview_ok webview_install
  webview_ok:
  Return
  webview_install:
  !insertmacro Status "Getting WebView2"
  FileOpen $3 "$TEMP\exo-browser-webview2.ps1" w
  FileWrite $3 "$$ErrorActionPreference = 'Stop'$\r$\n"
  FileWrite $3 "$$uri = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'$\r$\n"
  FileWrite $3 "$$out = Join-Path $$env:TEMP 'MicrosoftEdgeWebview2Setup.exe'$\r$\n"
  FileWrite $3 "Invoke-WebRequest -UseBasicParsing -Uri $$uri -OutFile $$out$\r$\n"
  FileWrite $3 "$$signature = Get-AuthenticodeSignature -LiteralPath $$out$\r$\n"
  FileWrite $3 "if ($$signature.Status -ne 'Valid' -or $$signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$$)') { Remove-Item -LiteralPath $$out -Force -ErrorAction SilentlyContinue; throw 'WebView2 bootstrapper signature is not valid for Microsoft Corporation.' }$\r$\n"
  FileClose $3
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$TEMP\exo-browser-webview2.ps1"'
  Pop $1
  Delete "$TEMP\exo-browser-webview2.ps1"
  ${If} $1 != "0"
    DetailPrint "WebView2 download failed ($1). Continuing."
    Return
  ${EndIf}
  ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe" /silent /install' $2
  Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} requires 64-bit Windows."
    Abort
  ${EndIf}
  SetRegView 64
  ; One managed location, so updates always find it; setup never takes another destination.
  StrCpy $INSTDIR "${ROOT}\app"
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/STATUSFILE=" $StatusFile
  IfErrors 0 +2
    StrCpy $StatusFile ""
  ClearErrors
  ${GetOptions} $0 "/DESKTOP=" $1
  IfErrors +2 0
    StrCpy $DesktopLink $1
  ClearErrors
  ${GetOptions} $0 "/NOLAUNCH" $1
  IfErrors +2 0
    StrCpy $NoLaunch 1
  ; On its own screens (no Setup window), a first install gets the desktop shortcut, as Setup's switch defaults to.
  ${IfNot} ${Silent}
  ${AndIf} $DesktopLink == ""
  ${AndIfNot} ${FileExists} "$INSTDIR\ExoBrowser.exe"
    StrCpy $DesktopLink 1
  ${EndIf}
FunctionEnd

Section "Exo Browser" SecApp
  SectionIn RO
  StrCpy $INSTDIR "${ROOT}\app"
  StrCpy $R8 "${ROOT}"
  StrCpy $R3 "0"
  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  StrCpy $R9 "$R8\app.incoming-$0"
  StrCpy $R5 "$R8\app.previous-$0"
  Call EnsureWebView2

  ; Never take over a folder that isn't Exo Browser's: an ExoBrowser.exe marks ours, an empty folder is safe.
  IfFileExists "$INSTDIR\ExoBrowser.exe" target_ok
  IfFileExists "$INSTDIR\*.*" unmanaged_target target_empty
  unmanaged_target:
    StrCpy $R6 "Exo Browser's app folder holds files from another app. Setup left that folder unchanged."
    Goto install_fail
  target_empty:
    RMDir "$INSTDIR"
  target_ok:

  ; Stage the whole app beside the live one, then swap: an update never leaves a half-copied app.
  IfFileExists "$R9\*.*" staging_collision
  IfFileExists "$R5\*.*" backup_collision
  RMDir "$R9"
  RMDir "$R5"
  CreateDirectory "$R9"
  StrCpy $R3 "1"
  SetOutPath "$R9"
  !insertmacro Status "Copying files"
  File /r "${PAYLOAD_DIR}\*.*"
  Goto staging_ready
  staging_collision:
    StrCpy $R6 "Setup could not make its own staging folder. Nothing installed was changed."
    Goto install_fail
  backup_collision:
    StrCpy $R6 "Setup found an unexpected rollback folder. Nothing installed was changed."
    Goto install_fail
  staging_ready:
  ; Leave the staged folder (setup's current folder would keep it open) before it is renamed.
  SetOutPath "$TEMP"
  IfFileExists "$R9\ExoBrowser.exe" payload_ok
    StrCpy $R6 "This copy of Setup is incomplete (ExoBrowser.exe is missing). Download it again."
    Goto install_fail
  payload_ok:

  !insertmacro Status "Closing Exo Browser"
  Call CloseApp
  ${If} $0 != "0"
    StrCpy $R6 "Exo Browser is still running and didn't close. Close it, then try again. Nothing installed was changed."
    Goto install_fail
  ${EndIf}
  !insertmacro Status "Installing"
  StrCpy $R7 "0"
  IfFileExists "$INSTDIR\ExoBrowser.exe" 0 no_old
    ; Exo Browser's WebView2 helpers can outlive its window by a few seconds, and before 1.1.3 it ran them (and the
    ; Setup an update starts) from inside the app folder, which holds it open: try again for up to 20 seconds as they
    ; close. (Every update from Settings stopped here with "the folder is in use".)
    StrCpy $R2 0
    swap_prepare_retry:
    ClearErrors
    Rename "$INSTDIR" "$R5"
    IfErrors 0 swap_prepare_done
    IntOp $R2 $R2 + 1
    IntCmp $R2 40 swap_prepare_fail
    Sleep 500
    Goto swap_prepare_retry
    swap_prepare_done:
    StrCpy $R7 "1"
  no_old:
  CreateDirectory "$R8"
  ClearErrors
  Rename "$R9" "$INSTDIR"
  IfErrors swap_commit_fail
  StrCpy $R3 "0"
  IfFileExists "$INSTDIR\ExoBrowser.exe" swap_ok swap_verify_fail

  swap_prepare_fail:
    StrCpy $R6 "Exo Browser's folder is in use. Close anything opened from it (or restart Windows), then try again. Nothing installed was changed."
    Goto install_fail
  swap_commit_fail:
    ${If} $R7 == "1"
      RMDir "$INSTDIR"
      ClearErrors
      Rename "$R5" "$INSTDIR"
      IfErrors rollback_fail
    ${EndIf}
    StrCpy $R6 "The new version could not be installed. The one you had was put back."
    Goto install_fail
  swap_verify_fail:
    RMDir /r "$INSTDIR"
    ${If} $R7 == "1"
      ClearErrors
      Rename "$R5" "$INSTDIR"
      IfErrors rollback_fail
    ${EndIf}
    StrCpy $R6 "The new version failed its check. The one you had was put back."
    Goto install_fail
  rollback_fail:
    StrCpy $R6 "Setup could not put the previous version back by itself. It is kept in $R5."
    Goto install_fail

  install_fail:
    ${If} $R3 == "1"
      RMDir /r "$R9"
    ${EndIf}
    CreateDirectory "$R8"
    FileOpen $R4 "$R8\update-error.log" w
    FileWrite $R4 "$R6$\r$\n"
    FileClose $R4
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$R6"
    SetErrorLevel 1
    Abort

  swap_ok:
  Delete "$R8\update-error.log"
  ${If} $R7 == "1"
    RMDir /r "$R5"
  ${EndIf}

  ; Exo Shield's copy beside your data (Builtin), refreshed here while the browser is closed: the browser did it on its
  ; first start after an update, on its main thread, 51 MB before anything showed. Staged and swapped in whole; if the
  ; old one is still in use the browser refreshes it itself.
  !insertmacro Status "Getting Exo Shield ready"
  RMDir /r "$R8\Builtin\exo-shield.incoming"
  CreateDirectory "$R8\Builtin\exo-shield.incoming"
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\extensions\exo-shield\*.*" "$R8\Builtin\exo-shield.incoming"
  ${If} ${Errors}
    RMDir /r "$R8\Builtin\exo-shield.incoming"
  ${Else}
    RMDir /r "$R8\Builtin\exo-shield"
    ClearErrors
    Rename "$R8\Builtin\exo-shield.incoming" "$R8\Builtin\exo-shield"
    ${If} ${Errors}
      RMDir /r "$R8\Builtin\exo-shield.incoming"
    ${EndIf}
  ${EndIf}

  !insertmacro Status "Finishing"
  ; Shortcuts start in the app folder, not setup's.
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\${LINK_NAME}.lnk" "$INSTDIR\ExoBrowser.exe" "" "$INSTDIR\ExoBrowser.exe" 0
  ${If} $DesktopLink == "1"
    CreateShortCut "$DESKTOP\${LINK_NAME}.lnk" "$INSTDIR\ExoBrowser.exe" "" "$INSTDIR\ExoBrowser.exe" 0
  ${ElseIf} $DesktopLink == "0"
    Delete "$DESKTOP\${LINK_NAME}.lnk"
  ${EndIf}
  SetOutPath "$TEMP"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\ExoBrowser.exe"
  WriteRegStr HKCU "${PRODUCT_DIR_REGKEY}" "Path" "$INSTDIR"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "${LINK_NAME}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\ExoBrowser.exe"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "EstimatedSize" "$0"
!ifdef SETUP_SHELL
  ; Setup's window stays with the app as its uninstaller, so removing Exo Browser looks like Exo too.
  File "/oname=$INSTDIR\ExoSetup.exe" "${SETUP_SHELL}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" '"$INSTDIR\ExoSetup.exe" --uninstall'
!endif

  ; Listed among Windows' browsers: Settings > Default apps can make it the default for links and web pages.
  WriteRegStr HKCU "${CLIENT_KEY}" "" "${LINK_NAME}"
  WriteRegStr HKCU "${CLIENT_KEY}\DefaultIcon" "" "$INSTDIR\ExoBrowser.exe,0"
  WriteRegStr HKCU "${CLIENT_KEY}\shell\open\command" "" '"$INSTDIR\ExoBrowser.exe"'
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities" "ApplicationName" "${LINK_NAME}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities" "ApplicationIcon" "$INSTDIR\ExoBrowser.exe,0"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities" "ApplicationDescription" "A private, fast browser in Exo's look."
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\StartMenu" "StartMenuInternet" "${REG_NAME}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\URLAssociations" "http" "${PROGID_URL}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\URLAssociations" "https" "${PROGID_URL}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\FileAssociations" ".htm" "${PROGID_HTML}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\FileAssociations" ".html" "${PROGID_HTML}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\FileAssociations" ".shtml" "${PROGID_HTML}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\FileAssociations" ".xht" "${PROGID_HTML}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\FileAssociations" ".xhtml" "${PROGID_HTML}"
  WriteRegStr HKCU "${CLIENT_KEY}\Capabilities\FileAssociations" ".pdf" "${PROGID_HTML}"
  WriteRegStr HKCU "Software\RegisteredApplications" "${LINK_NAME}" "${CLIENT_KEY}\Capabilities"
  WriteRegStr HKCU "Software\Classes\${PROGID_HTML}" "" "${LINK_NAME} Document"
  WriteRegStr HKCU "Software\Classes\${PROGID_HTML}" "AppUserModelId" "${REG_NAME}"
  WriteRegStr HKCU "Software\Classes\${PROGID_HTML}\DefaultIcon" "" "$INSTDIR\ExoBrowser.exe,0"
  WriteRegStr HKCU "Software\Classes\${PROGID_HTML}\shell\open\command" "" '"$INSTDIR\ExoBrowser.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\${PROGID_URL}" "" "${LINK_NAME} URL"
  WriteRegStr HKCU "Software\Classes\${PROGID_URL}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${PROGID_URL}" "AppUserModelId" "${REG_NAME}"
  WriteRegStr HKCU "Software\Classes\${PROGID_URL}\DefaultIcon" "" "$INSTDIR\ExoBrowser.exe,0"
  WriteRegStr HKCU "Software\Classes\${PROGID_URL}\shell\open\command" "" '"$INSTDIR\ExoBrowser.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  ; What earlier runs left behind: unfinished staging and rollback folders, and old error notes.
  !insertmacro Status "Cleaning up"
  FindFirst $0 $1 "$R8\app.incoming-*"
  ${DoWhile} $1 != ""
    RMDir /r "$R8\$1"
    FindNext $0 $1
  ${Loop}
  FindClose $0
  FindFirst $0 $1 "$R8\app.previous-*"
  ${DoWhile} $1 != ""
    RMDir /r "$R8\$1"
    FindNext $0 $1
  ${Loop}
  FindClose $0

  ; Setup's window has its own Launch button; on the engine's own screens or /S, Exo Browser opens now.
  StrCmp $NoLaunch 1 +2
    Exec '"$INSTDIR\ExoBrowser.exe"'
SectionEnd

Function un.onInit
  SetRegView 64
  StrCpy $INSTDIR "${ROOT}\app"
FunctionEnd

; Removes the app, its shortcuts and its listing; your data beside app\ stays (Setup's window can remove it too).
Section "Uninstall"
  SetAutoClose true
  Call un.CloseApp
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONSTOP "Exo Browser is still running. Close it and try again." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  Delete "$SMPROGRAMS\${LINK_NAME}.lnk"
  Delete "$DESKTOP\${LINK_NAME}.lnk"
  ; Only ever the app folder itself, and only when it is Exo Browser's.
  IfFileExists "$INSTDIR\ExoBrowser.exe" 0 +2
    RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKCU "${PRODUCT_DIR_REGKEY}"
  DeleteRegKey HKCU "${CLIENT_KEY}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${LINK_NAME}"
  DeleteRegKey HKCU "Software\Classes\${PROGID_HTML}"
  DeleteRegKey HKCU "Software\Classes\${PROGID_URL}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd
