@echo off
rem Builds out\ExoBrowser.exe: one static, whole-program-optimized binary plus the ui and extension folders.
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set WV2=%USERPROFILE%\.nuget\packages\microsoft.web.webview2\1.0.4314.35\build\native
if not exist out mkdir out
rem The version, from VERSION, for the exe's version info and About.
set /p EXO_VERSION=<VERSION
set EXO_VERSION_COMMA=%EXO_VERSION:.=,%,0
> out\version.h echo #define EXO_VERSION_TEXT "%EXO_VERSION%"
>> out\version.h echo #define EXO_VERSION_COMMA %EXO_VERSION_COMMA%
>> out\version.h echo #define EXO_VERSION_W L"%EXO_VERSION%"
rc /nologo /I out /fo out\app.res src\app.rc || exit /b 1
rem Exo Vault: src\vault.cpp, with Argon2 (vendor\argon2) for the master password's key: its SSE2 build (opt.c), the
rem same output as the portable ref.c and about twice as fast.
set ARGON2=vendor\argon2\src\argon2.c vendor\argon2\src\core.c vendor\argon2\src\encoding.c vendor\argon2\src\opt.c vendor\argon2\src\thread.c vendor\argon2\src\blake2\blake2b.c
cl /nologo /std:c++20 /EHsc /O2 /GL /Gy /MT /W3 /D_CRT_SECURE_NO_WARNINGS /DUNICODE /D_UNICODE /I"%WV2%\include" /Ivendor\argon2\include /Iout src\main.cpp src\vault.cpp %ARGON2% out\app.res /Fo"out\\" /Fe"out\ExoBrowser.exe" /link /LTCG /SUBSYSTEM:WINDOWS /OPT:REF /OPT:ICF /MANIFEST:EMBED /MANIFESTINPUT:src\app.manifest "%WV2%\x64\WebView2LoaderStatic.lib" user32.lib gdi32.lib ole32.lib shell32.lib advapi32.lib dwmapi.lib crypt32.lib version.lib shlwapi.lib urlmon.lib bcrypt.lib windowsapp.lib dxguid.lib CoreMessaging.lib wtsapi32.lib windowscodecs.lib winhttp.lib || exit /b 1
rem The Bar, new tab page, Settings and Exo Vault: ui\, in Exo Launcher's look from its own copy of Exo's design
rem (refreshed from ..\ExoLauncher first when it is on this PC; see ui\scripts\sync-exo.mjs).
if not exist ui\node_modules call npm --prefix ui ci --no-audit --no-fund >nul || exit /b 1
call npm --prefix ui run -s build >nul || exit /b 1
robocopy ui\dist out\ui /mir /njh /njs /nfl /ndl >nul
robocopy extensions out\extensions /mir /njh /njs /nfl /ndl >nul
exit /b 0
