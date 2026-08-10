param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9-]+$')][string]$Page)
$ErrorActionPreference = 'Stop'
Start-Process -FilePath "ms-settings:$Page"
Start-Sleep -Milliseconds 1800
@{ status='started'; page=$Page } | ConvertTo-Json -Compress
