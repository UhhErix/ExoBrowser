# Builds a release installer, as Exo Launcher's tools\Build-Release.ps1 does: artifacts\ExoBrowser-Setup.exe and its .sha256,
# and artifacts\whats-new.json (upload all three to the release).
#   pwsh -File tools\Build-Release.ps1 [-TestRoot C:\path]   (-TestRoot: a walk-through build that installs only there)
# Steps: the browser (build.cmd: the exe, its interface and Exo Shield), a clean payload of just what ships, Setup's
# window (setup\build.ps1), the NSIS install engine, then the two joined and the SHA-256 file.
[CmdletBinding()]
param(
    [string]$TestRoot,
    [string]$MakeNsis = 'C:\Program Files (x86)\NSIS\makensis.exe'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$version = (Get-Content VERSION -Raw).Trim()
# This release's What's New, uploaded beside Setup as whats-new.json: the version before it shows these items while it
# offers the update (ui\src\browser\WhatsNew.tsx checks the file).
$whatsNew = @(Get-Content ui\src\browser\whatsNew.json -Raw | ConvertFrom-Json) | Where-Object version -EQ $version | Select-Object -First 1
if (-not $whatsNew) { throw "ui\src\browser\whatsNew.json has no entry for $version." }

# What leaves the PC is what PRIVACY.md says: every request the browser makes itself asks its one checkpoint first.
node (Join-Path $repo 'tools\privacy-check.mjs')
if ($LASTEXITCODE) { throw 'PRIVACY.md and the places Exo Browser connects to disagree (tools\privacy-check.mjs).' }
& (Join-Path $repo 'build.cmd')
if ($LASTEXITCODE) { throw "Browser build failed ($LASTEXITCODE)." }

# What ships: the exe, its interface, Exo Shield, and the notices. Nothing from the build itself (objects, tools).
$payload = Join-Path $repo 'out\release\payload'
if (Test-Path $payload) { Remove-Item -Recurse -Force $payload }
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Copy-Item (Join-Path $repo 'out\ExoBrowser.exe') $payload
foreach ($folder in 'ui', 'extensions') {
    robocopy (Join-Path $repo "out\$folder") (Join-Path $payload $folder) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $folder failed ($LASTEXITCODE)." }
}
foreach ($notice in 'LICENSE', 'THIRD_PARTY_NOTICES.md') {
    $source = Join-Path $repo $notice
    if (Test-Path $source) { Copy-Item $source $payload -Force }
}

$artifacts = Join-Path $repo 'artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$name = if ($TestRoot) { 'ExoBrowser-Setup-test.exe' } else { 'ExoBrowser-Setup.exe' }
$setup = Join-Path $artifacts $name
pwsh -NoProfile -File (Join-Path $repo 'setup\build.ps1')
if ($LASTEXITCODE) { throw "Setup window build failed ($LASTEXITCODE)." }
$shell = Join-Path $repo 'setup\out\ExoSetup.exe'
# The install engine: the payload, the staged swap, shortcuts, the browser listing and the uninstaller. Paths in it are relative to tools\.
$engine = Join-Path $repo 'out\release\ExoBrowser-Engine.exe'
$defines = @("/DPAYLOAD_DIR=$payload", "/DOUTFILE=$engine", "/DPRODUCT_VERSION=$version", "/DSETUP_SHELL=$shell")
if ($TestRoot) { $defines += "/DEXO_TEST_ROOT=$TestRoot" }
Push-Location (Join-Path $repo 'tools')
& $MakeNsis /V2 @defines ExoBrowser.nsi
$nsis = $LASTEXITCODE
Pop-Location
if ($nsis) { throw "makensis failed ($nsis)." }
# The installer people download: the window with the engine inside it (and the app's size, for real progress).
$appBytes = (Get-ChildItem -Recurse -File $payload | Measure-Object Length -Sum).Sum
pwsh -NoProfile -File (Join-Path $repo 'setup\build.ps1') -Engine $engine -AppBytes $appBytes -Out $setup
if ($LASTEXITCODE) { throw "Joining Setup failed ($LASTEXITCODE)." }
Remove-Item $engine -Force

$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$setup.sha256" -Value "$hash  $name" -NoNewline -Encoding ascii
Set-Content -Path (Join-Path $artifacts 'whats-new.json') -Value ($whatsNew | ConvertTo-Json -Depth 4) -NoNewline -Encoding utf8NoBOM
Write-Output "Exo Browser ${version}: $setup ($([math]::Round((Get-Item $setup).Length / 1MB, 1)) MB), SHA-256 $hash"
