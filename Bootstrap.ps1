param(
  [ValidateSet('install','plan','stage')][string]$Mode='install',
  [string]$Root,
  [int]$GpuIndex=-1,
  [switch]$AcceptCpuWhisper,
  [switch]$Yes,
  [switch]$SkipImages,
  [switch]$SkipStt,
  [switch]$SkipTts,
  [string]$Models,
  [string]$Backend
)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Write-Host 'Lumicos Setup 0.2.3 - Windows 11 x64' -ForegroundColor Cyan
$hardwareFile=Join-Path $PSScriptRoot 'detected-hardware.json'
& (Join-Path $PSScriptRoot 'src\detect.ps1') -OutputPath $hardwareFile
$hardware=Get-Content -LiteralPath $hardwareFile -Raw | ConvertFrom-Json
Write-Host ("CPU: {0}`nRAM: {1} GiB`nOS: {2}" -f $hardware.cpu,$hardware.ramGiB,$hardware.os)
$hardware.gpus | Format-Table name,vramGiB,driver,memorySource
if($hardware.arch -ne 'X64' -or $hardware.build -lt 22000){throw 'Windows 11 x64 is required.'}

# Install folder: default C:\Lumicos (no prompt). Flag/env override. Fall back to %LOCALAPPDATA%\Lumicos if unwritable.
if(-not $Root){
  if($env:LUMICOS_ROOT){$Root=$env:LUMICOS_ROOT}
  else{
    $preferred='C:\Lumicos'
    $fallback=Join-Path $env:LOCALAPPDATA 'Lumicos'
    try{
      New-Item -ItemType Directory -Force -Path $preferred | Out-Null
      $probe=Join-Path $preferred '.lumicos-write-test'
      [IO.File]::WriteAllText($probe,'ok')
      Remove-Item -LiteralPath $probe -Force
      $Root=$preferred
    }catch{
      $Root=$fallback
      Write-Host ("Cannot create or write {0} ({1}). Falling back to {2}." -f $preferred,$_.Exception.Message,$Root) -ForegroundColor Yellow
      Write-Host ("สร้าง {0} ไม่ได้ — ใช้ {1} แทน" -f $preferred,$Root) -ForegroundColor Yellow
    }
  }
}

$catalog=Get-Content (Join-Path $PSScriptRoot 'catalog\downloads.json') -Raw | ConvertFrom-Json
$nodeDir=Join-Path $PSScriptRoot '.bootstrap'
$node=Join-Path $nodeDir 'node-v24.21.0-win-x64\node.exe'
if(-not (Test-Path -LiteralPath $node)){
 New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
 $zip=Join-Path $nodeDir 'node.zip';$partial=$zip+'.part'
 Write-Host 'Downloading private Node runtime from nodejs.org (no system installation).'
 Invoke-WebRequest -UseBasicParsing -Uri $catalog.node.url -OutFile $partial
 if((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $catalog.node.sha256){throw 'Node checksum mismatch'}
 Move-Item -LiteralPath $partial -Destination $zip -Force
 & (Join-Path $PSScriptRoot 'src\extract.ps1') -Archive $zip -Destination $nodeDir
}
$cli=Join-Path $PSScriptRoot 'src\cli.mjs'
$common=@('--root',$Root,'--hardware',$hardwareFile)
if($GpuIndex -ge 0){$common+=@('--gpu-index',[string]$GpuIndex)}
& $node $cli plan @common
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$plan=Get-Content (Join-Path $PSScriptRoot 'last-plan.json') -Raw | ConvertFrom-Json
if($plan.profile.errors.Count){throw ($plan.profile.errors -join '; ')}
if($Mode -eq 'plan'){exit 0}
# Interactive UX is exactly two Node screens (GPU backend + models). No further Bootstrap prompts.
$extra=@()
if($AcceptCpuWhisper){$extra+='--accept-cpu-whisper'}
if($Yes){$extra+='--yes'}
if($SkipImages){$extra+='--skip-images'}
if($SkipStt){$extra+='--skip-stt'}
if($SkipTts){$extra+='--skip-tts'}
if($Models){$extra+=@('--models',$Models)}
if($Backend){$extra+=@('--backend',$Backend)}
elseif($env:LUMICOS_BACKEND){$extra+=@('--backend',$env:LUMICOS_BACKEND)}
& $node $cli $Mode @common @extra
if($LASTEXITCODE -ne 0){throw 'Installation stopped. Re-run with the same folder to resume; see lumicos-install.json.'}
if($Mode -eq 'install'){Start-Process (Join-Path $Root 'MODELS.html')}
