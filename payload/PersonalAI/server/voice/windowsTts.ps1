param([ValidateSet('probe','speak')][string]$Mode='probe',[string]$InputPath,[string]$OutputPath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
function Await($Operation,[Type]$ResultType){
 $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1
 $task=$method.MakeGenericMethod($ResultType).Invoke($null,@($Operation));$task.GetAwaiter().GetResult()
}
$voices=@([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object {$_.Language -eq 'th-TH'})
$voice=$voices | Where-Object {$_.DisplayName -match '\bPattara\b'} | Select-Object -First 1
if($Mode -eq 'probe'){
 [pscustomobject]@{ready=($null -ne $voice);name=if($voice){$voice.DisplayName}else{$null};reason=if($voice){$null}else{'Microsoft Pattara is missing. Install Thai text-to-speech in Windows Settings > Language & region.'}} | ConvertTo-Json -Compress
 exit 0
}
if(-not $voice){throw 'Microsoft Pattara is missing. Install Thai text-to-speech in Windows Settings > Language & region.'}
$request=Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$synth=New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
try {
 $synth.Voice=$voice
 $synth.Options.SpeakingRate=[double]$request.speed
 $stream=Await ($synth.SynthesizeTextToStreamAsync([string]$request.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
 try {
  $reader=[Windows.Storage.Streams.DataReader]::new($stream)
  try {$null=Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]);$bytes=New-Object byte[] ([int]$stream.Size);$reader.ReadBytes($bytes);[IO.File]::WriteAllBytes($OutputPath,$bytes)} finally {$reader.Dispose()}
 } finally {$stream.Dispose()}
} finally {$synth.Dispose()}
