param([Parameter(Mandatory=$true)][string]$Application)
$ErrorActionPreference = 'Stop'
$normalizedApplication = ($Application -replace '[^a-z0-9]', '').ToLowerInvariant()
if ($normalizedApplication -match 'settings') {
  Start-Process -FilePath 'ms-settings:'
  Start-Sleep -Milliseconds 1800
  @{ status = 'started'; application = 'Windows Settings' } | ConvertTo-Json -Compress
  exit
}
$apps = @(Get-StartApps)
$match = $apps | Where-Object { $_.Name -ieq $Application } | Select-Object -First 1
if (-not $match) { $match = $apps | Where-Object { $_.Name -like "*$Application*" } | Select-Object -First 1 }
$appPathRoots = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths')
if ($match) {
  Start-Process -FilePath 'explorer.exe' -ArgumentList "shell:AppsFolder\$($match.AppID)"
  $launchedName = $match.Name
} else {
  $appPath = $null
  foreach ($root in $appPathRoots) {
    if (-not (Test-Path $root)) { continue }
    $appPath = Get-ChildItem $root | Where-Object { $_.PSChildName -ieq $Application -or $_.PSChildName -ieq "$Application.exe" -or $_.PSChildName -like "*$Application*" } | Select-Object -First 1
    if ($appPath) { break }
  }
  if ($appPath) {
    $executable = $appPath.GetValue('')
    if (-not $executable -or -not (Test-Path $executable)) { throw "Registered application '$Application' has no valid executable." }
    Start-Process -FilePath $executable
    $launchedName = $appPath.PSChildName
  } else {
    $command = Get-Command $Application -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command "$Application.exe" -CommandType Application -ErrorAction SilentlyContinue }
    if (-not $command) { throw "No installed application matches '$Application'." }
    Start-Process -FilePath $command.Source
    $launchedName = $command.Name
  }
}
Start-Sleep -Milliseconds 1400
@{ status = 'started'; application = $launchedName } | ConvertTo-Json -Compress
