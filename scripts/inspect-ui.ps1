param([string]$WindowTitle, [string]$Goal = '', [int]$Limit = 45)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
$ignored = @('node', 'conhost', 'textinputhost', 'shellexperiencehost', 'startmenuexperiencehost', 'searchhost', 'applicationframehost')
$stopWords = @('the', 'and', 'then', 'with', 'this', 'that', 'application', 'window', 'program', 'open', 'close', 'find', 'inspect', 'navigate', 'tab')
$tokens = $Goal.ToLowerInvariant().Split([char[]]' !"#$%&''()*+,-./:;<=>?@[\]^_`{|}~') | Where-Object { $_.Length -ge 3 -and $stopWords -notcontains $_ }
$windows = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) }
if ($WindowTitle) { $target = $windows | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" } | Select-Object -First 1; $selection = 'title match' }
else {
  $effectiveIgnored = $ignored
  if ($Goal -match '(?i)background|wallpaper|personalization|theme|display settings') { $effectiveIgnored = $ignored | Where-Object { $_ -ne 'applicationframehost' } }
  $candidates = $windows | Where-Object { $effectiveIgnored -notcontains $_.ProcessName.ToLowerInvariant() }; if (-not $candidates) { $candidates = $windows }
  $target = $candidates | ForEach-Object {
    $score = 0; $text = ($_.ProcessName + ' ' + $_.MainWindowTitle).ToLowerInvariant()
    foreach ($token in $tokens) { if ($text.Contains($token)) { $score += 100 } }
    if ($Goal -match '(?i)background|wallpaper|personalization|theme|display settings' -and $text -match 'settings') { $score += 250 }
    [PSCustomObject]@{ process = $_; score = $score }
  } | Sort-Object score -Descending | Select-Object -First 1 | ForEach-Object { $_.process }
  $selection = 'goal heuristic'
}
if (-not $target) { throw 'No visible application window was found.' }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($target.MainWindowHandle)
$rect = $root.Current.BoundingRectangle
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsControlElementProperty, $true)
$rawControls = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$controls = New-Object System.Collections.Generic.List[object]
foreach ($element in $rawControls) {
  if ($controls.Count -ge $Limit) { break }
  try {
    $current = $element.Current; $bounds = $current.BoundingRectangle
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
    $name = $current.Name; $id = $current.AutomationId
    if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($id)) { continue }
    $key = if (-not [string]::IsNullOrWhiteSpace($id)) { $id } else { $name }
    $controls.Add([PSCustomObject]@{ key=$key; name=$name; automationId=$id; type=$current.ControlType.ProgrammaticName; x=[Math]::Round(($bounds.X-$rect.X)/[Math]::Max($rect.Width,1),3); y=[Math]::Round(($bounds.Y-$rect.Y)/[Math]::Max($rect.Height,1),3); width=[Math]::Round($bounds.Width/[Math]::Max($rect.Width,1),3); height=[Math]::Round($bounds.Height/[Math]::Max($rect.Height,1),3) })
  } catch { }
}
@{ usable=($controls.Count -gt 0); window=@{ title=$target.MainWindowTitle; process=$target.ProcessName; pid=$target.Id; selection=$selection; width=[int]$rect.Width; height=[int]$rect.Height }; controls=@($controls) } | ConvertTo-Json -Depth 5 -Compress
