# Push UniverseInTouch to GitHub (do not commit tokens to git)
# Usage (in PowerShell, from repo root):
#   $env:GITHUB_TOKEN = "ghp_xxxx"   # paste token in YOUR terminal only
#   .\scripts\push-to-github.ps1

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

if (-not $env:GITHUB_TOKEN) {
  Write-Host "Set GITHUB_TOKEN first (do not paste tokens in chat):" -ForegroundColor Yellow
  Write-Host '  $env:GITHUB_TOKEN = "your_github_pat"' -ForegroundColor Cyan
  exit 1
}

$remote = "https://p20210454-source:$($env:GITHUB_TOKEN)@github.com/p20210454-source/UniverseInTouch.git"
Write-Host "Pushing main to p20210454-source/UniverseInTouch ..."
git -c credential.helper= push $remote HEAD:main --force
git remote set-url origin https://github.com/p20210454-source/UniverseInTouch.git
git branch -M main 2>$null
Write-Host "Done. Revoke the token if it was ever exposed." -ForegroundColor Green
