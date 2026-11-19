# Exercise the real Wi-Fi batch launcher with Node missing from CMD's PATH.
# GitHub Actions has Node 22 from setup-node; a tiny fnm command shim simulates
# "fnm env --shell cmd" and proves that the launcher actually wires up npm.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$bat = Join-Path $root 'DEMO_WIFI.bat'
$nodeDir = Split-Path -Parent (Get-Command npm.cmd -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  throw "Node executable is unavailable next to npm.cmd"
}
if (-not (Test-Path (Join-Path $root 'backend\.venv\Scripts\python.exe'))) {
  throw "Python virtual environment must be prepared by this CI job first"
}

$shim = Join-Path $env:RUNNER_TEMP 'agroradar-fnm-shim'
New-Item -ItemType Directory -Path $shim -Force | Out-Null
@'
@echo off
if /I "%~1"=="env" (
    echo SET "PATH=%FNM_TEST_NODE_DIR%;%PATH%"
    exit /b 0
)
if /I "%~1"=="use" (
    echo Using Node v22 for Wi-Fi Demo
    exit /b 0
)
exit /b 1
'@ | Set-Content -Encoding ascii (Join-Path $shim 'fnm.cmd')

$originalPath = $env:PATH
try {
  $env:FNM_TEST_NODE_DIR = $nodeDir
  # Deliberately hide the real npm and node.exe, but allow the cmd shim to run.
  $env:PATH = "$shim;$env:WINDIR\System32;$env:WINDIR;$env:WINDIR\System32\WindowsPowerShell\v1.0"
  $output = & $env:ComSpec /d /c "echo.| `"$bat`" --help" 2>&1
  $text = $output | Out-String
  Write-Host $text
  if ($LASTEXITCODE -ne 0) { throw "Wi-Fi launcher returned exit code $LASTEXITCODE" }
  if (-not $text.Contains('Activating fnm-managed Node.js 22')) {
    throw "Wi-Fi launcher never activated fnm"
  }
  if (-not $text.Contains('[OK] Node.js and npm are ready for Wi-Fi Demo.')) {
    throw "Wi-Fi launcher did not resolve node and npm"
  }
  if (-not $text.Contains('--port')) {
    throw "Backend demo_wifi.py --help did not run"
  }
  Write-Host 'PASS: DEMO_WIFI.bat recovers from missing npm in CMD using fnm.'
}
finally {
  $env:PATH = $originalPath
  Remove-Item Env:FNM_TEST_NODE_DIR -ErrorAction SilentlyContinue
}
