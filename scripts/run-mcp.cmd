@echo off
setlocal
pushd "%~dp0.."

if not defined CONTINUITY_WORKSPACE set "CONTINUITY_WORKSPACE=%USERPROFILE%\Documents\ContinuityProjects"
if not defined CONTINUITY_STAGE_URL set "CONTINUITY_STAGE_URL=http://127.0.0.1:3000"
if not defined CHROME_PATH set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"

npx tsx mcp-server/index.ts
set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%