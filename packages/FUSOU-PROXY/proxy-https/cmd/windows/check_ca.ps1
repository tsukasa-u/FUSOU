param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$CertificatePath
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

Write-Info "check_ca.ps1 started"

if ([string]::IsNullOrWhiteSpace($CertificatePath)) {
    Write-ErrorLine 'certificate path is required.'
    exit 2
}

try {
    $resolvedPath = (Resolve-Path -LiteralPath $CertificatePath).Path
} catch {
    Write-ErrorLine "certificate file not found: `"$CertificatePath`""
    exit 3
}

if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
    Write-ErrorLine "certificate file not found: `"$resolvedPath`""
    exit 3
}

$cert = $null
try {
    $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedPath)
    $thumbprint = $cert.Thumbprint
    if ([string]::IsNullOrWhiteSpace($thumbprint)) {
        Write-ErrorLine "failed to read certificate thumbprint: `"$resolvedPath`""
        exit 4
    }

    $matched = Get-ChildItem -Path 'Cert:\CurrentUser\Root' | Where-Object { $_.Thumbprint -eq $thumbprint }
    if ($matched) {
        Write-Info "certificate is installed in CurrentUser\Root (thumbprint=$thumbprint)"
        exit 0
    }

    Write-Info "certificate is not installed in CurrentUser\Root (thumbprint=$thumbprint)"
    exit 1
} catch {
    Write-ErrorLine "failed to inspect certificate `"$resolvedPath`": $($_.Exception.Message)"
    exit 4
} finally {
    if ($null -ne $cert) {
        $cert.Dispose()
    }
}
