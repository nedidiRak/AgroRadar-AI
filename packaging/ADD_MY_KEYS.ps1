#requires -version 5.1
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location $Root
Write-Host ''
Write-Host 'AgroRadar AI | Экспертный ZIP с рабочими ключами'
Write-Host 'Ключи записываются только в settings.env внутри локальной папки.'
Write-Host 'Enter = оставить поле пустым и использовать деморежим.'
Write-Host ''
$weather = Read-Host 'OpenWeather API key'
$deepseek = Read-Host 'DeepSeek API key'
$yandex = Read-Host 'Yandex Maps JavaScript API key'
foreach ($value in @($weather,$deepseek,$yandex)) {
    if ($value -match '[\r\n]') { throw 'Ключ не может содержать перенос строки.' }
}
$content = @(
    '# Expert-only local configuration; never commit this file to Git'
    "OPENWEATHER_API_KEY=$weather"
    "DEEPSEEK_API_KEY=$deepseek"
    "VITE_YANDEX_MAPS_API_KEY=$yandex"
    'AGRORADAR_WATER_CONTEXT=1'
    'AGRORADAR_AUTO_MONITOR=0'
) -join ([Environment]::NewLine)
[System.IO.File]::WriteAllText(
    (Join-Path $Root 'settings.env'), ($content + [Environment]::NewLine),
    (New-Object System.Text.UTF8Encoding($false))
)
$archive = Join-Path (Split-Path $Root -Parent) 'AgroRadar-Expert-SEND.zip'
if (Test-Path $archive) { Remove-Item $archive -Force }
Compress-Archive -LiteralPath $Root -DestinationPath $archive -CompressionLevel Optimal
Write-Host ''
Write-Host "Готов архив: $archive"
Write-Host 'Получатель распаковывает ZIP и запускает AgroRadar-Expert.exe.'
Write-Host 'ВНИМАНИЕ: введённые ключи лежат внутри архива открытым текстом.'
