<#
.SYNOPSIS
Runs Encore for a phone on another device.

.DESCRIPTION
Starts a secure tunnel to the dev server, points the app at that tunnel, and
serves the app. The tunnel host name changes on every run, so the app needs the
new name before the browser asks for the room service. This script does both.

The tunnel carries the app and the room service on one host name, because a
browser refuses an http request from an https page. The dev server proxies the
room service paths to the local Supabase stack.

.EXAMPLE
./scripts/dev-tunnel.ps1
#>
param(
  [int]$Port = 5173,
  [int]$SupabasePort = 55421
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$logFile = Join-Path $env:temp 'encore-tunnel.log'

Write-Host 'Stopping any dev server for this project.' -ForegroundColor DarkGray
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*online-karaoke*' -and $_.CommandLine -like '*vite*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host 'Starting the tunnel.' -ForegroundColor DarkGray
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $env:temp "encore-tunnel-$stamp.log"
$errFile = Join-Path $env:temp "encore-tunnel-$stamp.err.log"
$tunnel = Start-Process -FilePath 'cloudflared' `
  -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate') `
  -RedirectStandardOutput $logFile -RedirectStandardError $errFile `
  -PassThru -WindowStyle Hidden

# The tunnel reports its host name on the error stream.
$url = $null
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  Start-Sleep -Seconds 1
  $found = @()
  foreach ($file in @($errFile, $logFile)) {
    if (Test-Path $file) {
      $found += Get-Content $file -ErrorAction SilentlyContinue |
        Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' |
        Select-Object -First 1
    }
  }
  if ($found.Count -gt 0) { $url = $found[0].Matches[0].Value; break }
}

if ($url -eq $null) {
  Write-Error 'The tunnel did not report a host name. Check that cloudflared is installed.'
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "Tunnel: $url" -ForegroundColor Green

$anon = ''
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -like 'VITE_SUPABASE_ANON_KEY=*' } | Select-Object -First 1
  if ($line) { $anon = $line -replace '^VITE_SUPABASE_ANON_KEY=', '' }
}
if ($anon -eq '') {
  Write-Error 'VITE_SUPABASE_ANON_KEY is missing from .env'
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

@(
  "VITE_SUPABASE_URL=$url"
  "VITE_SUPABASE_ANON_KEY=$anon"
) | ForEach-Object { $_ } | Out-File -FilePath $envFile -Encoding ascii -NoNewline:$false
# The environment file is read by the bundler, so it must not carry a byte
# order mark.
$content = (Get-Content $envFile -Raw).TrimStart([char]0xFEFF)
[System.IO.File]::WriteAllText($envFile, $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host 'Starting the dev server.' -ForegroundColor DarkGray
$env:VITE_DEV_ALLOWED_HOSTS = '.trycloudflare.com'
$env:VITE_DEV_SUPABASE_URL = "http://127.0.0.1:$SupabasePort"

Write-Host ''
Write-Host "Open $url on a phone, or http://192.168.100.2:$Port on this machine." -ForegroundColor Green
Write-Host ''

Push-Location $root
try {
  npm run dev -- --port $Port --host 0.0.0.0
} finally {
  Pop-Location
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
}
