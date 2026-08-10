$ErrorActionPreference = 'Stop'
try {
  $process = Start-Process -FilePath 'wt.exe' -PassThru
  Start-Sleep -Milliseconds 900
  @{ status = 'started'; program = 'Windows Terminal'; pid = $process.Id } | ConvertTo-Json -Compress
} catch {
  $process = Start-Process -FilePath 'powershell.exe' -PassThru
  Start-Sleep -Milliseconds 700
  @{ status = 'started'; program = 'Windows PowerShell'; pid = $process.Id } | ConvertTo-Json -Compress
}
