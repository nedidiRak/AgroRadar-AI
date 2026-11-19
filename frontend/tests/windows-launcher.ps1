# GitHub-hosted Windows runner, disposable clone and isolated application data.
$ErrorActionPreference = 'Stop'
$env:AGRORADAR_DATA_DIR = Join-Path $env:RUNNER_TEMP 'agro-launcher-data'
$env:AGRORADAR_ADMIN_PASSWORD = 'AgroRadar-Test-Only-Password!2026'
$env:AGRORADAR_AUTO_MONITOR = '0'
$env:AGRORADAR_WATER_CONTEXT = '0'
$env:OPENWEATHER_API_KEY = ''
$env:DEEPSEEK_API_KEY = ''
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$launcher = Start-Process -FilePath $env:ComSpec -ArgumentList '/d','/c','START_AGRORADAR.bat' -WorkingDirectory $root -PassThru
try {
    $address = 'http://127.0.0.1:5173'
    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod "$address/api/health" -TimeoutSec 2
        } catch { $health = $null }
    } while (!$health -and (Get-Date) -lt $deadline)
    if (!$health) { throw 'Vite did not reach the FastAPI process started by START_AGRORADAR.bat' }
    $port = [int](Get-Content (Join-Path $root 'frontend/.agroradar-api-port'))
    Invoke-RestMethod "http://127.0.0.1:$port/api/health" | Out-Null
    $result = Invoke-RestMethod "$address/api/auth/login" -Method Post -ContentType 'application/json' -SessionVariable session -Body (@{username='admin';password=$env:AGRORADAR_ADMIN_PASSWORD} | ConvertTo-Json)
    if (!$result.authenticated) { throw 'Launcher authentication failed' }
    $layouts = Invoke-RestMethod "$address/api/me/layouts" -WebSession $session
    if ($layouts.revision -ne 0) { throw 'Expected a new, isolated account workspace' }
    $html = (Invoke-WebRequest $address).Content
    if ($html -notmatch 'src/main.tsx') { throw 'Expected AgroRadar React application entry point' }
    Write-Host "START_AGRORADAR.bat verified on Windows: UI, API proxy, login, personal layouts."
    & node (Join-Path $PSScriptRoot 'browser-responsive.mjs') --system-dpi
    if ($LASTEXITCODE -ne 0) { throw 'Windows display DPI regression in the running application' }
} finally {
    # Only terminate listeners created in this disposable runner checkout.
    foreach ($portToStop in @($port, 5173)) {
        if ($portToStop) {
            Get-NetTCPConnection -State Listen -LocalPort $portToStop -ErrorAction SilentlyContinue |
                ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
        }
    }
    if (!$launcher.HasExited) { Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue }
}
