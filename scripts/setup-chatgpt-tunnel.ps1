param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envLocal = Join-Path $repoRoot 'mcp-server\.env.local'
$envExample = Join-Path $repoRoot 'mcp-server\env.local.example'
$profileDir = Join-Path $repoRoot 'mcp-server\tunnel-profiles'
$tunnelClient = Join-Path $repoRoot 'tunnel-client.exe'
$writeProfileScript = Join-Path $repoRoot 'scripts\write-tunnel-profile.ps1'

if (-not (Test-Path $tunnelClient)) {
  $onPath = Get-Command tunnel-client -ErrorAction SilentlyContinue
  if ($onPath) {
    $tunnelClient = $onPath.Source
  } else {
    throw "tunnel-client.exe not found. Download it from https://platform.openai.com/settings/organization/tunnels and place it in the repo root, or add it to PATH."
  }
}

if (-not (Test-Path $envLocal)) {
  Copy-Item $envExample $envLocal
  Write-Host "Created mcp-server/.env.local from the example."
  Write-Host "Edit that file with your CONTROL_PLANE_API_KEY and CONTROL_PLANE_TUNNEL_ID, then rerun:"
  Write-Host "  npm run mcp:tunnel:setup"
  exit 1
}

$envMap = @{}
Get-Content $envLocal | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $parts = $line -split '=', 2
  if ($parts.Count -ne 2) { return }
  $envMap[$parts[0].Trim()] = $parts[1].Trim()
}

$apiKey = $envMap['CONTROL_PLANE_API_KEY']
$tunnelId = $envMap['CONTROL_PLANE_TUNNEL_ID']

if (-not $apiKey -or $apiKey -match '\.\.\.|your_|example|0123456789') {
  throw "Set a real CONTROL_PLANE_API_KEY in mcp-server/.env.local"
}
if (-not $tunnelId -or $tunnelId -notmatch '^tunnel_[0-9a-f]{32}$') {
  throw "Set a real CONTROL_PLANE_TUNNEL_ID in mcp-server/.env.local (format: tunnel_ + 32 lowercase hex chars)"
}

$workspace = $envMap['CONTINUITY_WORKSPACE']
if (-not $workspace) {
  $workspace = Join-Path $env:USERPROFILE 'Documents\ContinuityProjects'
}
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

# tunnel-client splits stdio commands on spaces at runtime, so use a launcher
# in the user profile directory (no spaces in path).
& pwsh -NoProfile -File $writeProfileScript -RepoRoot $repoRoot -TunnelId $tunnelId -ProfileDir $profileDir

$env:CONTROL_PLANE_API_KEY = $apiKey
$env:CONTROL_PLANE_TUNNEL_ID = $tunnelId
if ($envMap['CONTINUITY_WORKSPACE']) { $env:CONTINUITY_WORKSPACE = $envMap['CONTINUITY_WORKSPACE'] }
if ($envMap['CONTINUITY_STAGE_URL']) { $env:CONTINUITY_STAGE_URL = $envMap['CONTINUITY_STAGE_URL'] }
if ($envMap['CHROME_PATH']) { $env:CHROME_PATH = $envMap['CHROME_PATH'] }

& $tunnelClient doctor --profile continuity-stage --profile-dir $profileDir --explain

Write-Host ""
Write-Host "ChatGPT tunnel profile installed."
Write-Host "Start it with: npm run mcp:tunnel"
Write-Host ""
Write-Host "Secure MCP Tunnel is running and linked to Platform org $tunnelId."
Write-Host "Use it with Codex, Responses API, or other OpenAI products that accept Platform-org tunnels."
Write-Host ""
Write-Host "ChatGPT Apps on Plus (personal account):"
Write-Host "  Secure MCP Tunnel usually will NOT appear in the ChatGPT Apps tunnel picker."
Write-Host "  Plus accounts are not ChatGPT workspaces; Platform org != ChatGPT workspace."
Write-Host "  For ChatGPT Apps development on Plus, expose HTTP MCP via ngrok/Cloudflare Tunnel instead:"
Write-Host "    npm run mcp:http"
Write-Host "    ngrok http 8787"
Write-Host "    Connector URL: https://<your-ngrok-host>/mcp"
Write-Host ""
Write-Host "ChatGPT Business/Enterprise:"
Write-Host "  Create the tunnel with your ChatGPT workspace ID in Platform Tunnels, then:"
Write-Host "  https://chatgpt.com/#settings/Connectors -> Connection type: Tunnel -> $tunnelId"