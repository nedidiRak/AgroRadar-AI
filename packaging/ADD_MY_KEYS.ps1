#requires -version 5.1
# ASCII-only source is intentional: Windows PowerShell 5.1 reads UTF-8
# without a BOM as the legacy ANSI code page and can corrupt Cyrillic quotes.
param(
    [string]$OpenWeatherKey = '',
    [string]$DeepSeekKey = '',
    [string]$YandexKey = '',
    [switch]$NonInteractive
)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root
Write-Host ''
Write-Host 'AgroRadar AI 4.0 - prepare expert ZIP with real API keys'
Write-Host 'Keys go ONLY to this local settings.env, never to GitHub.'
Write-Host 'Press Enter to leave a key blank (demo mode).'
Write-Host ''

$files = @(
    (Join-Path $Root 'AgroRadar-Expert.exe'),
    (Join-Path $Root '_internal'),
    (Join-Path $Root 'README_FIRST.txt'),
    (Join-Path $Root 'settings.env.example'),
    (Join-Path $Root 'ADD_MY_KEYS.ps1'),
    (Join-Path $Root 'ADD_MY_KEYS.cmd')
)
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file)) {
        throw "Incomplete distribution, missing: $file"
    }
}

if (-not $NonInteractive) {
    $OpenWeatherKey = Read-Host 'OpenWeather API key'
    $DeepSeekKey = Read-Host 'DeepSeek API key'
    $YandexKey = Read-Host 'Yandex Maps JavaScript API key'
}
foreach ($value in @($OpenWeatherKey, $DeepSeekKey, $YandexKey)) {
    if ($value -match '[\r\n]') {
        throw 'API keys must not contain line breaks.'
    }
}

$content = @(
    '# Local evaluator configuration. Do NOT commit or publish.'
    "OPENWEATHER_API_KEY=$OpenWeatherKey"
    "DEEPSEEK_API_KEY=$DeepSeekKey"
    "VITE_YANDEX_MAPS_API_KEY=$YandexKey"
    'AGRORADAR_WATER_CONTEXT=1'
    'AGRORADAR_AUTO_MONITOR=0'
) -join ([Environment]::NewLine)
$settings = Join-Path $Root 'settings.env'
[System.IO.File]::WriteAllText(
    $settings, ($content + [Environment]::NewLine),
    (New-Object System.Text.UTF8Encoding($false))
)

$archive = Join-Path (Split-Path $Root -Parent) 'AgroRadar-Expert-SEND.zip'
if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
}

# Only distribute executable, bundled runtime, docs, and chosen keys.
# Never include data/ with field observations and local user credentials.
$files += $settings
Compress-Archive -LiteralPath $files -DestinationPath $archive -CompressionLevel Optimal -ErrorAction Stop
if (-not (Test-Path -LiteralPath $archive)) {
    throw 'ZIP was not created.'
}
Write-Host ''
Write-Host 'SUCCESS: expert package created:'
Write-Host $archive
Write-Host 'Extract the ZIP, run AgroRadar-Expert.exe.'
Write-Host 'IMPORTANT: settings.env inside the ZIP contains your API keys in plain text.'
