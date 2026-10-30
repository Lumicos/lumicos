param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$file=Join-Path $Root 'run-state.json'
if(-not (Test-Path -LiteralPath $file)){Write-Host 'No owned process record.';exit 0}
$state=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
foreach($entry in @($state.processes | Sort-Object name -Descending)){
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.pid)" -ErrorAction SilentlyContinue
 if(-not $p){continue}
 $ticks=$p.CreationDate.ToUniversalTime().Ticks.ToString()
 if($p.ExecutablePath -ne (Join-Path $Root 'runtime\node\node.exe') -or $ticks -ne $entry.createdTicks){throw 'Process identity changed; refusing to stop it.'}
 & taskkill.exe /PID $entry.pid /T /F
}
