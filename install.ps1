# Lumicos one-line bootstrap (Windows PowerShell 5+)
# Usage (CMD / PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Lumicos/lumicos/main/install.ps1 | iex"
# Downloads the public main.zip, extracts under %TEMP%, runs Install.cmd interactively, cleans up on success.
# No admin elevation is requested by this script. Paths with spaces or Thai characters are supported via -LiteralPath.
# Requires: public GitHub access, Windows PowerShell, network for the ZIP and later installer downloads.

$ErrorActionPreference = 'Stop'

function Write-LumicosMsg {
  param([string]$Th, [string]$En, [string]$Color = 'Yellow')
  Write-Host $Th -ForegroundColor $Color
  Write-Host $En -ForegroundColor DarkYellow
}

function Fail {
  param([string]$Th, [string]$En, [int]$Code = 1)
  Write-LumicosMsg -Th $Th -En $En -Color 'Red'
  exit $Code
}

try {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch {
    # Older hosts may already negotiate TLS 1.2; continue.
  }

  $ts = Get-Date -Format 'yyyyMMddHHmmss'
  $workRoot = Join-Path $env:TEMP ("lumicos-" + $ts)
  $zipPath = Join-Path $env:TEMP ("lumicos-" + $ts + ".zip")
  $url = 'https://github.com/Lumicos/lumicos/archive/refs/heads/main.zip'

  Write-LumicosMsg -Th 'กำลังดาวน์โหลด Lumicos (main.zip)...' -En 'Downloading Lumicos (main.zip)...' -Color 'Cyan'
  try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  } catch {
    Fail -Th ("ดาวน์โหลดไม่สำเร็จ: " + $_.Exception.Message + " — ตรวจเน็ต / ว่า repo เป็น public") `
         -En ("Download failed: " + $_.Exception.Message + " — check network / that the repo is public")
  }

  if (-not (Test-Path -LiteralPath $zipPath)) {
    Fail -Th 'ไม่พบไฟล์ ZIP หลังดาวน์โหลด' -En 'ZIP file missing after download'
  }

  Write-LumicosMsg -Th 'กำลังแตกไฟล์...' -En 'Extracting archive...' -Color 'Cyan'
  New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
  try {
    Expand-Archive -LiteralPath $zipPath -DestinationPath $workRoot -Force
  } catch {
    Fail -Th ("แตก ZIP ไม่สำเร็จ: " + $_.Exception.Message) -En ("Extract failed: " + $_.Exception.Message)
  }

  $inner = Get-ChildItem -LiteralPath $workRoot -Directory | Select-Object -First 1
  if (-not $inner) {
    Fail -Th 'โฟลเดอร์หลังแตก ZIP ว่าง' -En 'Extracted archive has no top-level folder'
  }

  $installCmd = Join-Path $inner.FullName 'Install.cmd'
  if (-not (Test-Path -LiteralPath $installCmd)) {
    Fail -Th ("ไม่พบ Install.cmd ใน " + $inner.FullName) -En ("Install.cmd not found in " + $inner.FullName)
  }

  Write-LumicosMsg -Th 'เริ่มตัวติดตั้ง (คอนโซลโต้ตอบ)...' -En 'Starting interactive installer...' -Color 'Cyan'

  # Keep stdin/stdout/stderr attached to this console (no new window).
  Push-Location -LiteralPath $inner.FullName
  $exitCode = 0
  try {
    & cmd.exe /c "`"$installCmd`""
    if ($null -ne $LASTEXITCODE) { $exitCode = [int]$LASTEXITCODE }
  } finally {
    Pop-Location
  }

  if ($exitCode -ne 0) {
    Write-LumicosMsg -Th ("ติดตั้งล้มเหลว (รหัสออก $exitCode). เก็บไฟล์ชั่วคราวไว้ที่: $workRoot") `
                     -En ("Install failed (exit $exitCode). Temp kept at: $workRoot") `
                     -Color 'Red'
    exit $exitCode
  }

  Write-LumicosMsg -Th 'ติดตั้งสำเร็จ — กำลังลบไฟล์ชั่วคราว...' -En 'Install succeeded — cleaning temp files...' -Color 'Green'
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
  Write-LumicosMsg -Th 'เสร็จแล้ว' -En 'Done.' -Color 'Green'
}
catch {
  Fail -Th ("ข้อผิดพลาด: " + $_.Exception.Message) -En ("Error: " + $_.Exception.Message)
}
