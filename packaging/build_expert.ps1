#requires -version 5.1
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root
if (-not (Test-Path .\frontend\dist\index.html)) {
    throw 'React build missing: run npm ci && npm run build in frontend first.'
}
Write-Host '[BUILD] Packing AgroRadar Expert for Windows x64 (PyInstaller onedir)...'
$arguments = @(
    '--clean','--noconfirm','--onedir','--console',
    '--name','AgroRadar-Expert',
    '--add-data','frontend/dist;frontend/dist',
    '--collect-submodules','uvicorn',
    '--collect-submodules','app',
    '--hidden-import','uvicorn.protocols.http.auto',
    '--hidden-import','uvicorn.protocols.websockets.auto',
    '--hidden-import','uvicorn.lifespan.on',
    'backend/portable_expert.py'
)
& python -m PyInstaller @arguments
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed.' }

$Out = Join-Path $Root 'dist\AgroRadar-Expert'
Copy-Item .\packaging\EXPERT_README.txt (Join-Path $Out 'README_FIRST.txt') -Force
Copy-Item .\packaging\ADD_MY_KEYS.ps1 (Join-Path $Out 'ADD_MY_KEYS.ps1') -Force
Copy-Item .\packaging\ADD_MY_KEYS.cmd (Join-Path $Out 'ADD_MY_KEYS.cmd') -Force
Copy-Item .\packaging\settings.env.example (Join-Path $Out 'settings.env.example') -Force
if (Test-Path (Join-Path $Out 'data')) { throw 'Refuse to ship a reused build directory with data/.' }
if (Test-Path (Join-Path $Out 'settings.env')) { throw 'Refuse to ship a reused build directory with settings.env.' }
Write-Host "[BUILD] Ready: $Out"
Get-ChildItem $Out | Select-Object Name,Length
