param([Parameter(Mandatory=$true)][ValidatePattern('^https?://')][string]$Url)
$ErrorActionPreference = 'Stop'
Start-Process -FilePath $Url
Start-Sleep -Milliseconds 1400
@{ status = 'started'; url = $Url } | ConvertTo-Json -Compress
