$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine('Node.js is required.')
    exit 1
}
$remarkRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $remarkRoot 'scripts/install.js') @args
exit $LASTEXITCODE
