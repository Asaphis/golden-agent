param(
  [string]$ProjectPath = "$HOME\golden-agent"
)

$ErrorActionPreference = "Stop"
$serviceName = "GoldenAgentConnector"
$node = (Get-Command node).Source
$entry = Join-Path $ProjectPath "apps\connector\src\main.ts"

Write-Host "Install the connector dependencies first with: pnpm install"
Write-Host "For production packaging, install the built standalone connector executable as $serviceName."
Write-Host "Development command: pnpm dev:connector service"
Write-Host "The production installer must run under a least-privilege service account and restrict allowed roots explicitly."
Write-Host "Node runtime: $node"
Write-Host "Connector entry: $entry"
