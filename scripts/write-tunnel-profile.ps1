param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$TunnelId,
  [string]$ProfileDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path 'mcp-server\tunnel-profiles'),
  [string]$LauncherPath = (Join-Path $env:USERPROFILE 'continuity-stage-mcp.cmd')
)

$ErrorActionPreference = 'Stop'

if (-not $TunnelId) {
  throw 'TunnelId is required.'
}

$launcherContent = @"
@echo off
setlocal
pushd "$RepoRoot"

if not defined CONTINUITY_WORKSPACE set "CONTINUITY_WORKSPACE=%USERPROFILE%\Documents\ContinuityProjects"
if not defined CONTINUITY_STAGE_URL set "CONTINUITY_STAGE_URL=http://127.0.0.1:3000"
if not defined CHROME_PATH set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"

npx tsx mcp-server/index.ts
set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%
"@

Set-Content -Path $LauncherPath -Value $launcherContent -Encoding ASCII
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

$launcherForYaml = ($LauncherPath -replace '\\', '/')
$profilePath = Join-Path $ProfileDir 'continuity-stage.yaml'
$profileContent = @"
config_version: 1
control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "$TunnelId"
  api_key: "env:CONTROL_PLANE_API_KEY"
health:
  listen_addr: "127.0.0.1:8080"
admin_ui:
  open_browser: false
log:
  level: info
  format: json
mcp:
  commands:
    - channel: main
      command: "$launcherForYaml"
"@

Set-Content -Path $profilePath -Value $profileContent -Encoding UTF8

Write-Output $profilePath
Write-Output $LauncherPath