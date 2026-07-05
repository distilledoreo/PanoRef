param(
  [int]$McpPort = $(if ($env:MCP_HTTP_PORT) { [int]$env:MCP_HTTP_PORT } else { 8787 }),
  [switch]$SkipMcpCheck
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envLocal = Join-Path $repoRoot 'mcp-server\.env.local'
$connectorUrlFile = Join-Path $repoRoot 'mcp-server\.connector-url'

function Resolve-Cloudflared {
  $onPath = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }

  $pf86 = "${env:ProgramFiles(x86)}"
  $candidates = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe"
    "$pf86\cloudflared\cloudflared.exe"
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  throw @"
cloudflared not found.

Install it, then rerun:
  winget install --id Cloudflare.cloudflared -e
  npm run mcp:cloudflare

Or download from:
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
"@
}

function Test-McpHttpReady([int]$Port) {
  $probe = @{
    jsonrpc = '2.0'
    id      = 1
    method  = 'initialize'
    params  = @{
      protocolVersion = '2025-06-18'
      capabilities    = @{}
      clientInfo      = @{ name = 'probe'; version = '1.0' }
    }
  }
  $body = $probe | ConvertTo-Json -Compress
  $headers = @{
    Accept = 'application/json, text/event-stream'
  }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/mcp" -Method POST `
      -ContentType 'application/json' -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    return $status -ge 200 -and $status -lt 500
  }
}

if (Test-Path $envLocal) {
  Get-Content $envLocal | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $parts = $line -split '=', 2
    if ($parts.Count -ne 2) { return }
    Set-Item -Path "Env:$($parts[0].Trim())" -Value $parts[1].Trim()
  }
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

if (-not $SkipMcpCheck -and -not (Test-McpHttpReady $McpPort)) {
  Write-Host "MCP HTTP server is not responding on http://127.0.0.1:$McpPort/mcp"
  Write-Host "Start it in another terminal first:"
  Write-Host "  npm run mcp:http"
  Write-Host ""
  Write-Host "For rendering tools, also run:"
  Write-Host "  npm run dev"
  exit 1
}

$cloudflared = Resolve-Cloudflared
$mcpUrl = "http://127.0.0.1:$McpPort"

Write-Host ""
Write-Host "=== Starting Cloudflare quick tunnel to $mcpUrl ==="
Write-Host ""

$tunnelUrl = $null

$job = Start-Job -Name cloudflared-tunnel -ScriptBlock {
  param($exe, $url)
  & $exe tunnel --url $url 2>&1
} -ArgumentList $cloudflared, $mcpUrl

while ($tunnelUrl -eq $null) {
  Start-Sleep -Milliseconds 200
  $lines = Receive-Job -Job $job -Keep
  foreach ($line in $lines) {
    $text = $line.ToString()
    if ($text -match 'https://([a-zA-Z0-9_-]+)\.trycloudflare\.com') {
      $tunnelUrl = $matches[0]
      break
    }
  }
  if ($job.State -eq 'Failed' -or $job.State -eq 'Completed') {
    $output = Receive-Job -Job $job
    Write-Host $output
    throw "Cloudflare tunnel failed to start. See output above."
  }
}

$connectorUrl = "$tunnelUrl/mcp"
$connectorUrl | Out-File -FilePath $connectorUrlFile -Encoding UTF8 -Force

Write-Host @"

  ╔══════════════════════════════════════════════════════════╗
  ║              CHATGPT CONNECTOR URL                       ║
  ║                                                          ║
  ║  $connectorUrl
  ║                                                          ║
  ║  (copied to mcp-server/.connector-url — open that file)   ║
  ╚══════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

Write-Host "In ChatGPT (Plus):"
Write-Host "  1. Enable Developer mode: https://chatgpt.com/#settings/Connectors/Advanced"
Write-Host "  2. Create connector: https://chatgpt.com/#settings/Connectors"
Write-Host "     Connection type: URL (not Tunnel)"
Write-Host "     Connector URL: PASTE THE URL ABOVE (includes /mcp)"
Write-Host "     Authentication: No Authentication"
Write-Host ""

Write-Host "Tunnel health: http://127.0.0.1:8080/readyz"
Write-Host "For rendering, also run: npm run dev"
Write-Host ""
Write-Host "Keep this terminal open. Press Ctrl+C to stop the tunnel."
Write-Host ""

# Stream cloudflared output to console in real-time
try {
  while ($true) {
    Start-Sleep -Milliseconds 200
    $lines = Receive-Job -Job $job
    foreach ($line in $lines) {
      Write-Host $line.ToString()
    }
    if ($job.State -ne 'Running') { break }
  }
  $lines = Receive-Job -Job $job
  foreach ($line in $lines) {
    Write-Host $line.ToString()
  }
}
finally {
  Remove-Item -Path $connectorUrlFile -ErrorAction SilentlyContinue
  Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
}