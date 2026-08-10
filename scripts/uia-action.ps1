param([Parameter(Mandatory=$true)][int]$ProcessId, [Parameter(Mandatory=$true)][ValidateSet('INVOKE','SET_VALUE','FOCUS')][string]$Action, [Parameter(Mandatory=$true)][string]$Element, [string]$Value)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
$process = Get-Process -Id $ProcessId -ErrorAction Stop
$root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
$byId = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $Element)
$target = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $byId)
if (-not $target) { $byName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Element); $target = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $byName) }
if (-not $target) { throw "UI Automation could not find '$Element'." }
if ($Action -eq 'INVOKE') {
  $pattern = $null
  if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { ([System.Windows.Automation.InvokePattern]$pattern).Invoke() }
  else { $target.SetFocus() }
} elseif ($Action -eq 'SET_VALUE') {
  $pattern = $null
  if (-not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { throw "'$Element' does not accept a value." }
  ([System.Windows.Automation.ValuePattern]$pattern).SetValue($Value)
} else { $target.SetFocus() }
@{ status='sent'; action=$Action; element=$Element } | ConvertTo-Json -Compress
