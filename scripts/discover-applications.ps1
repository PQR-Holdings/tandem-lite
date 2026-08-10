param([string]$Query = '', [int]$Limit = 24)
$ErrorActionPreference = 'Stop'
$stopWords = @('open', 'launch', 'start', 'the', 'and', 'then', 'with', 'application', 'app', 'navigate', 'visit', 'browser', 'to')
$tokens = $Query.ToLowerInvariant().Split([char[]]' !"#$%&''()*+,-./:;<=>?@[\]^_`{|}~') | Where-Object { $_.Length -ge 3 -and $stopWords -notcontains $_ }
$appNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
Get-StartApps | ForEach-Object { if (-not [string]::IsNullOrWhiteSpace($_.Name)) { [void]$appNames.Add($_.Name) } }
$appPathRoots = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths')
foreach ($root in $appPathRoots) {
  if (Test-Path $root) { Get-ChildItem $root | ForEach-Object { [void]$appNames.Add(($_.PSChildName -replace '\.exe$', '')) } }
}
$ranked = foreach ($appName in $appNames) {
  $name = $appName.ToLowerInvariant(); $score = 0
  foreach ($token in $tokens) { if ($name.Contains($token)) { $score += 100 } }
  [PSCustomObject]@{ name = $appName; score = $score }
}
$matches = if ($tokens.Count -gt 0) { $ranked | Where-Object { $_.score -gt 0 } } else { $ranked }
$selected = @($matches | Sort-Object @{ Expression = 'score'; Descending = $true }, @{ Expression = 'name'; Descending = $false } | Select-Object -First ([Math]::Min([Math]::Max($Limit, 1), 50)) | ForEach-Object { $_.name })
ConvertTo-Json -InputObject $selected -Compress
