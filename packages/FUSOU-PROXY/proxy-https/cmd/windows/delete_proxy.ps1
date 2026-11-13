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

Write-Info "delete_proxy.ps1 started"

$registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'

try {
    $value = Get-ItemProperty -Path $registryPath -Name 'AutoConfigURL' -ErrorAction Stop
} catch {
    Write-Info 'AutoConfigURL does not exist. nothing to delete.'
    exit 0
}

try {
    Remove-ItemProperty -Path $registryPath -Name 'AutoConfigURL' -ErrorAction Stop
} catch {
    Write-ErrorLine "failed to delete AutoConfigURL from registry: $($_.Exception.Message)"
    exit 1
}

Write-Info 'AutoConfigURL deleted successfully.'
exit 0
