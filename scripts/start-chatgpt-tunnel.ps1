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

$healthAddr = '127.0.0.1:8080'
$healthUrl = "http://$healthAddr"
$portInUse = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue

if ($portInUse) {
  try {
    $ready = Invoke-WebRequest -Uri "$healthUrl/readyz" -UseBasicParsing -TimeoutSec 2
    if ($ready.Content -eq 'ready') {
      Write-Host "Continuity Stage MCP tunnel is already running."
      Write-Host "Health UI: $healthUrl/ui"
      Write-Host "Status: ready (MCP probe ok)"
      Write-Host ""
      Write-Host "Only one tunnel can use port 8080. Keep the existing terminal open,"
      Write-Host "or stop it with Ctrl+C there before starting a new one."
      exit 0
    }
  } catch {
    # Fall through and try to start; tunnel-client will report the bind error.
  }

  $ownerPid = ($portInUse | Select-Object -First 1).OwningProcess
  $owner = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  $ownerName = if ($owner) { $owner.ProcessName } else { "PID $ownerPid" }
  Write-Host "Port 8080 is already in use by $ownerName."
  Write-Host "Stop that process or close the other tunnel terminal, then rerun:"
  Write-Host "  npm run mcp:tunnel"
  exit 1
}

Write-Host "Starting Continuity Stage MCP tunnel..."
Write-Host "Health UI: $healthUrl/ui"
Write-Host "Keep this terminal open while using ChatGPT."
Write-Host "For rendering, also run: npm run dev"
Write-Host ""

& $tunnelClient run --profile continuity-stage --profile-dir $profileDir