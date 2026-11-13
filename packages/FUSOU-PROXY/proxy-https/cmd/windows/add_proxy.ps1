param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$PacUrl
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-Info {
    param([string]$Message)
    [Console]::Error.WriteLine("[INFO] $Message")
}

function Write-ErrorLine {
    param([string]$Message)
    [Console]::Error.WriteLine("[ERROR] $Message")
}

Write-Info "add_proxy.ps1 started"

if ([string]::IsNullOrWhiteSpace($PacUrl)) {
    Write-ErrorLine 'pac url is required.'
    exit 2
}

Write-Info "setting AutoConfigURL to `"$PacUrl`""

try {
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name 'AutoConfigURL' -Type String -Value $PacUrl
} catch {
    Write-ErrorLine "failed to set AutoConfigURL in registry: $($_.Exception.Message)"
    exit 1
}

Write-Info 'AutoConfigURL updated successfully.'
exit 0
