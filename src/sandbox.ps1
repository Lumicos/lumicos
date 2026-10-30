param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$rootFull=[IO.Path]::GetFullPath($Root)
$box=Join-Path $rootFull 'Lumicos-Sandbox'
$workspace=Join-Path $rootFull 'PersonalAI\workspace'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class LumicosInstallerContainer {
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string n,string d,string x,IntPtr c,uint count,out IntPtr sid);
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string n,out IntPtr sid);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern bool ConvertSidToStringSid(IntPtr sid,out string s);
 public static string Ensure(string n){IntPtr sid;int hr=CreateAppContainerProfile(n,"Lumicos","Lumicos skills",IntPtr.Zero,0,out sid);if(hr<0){hr=DeriveAppContainerSidFromAppContainerName(n,out sid);if(hr<0)throw new Exception("AppContainer creation failed");}string s;ConvertSidToStringSid(sid,out s);return s;}
}
'@
$hasher=[Security.Cryptography.SHA256]::Create()
$suffix=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($rootFull.ToLowerInvariant())))).Replace('-','').Substring(0,12)
$sid=[LumicosInstallerContainer]::Ensure("Lumicos.$suffix")
foreach($d in @('bin','home','home\AppData\Roaming','home\AppData\Local','runs','user-packages','site-packages')){New-Item -ItemType Directory -Force -Path (Join-Path $box $d) | Out-Null}
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
$csc=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /optimize+ /platform:x64 /target:exe "/out:$box\bin\LumicosSandbox.exe" "$box\setup\LumicosSandbox.cs"
if($LASTEXITCODE -ne 0){throw 'Sandbox compile failed'}
foreach($d in @('python','site-packages','runner','bin')){& icacls.exe (Join-Path $box $d) /grant "*${sid}:(OI)(CI)(RX)" /T /C /Q | Out-Null;if($LASTEXITCODE -ne 0){throw "ACL failed: $d"}}
foreach($d in @('home','runs','user-packages')){& icacls.exe (Join-Path $box $d) /grant "*${sid}:(OI)(CI)(M)" /T /C /Q | Out-Null;if($LASTEXITCODE -ne 0){throw "ACL failed: $d"}}
& icacls.exe $workspace /grant "*${sid}:(OI)(CI)(M)" /T /C /Q | Out-Null
if($LASTEXITCODE -ne 0){throw 'Workspace ACL failed'}
$config=@{sid=$sid;timeoutSeconds=120;maxTimeoutSeconds=270;memoryMb=4096;cpuPercent=75;processes=32;internet=$true} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $box 'sandbox.json'),$config,(New-Object Text.UTF8Encoding $false))
$test=Join-Path $box ('runs\install-'+[guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path "$test\tmp" -Force | Out-Null
[IO.File]::WriteAllText("$test\code.py","print('LUMICOS_SANDBOX_OK')",(New-Object Text.UTF8Encoding $false))
& "$box\bin\LumicosSandbox.exe" --sid $sid --exe "$box\python\python.exe" --cwd $workspace --timeout-ms 20000 --memory-mb 512 --cpu-percent 50 --procs 4 --net 0 --env "TEMP=$test\tmp" --env "TMP=$test\tmp" --env "HOME=$box\home" --env "USERPROFILE=$box\home" --env "LOCALAPPDATA=$box\home\AppData\Local" --env "APPDATA=$box\home\AppData\Roaming" --env 'PYTHONUTF8=1' -- -X utf8 "$box\runner\run.py" $test
if(-not (Test-Path "$test\stdout.txt") -or (Get-Content "$test\stdout.txt" -Raw) -notmatch 'LUMICOS_SANDBOX_OK'){throw 'AppContainer self-test failed; scripts will not be declared ready.'}
