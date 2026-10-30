$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force -Path (Join-Path $root '.build') | Out-Null
Add-Type -AssemblyName System.Drawing
# Convert the supplied logo to Windows icon format; retain the original PNG.
$source=[Drawing.Image]::FromFile((Join-Path $root 'assets\lumicos-logo.png'))
$bitmap=New-Object Drawing.Bitmap 256,256
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($source,0,0,256,256)
$stream=New-Object IO.MemoryStream
$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
$bytes=$stream.ToArray()
$file=[IO.File]::Create((Join-Path $root 'assets\lumicos.ico'))
$writer=New-Object IO.BinaryWriter $file
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1)
$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$bytes.Length);$writer.Write([uint32]22);$writer.Write($bytes)
$writer.Dispose();$stream.Dispose();$graphics.Dispose();$bitmap.Dispose();$source.Dispose()
& "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize+ /platform:x64 /target:exe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/win32icon:$root\assets\lumicos.ico" "/out:$root\.build\Lumicos-Setup.exe" (Join-Path $root 'src\SetupLauncher.cs')
if($LASTEXITCODE -ne 0){throw 'Lumicos launcher compilation failed'}
