param([string]$WindowTitle, [int]$ProcessId, [ValidateSet('CLICK','DOUBLE_CLICK','DRAG','SCROLL')][string]$Action, [double]$X, [double]$Y, [double]$X2, [double]$Y2, [int]$Delta, [string]$Key, [string]$Sequence, [string]$Text, [int]$HoldMs = 120)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ComputerInput {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
 public const uint KEYUP = 2;
 public const uint LEFTDOWN = 2; public const uint LEFTUP = 4; public const uint WHEEL = 0x0800;
 public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
if ($ProcessId) { $target = Get-Process -Id $ProcessId -ErrorAction Stop }
elseif ($WindowTitle) { $target = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$WindowTitle*" } | Select-Object -First 1 }
else { throw 'Specify ProcessId or WindowTitle.' }
if (-not $target -or $target.MainWindowHandle -eq 0) { throw 'Selected process has no visible window.' }
[ComputerInput]::ShowWindow($target.MainWindowHandle, 9) | Out-Null
[ComputerInput]::SetForegroundWindow($target.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 80
if ([ComputerInput]::GetForegroundWindow() -ne $target.MainWindowHandle) { throw "Windows did not grant focus to '$($target.MainWindowTitle)'; no input was sent." }
if ($Action) {
  $rect = New-Object ComputerInput+RECT
  if (-not [ComputerInput]::GetWindowRect($target.MainWindowHandle, [ref]$rect)) { throw 'Could not determine selected window bounds.' }
  $toPoint = {
    param([double]$Horizontal, [double]$Vertical)
    $px = $rect.Left + [int][Math]::Round(($rect.Right - $rect.Left) * $Horizontal)
    $py = $rect.Top + [int][Math]::Round(($rect.Bottom - $rect.Top) * $Vertical)
    return @($px, $py)
  }
  if ($Action -eq 'SCROLL') {
    $wheelData = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]($Delta * 120)), 0)
    [ComputerInput]::mouse_event([ComputerInput]::WHEEL, 0, 0, $wheelData, [UIntPtr]::Zero)
  } else {
    $point = & $toPoint $X $Y; [ComputerInput]::SetCursorPos($point[0], $point[1]) | Out-Null
    if ($Action -eq 'CLICK' -or $Action -eq 'DOUBLE_CLICK') {
      $clickCount = if ($Action -eq 'DOUBLE_CLICK') { 2 } else { 1 }
      for ($i = 0; $i -lt $clickCount; $i++) { [ComputerInput]::mouse_event([ComputerInput]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero); [ComputerInput]::mouse_event([ComputerInput]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 70 }
    } else {
      [ComputerInput]::mouse_event([ComputerInput]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      $endPoint = & $toPoint $X2 $Y2; [ComputerInput]::SetCursorPos($endPoint[0], $endPoint[1]) | Out-Null
      Start-Sleep -Milliseconds 100
      [ComputerInput]::mouse_event([ComputerInput]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
  @{ status='sent'; action=$Action } | ConvertTo-Json -Compress
  exit
}
if ($Text) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait($Text)
  @{ status='sent'; textLength=$Text.Length } | ConvertTo-Json -Compress
  exit
}
$codes = @{ 'ALT'=0x12; 'CTRL'=0x11; 'F4'=0x73; 'ENTER'=0x0D; 'ESC'=0x1B; 'TAB'=0x09; 'SPACE'=0x20; 'BACKTICK'=0xC0 }
$keys = if ($Sequence) { $Sequence.Split('+') } elseif ($Key) { @($Key) } else { throw 'Specify Key, Sequence, or Text.' }
$pressed = @()
foreach ($entry in $keys) {
  $name = $entry.Trim().ToUpperInvariant()
  $code = if ($codes.ContainsKey($name)) { [byte]$codes[$name] } else { [byte][char]$name }
  [ComputerInput]::keybd_event($code, 0, 0, [UIntPtr]::Zero)
  $pressed += $code
}
Start-Sleep -Milliseconds ([Math]::Min([Math]::Max($HoldMs, 20), 1000))
for ($i = $pressed.Count - 1; $i -ge 0; $i--) { [ComputerInput]::keybd_event($pressed[$i], 0, [ComputerInput]::KEYUP, [UIntPtr]::Zero) }
@{ status='sent'; keys=$keys; holdMs=$HoldMs } | ConvertTo-Json -Compress

