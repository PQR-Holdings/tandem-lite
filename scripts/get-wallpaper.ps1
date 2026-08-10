$ErrorActionPreference = 'Stop'
$desktop = Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop'
@{ path = [string]$desktop.WallPaper; style = [string]$desktop.WallpaperStyle } | ConvertTo-Json -Compress
