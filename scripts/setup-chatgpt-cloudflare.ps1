$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envExample = Join-Path $repoRoot 'mcp-server\env.local.example'
$envLocal = Join-Path $repoRoot 'mcp-server\.env.local'

if (-not (Test-Path $envLocal)) {
  Copy-Item $envExample $envLocal
  Write-Host "Created mcp-server/.env.local from the example."
}

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  $pf86 = "${env:ProgramFiles(x86)}"
  $candidates = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe"
    "$pf86\cloudflared\cloudflared.exe"
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $cloudflared = Get-Item $candidate
      break
    }
  }
}

if (-not $cloudflared) {
  Write-Host "cloudflared is not installed yet."
  Write-Host "Install with:"
  Write-Host "  winget install --id Cloudflare.cloudflared -e"
  Write-Host ""
  Write-Host "Then rerun:"
  Write-Host "  npm run mcp:cloudflare:setup"
  exit 1
}

& $cloudflared.Source --version

Write-Host ""
Write-Host "Cloudflare Tunnel setup ready for ChatGPT Plus."
Write-Host ""
Write-Host "Terminal 1:"
Write-Host "  npm run mcp:http"
Write-Host ""
Write-Host "Terminal 2 (optional, for rendering):"
Write-Host "  npm run dev"
Write-Host ""
Write-Host "Terminal 3:"
Write-Host "  npm run mcp:cloudflare"
Write-Host ""
Write-Host "Use the https://....trycloudflare.com/mcp URL in ChatGPT connector settings."