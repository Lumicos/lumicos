param([string]$OutputPath)
$ErrorActionPreference='Stop'
$os=Get-CimInstance Win32_OperatingSystem
$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
$adapters=@(Get-CimInstance Win32_VideoController)
$dxgi=@()
try{Add-Type -Path (Join-Path $PSScriptRoot 'DxgiMemory.cs');$dxgi=@([LumicosDxgi]::Read())}catch{Write-Warning 'DXGI unavailable; use registry/NVIDIA fallback.'}
$registry=@(Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | ForEach-Object {Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue})
$gpus=@($adapters | ForEach-Object {
 $a=$_;$entry=$registry | Where-Object {$_.MatchingDeviceId -and $a.PNPDeviceID.StartsWith($_.MatchingDeviceId,[StringComparison]::OrdinalIgnoreCase)} | Select-Object -First 1
 $bytes=$entry.'HardwareInformation.qwMemorySize'
 $native=$dxgi | Where-Object {$_.Name.Trim() -eq $a.Name.Trim()} | Select-Object -First 1
 if($native){$bytes=$native.DedicatedBytes}
 # Win32_VideoController.AdapterRAM is a 32-bit value and truncates large GPUs. Never use it for admission.
 [ordered]@{name=$a.Name;pnpId=$a.PNPDeviceID;driver=$a.DriverVersion;vramGiB=if($native -or $bytes){[math]::Round([double]$bytes/1GB,2)}else{$null};memorySource=if($native){'DXGI'}elseif($bytes){'registry-qword'}else{'unknown'}}
})
$cuda=$null
$smi=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if($smi){
 $raw=& $smi.Source 2>$null
 if(($raw -join ' ') -match 'CUDA Version:\s*([0-9.]+)'){$cuda=$Matches[1]}
 $rows=& $smi.Source --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null
 foreach($row in $rows){$parts=$row -split ',';foreach($g in $gpus){if($g.name -eq $parts[0].Trim()){$g.vramGiB=[math]::Round([double]$parts[1].Trim()/1024,2);$g.memorySource='nvidia-smi'}}}
}
$result=[ordered]@{os=$os.Caption;build=[int]$os.BuildNumber;arch=[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString();cpu=$cpu.Name;ramGiB=[math]::Round($os.TotalVisibleMemorySize/1MB,2);freeRamGiB=[math]::Round($os.FreePhysicalMemory/1MB,2);gpus=$gpus;cudaMax=$cuda;drives=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {[ordered]@{drive=$_.DeviceID;freeGiB=[math]::Round($_.FreeSpace/1GB,2)}});detectedAt=[DateTime]::UtcNow.ToString('o')}
$json=$result | ConvertTo-Json -Depth 6
if($OutputPath){[IO.File]::WriteAllText($OutputPath,$json,(New-Object Text.UTF8Encoding $false))}else{$json}
