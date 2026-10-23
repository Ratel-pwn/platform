param([switch]$OpenBrowser, [switch]$ForegroundAgent)
$ErrorActionPreference = 'Stop'
$nodeArgs = @((Join-Path $PSScriptRoot 'start-local.cjs'))
if ($OpenBrowser) { $nodeArgs += '--open-browser' }
if ($ForegroundAgent) { $nodeArgs += '--foreground' }
& node @nodeArgs
exit $LASTEXITCODE
