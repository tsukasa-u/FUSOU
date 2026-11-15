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

Write-Info "add_store.ps1 started"

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

Write-Info "running certutil addstore for: `"$resolvedPath`""

$certutilOutput = & certutil.exe -f -user -addstore Root $resolvedPath 2>&1
$certutilExit = $LASTEXITCODE

foreach ($line in $certutilOutput) {
    [Console]::Error.WriteLine($line)
}

if ($certutilExit -ne 0) {
    Write-ErrorLine "certutil addstore failed with exit code $certutilExit."
    Write-ErrorLine "certificate path: `"$resolvedPath`""
    Write-ErrorLine "command: certutil.exe -f -user -addstore Root `"$resolvedPath`""
    exit $certutilExit
}

Write-Info "certificate installed to CurrentUser\Root: `"$resolvedPath`""
exit 0