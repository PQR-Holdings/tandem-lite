param([string]$WindowTitle, [Parameter(Mandatory=$true)][string]$OutputPath, [string]$Goal = '', [int]$MaxWidth = 1280)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WindowCapture {
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
 public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
$windows = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) }
if ($WindowTitle) {
  $target = $windows | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" } | Select-Object -First 1
  if (-not $target) { throw "No visible window matches '$WindowTitle'." }
  $selection = 'title match'
} else {
  # These are shell/input surfaces, not user task windows.
  $ignoredProcesses = @('node', 'conhost', 'textinputhost', 'shellexperiencehost', 'startmenuexperiencehost', 'searchhost', 'applicationframehost')
  if ($Goal -match '(?i)background|wallpaper|personalization|theme|display settings') { $ignoredProcesses = $ignoredProcesses | Where-Object { $_ -ne 'applicationframehost' } }
  $candidates = $windows | Where-Object { $ignoredProcesses -notcontains $_.ProcessName.ToLowerInvariant() }
  if (-not $candidates) { $candidates = $windows }
  $stopWords = @('the', 'and', 'then', 'with', 'this', 'that', 'application', 'window', 'program', 'close', 'open', 'inspect', 'please', 'stop')
  $tokens = $Goal.ToLowerInvariant().Split([char[]]' !"#$%&''()*+,-./:;<=>?@[\]^_`{|}~') | Where-Object { $_.Length -ge 3 -and $stopWords -notcontains $_ }
  $scored = foreach ($candidate in $candidates) {
    $rectForScore = New-Object WindowCapture+RECT
    [WindowCapture]::GetWindowRect($candidate.MainWindowHandle, [ref]$rectForScore) | Out-Null
    $area = [Math]::Max(0, $rectForScore.Right - $rectForScore.Left) * [Math]::Max(0, $rectForScore.Bottom - $rectForScore.Top)
    $haystack = ($candidate.ProcessName + ' ' + $candidate.MainWindowTitle).ToLowerInvariant()
    $score = $area / 10000000.0
    foreach ($token in $tokens) { if ($haystack.Contains($token)) { $score += 100 } }
    if ($Goal -match '(?i)background|wallpaper|personalization|theme|display settings' -and $haystack -match 'settings') { $score += 250 }
    [PSCustomObject]@{ Process=$candidate; Score=$score; Area=$area }
  }
  $target = ($scored | Sort-Object @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'Area'; Descending = $true } | Select-Object -First 1).Process
  if (-not $target) { throw 'No visible application window was found.' }
  $selection = 'goal/size heuristic'
}
$rect = New-Object WindowCapture+RECT
if (-not [WindowCapture]::GetWindowRect($target.MainWindowHandle, [ref]$rect)) { throw 'Could not read window bounds.' }
$width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw 'Target window has invalid bounds.' }
$dir = Split-Path -Parent $OutputPath
if ($dir) { New-Item -ItemType Directory -Force -Path $dir -ErrorAction Stop | Out-Null }
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$outputBitmap = $bitmap
if ($MaxWidth -gt 0 -and $width -gt $MaxWidth) {
  $scaledHeight = [int][Math]::Round($height * ($MaxWidth / $width))
  $outputBitmap = New-Object System.Drawing.Bitmap $MaxWidth, $scaledHeight
  $scaledGraphics = [System.Drawing.Graphics]::FromImage($outputBitmap)
  $scaledGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scaledGraphics.DrawImage($bitmap, 0, 0, $MaxWidth, $scaledHeight)
  $scaledGraphics.Dispose()
}
$outputBitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$outputWidth = $outputBitmap.Width; $outputHeight = $outputBitmap.Height
if ($outputBitmap -ne $bitmap) { $outputBitmap.Dispose() }
$graphics.Dispose(); $bitmap.Dispose()
if (-not (Test-Path -LiteralPath $OutputPath)) { throw "Capture did not create '$OutputPath'." }
@{ title=$target.MainWindowTitle; process=$target.ProcessName; pid=$target.Id; selection=$selection; width=$outputWidth; height=$outputHeight } | ConvertTo-Json -Compress
