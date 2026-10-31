param([ValidateSet('install','plan','stage')][string]$Mode='install',[string]$Root,[int]$GpuIndex=-1,[switch]$AcceptCpuWhisper,[switch]$Yes,[switch]$SkipImages,[switch]$SkipStt,[switch]$SkipTts,[string]$Models)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Write-Host 'Lumicos Setup 0.2.3 - Windows 11 x64' -ForegroundColor Cyan
$hardwareFile=Join-Path $PSScriptRoot 'detected-hardware.json'
& (Join-Path $PSScriptRoot 'src\detect.ps1') -OutputPath $hardwareFile
$hardware=Get-Content -LiteralPath $hardwareFile -Raw | ConvertFrom-Json
Write-Host ("CPU: {0}`nRAM: {1} GiB`nOS: {2}" -f $hardware.cpu,$hardware.ramGiB,$hardware.os)
$hardware.gpus | Format-Table name,vramGiB,driver,memorySource
if($hardware.arch -ne 'X64' -or $hardware.build -lt 22000){throw 'Windows 11 x64 is required.'}
if(-not $Root){$default=Join-Path $env:LOCALAPPDATA 'Lumicos';$answer=Read-Host "Install folder [default: $default]";$Root=if($answer){$answer}else{$default}}
if($hardware.gpus.Count -gt 1 -and $GpuIndex -lt 0 -and -not $Yes){
 for($i=0;$i -lt $hardware.gpus.Count;$i++){Write-Host "$i : $($hardware.gpus[$i].name)"}
 $answer=Read-Host 'GPU index (blank = recommended)';if($answer){$GpuIndex=[int]$answer}
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
if($Mode -eq 'install' -and -not $SkipStt -and $plan.profile.voice -and $plan.profile.whisper -eq 'whisper-cpu' -and -not $AcceptCpuWhisper){
 $answer=Read-Host 'This profile uses CPU Whisper (not GPU). Accept this fallback? Type YES';if($answer -ne 'YES'){throw 'CPU Whisper fallback was not accepted'};$AcceptCpuWhisper=$true
}
$extra=@();if($AcceptCpuWhisper){$extra+='--accept-cpu-whisper'};if($Yes){$extra+='--yes'};if($SkipImages){$extra+='--skip-images'};if($SkipStt){$extra+='--skip-stt'};if($SkipTts){$extra+='--skip-tts'};if($Models){$extra+=@('--models',$Models)}
& $node $cli $Mode @common @extra
if($LASTEXITCODE -ne 0){throw 'Installation stopped. Re-run with the same folder to resume; see lumicos-install.json.'}
if($Mode -eq 'install'){Start-Process (Join-Path $Root 'MODELS.html')}
