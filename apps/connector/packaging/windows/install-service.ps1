param(
  [string]$ProjectPath = "$HOME\golden-agent",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$serviceName = "GoldenAgentConnector"
$node = (Get-Command node -ErrorAction Stop).Source
$entry = Join-Path $ProjectPath "dist\apps\connector\src\main.js"
$configDir = Join-Path $env:APPDATA "GoldenAgent"
$configPath = Join-Path $configDir "connector.env"

if ($Remove) {
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $serviceName | Out-Null
  }
  Write-Host "Removed $serviceName"
  exit 0
}

Push-Location $ProjectPath
try {
  pnpm install --frozen-lockfile
  pnpm build
} finally { Pop-Location }

New-Item -ItemType Directory -Force -Path $configDir | Out-Null
if (-not (Test-Path $configPath)) {
  @(
    "CONNECTOR_SERVER_URL=ws://127.0.0.1:4100/connect",
    "CONNECTOR_ALLOWED_ROOTS=$ProjectPath",
    "CONNECTOR_PERMISSIONS=connector.health,model.discovery",
    "CONNECTOR_TERMINAL_COMMANDS="
  ) | Set-Content -Path $configPath -Encoding utf8
}

$binPath = "`"$node`" `"$entry`" service"
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue; sc.exe delete $serviceName | Out-Null }
New-Service -Name $serviceName -BinaryPathName $binPath -DisplayName "Golden Agent Connector" -Description "Golden Agent headless connector service" -StartupType Automatic
Start-Service -Name $serviceName
Get-Service -Name $serviceName
