$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envLocal = Join-Path $repoRoot 'mcp-server\.env.local'
$profileDir = Join-Path $repoRoot 'mcp-server\tunnel-profiles'
$tunnelClient = Join-Path $repoRoot 'tunnel-client.exe'

if (-not (Test-Path $tunnelClient)) {
  $onPath = Get-Command tunnel-client -ErrorAction SilentlyContinue
  if ($onPath) {
    $tunnelClient = $onPath.Source
  } else {
    throw "tunnel-client.exe not found."
  }
}

if (-not (Test-Path $envLocal)) {
  throw "Missing mcp-server/.env.local. Run: npm run mcp:tunnel:setup"
}

Get-Content $envLocal | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $parts = $line -split '=', 2
  if ($parts.Count -ne 2) { return }
  $name = $parts[0].Trim()
  $value = $parts[1].Trim()
  Set-Item -Path "Env:$name" -Value $value
}

if (-not $env:CONTINUITY_WORKSPACE) {
  $env:CONTINUITY_WORKSPACE = Join-Path $env:USERPROFILE 'Documents\ContinuityProjects'
}
if (-not $env:CONTINUITY_STAGE_URL) {
  $env:CONTINUITY_STAGE_URL = 'http://127.0.0.1:3000'
}
if (-not $env:CHROME_PATH) {
  $env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
}

Write-Host "Starting Continuity Stage MCP tunnel..."
Write-Host "Health UI: http://127.0.0.1:8080/ui"
Write-Host "Keep this terminal open while using ChatGPT."
Write-Host "For rendering, also run: npm run dev"
Write-Host ""

& $tunnelClient run --profile continuity-stage --profile-dir $profileDir