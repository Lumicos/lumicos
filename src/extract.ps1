param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath($Destination).TrimEnd('\')+'\'
$z=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
 foreach($entry in $z.Entries){
  if($entry.FullName -match '(^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$)|:)'){throw 'Unsafe ZIP member'}
  $target=[IO.Path]::GetFullPath((Join-Path $root $entry.FullName))
  if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'ZIP escapes destination'}
  $parent=[IO.Path]::GetDirectoryName($target)
  if($parent){[IO.Directory]::CreateDirectory($parent) | Out-Null}
  if($entry.Name){[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)}
 }
}finally{$z.Dispose()}
