$ErrorActionPreference = 'Stop'
$reviewHostsPath = 'C:\Windows\System32\drivers\etc\hosts'
$reviewStatusPath = Join-Path $PSScriptRoot 'hosts-status.local.txt'
try {
  $reviewHostsText = [System.IO.File]::ReadAllText($reviewHostsPath)
  if ($reviewHostsText -notmatch '(?m)^\s*127\.0\.0\.1\s+.*\bhuly-review\.local\b') {
    if ($reviewHostsText -match '(?m)^\s*[^#\r\n]+\bhuly-review\.local\b') {
      throw 'The test domain already has another mapping.'
    }
    $reviewBackupPath = Join-Path $PSScriptRoot 'hosts-backup.local.txt'
    if (-not (Test-Path -LiteralPath $reviewBackupPath)) {
      Copy-Item -LiteralPath $reviewHostsPath -Destination $reviewBackupPath
    }
    [System.IO.File]::AppendAllText($reviewHostsPath, "`r`n127.0.0.1 huly-review.local`r`n", [System.Text.Encoding]::ASCII)
  }
  [System.IO.File]::WriteAllText($reviewStatusPath, 'PASS: test domain mapped to 127.0.0.1')
} catch {
  [System.IO.File]::WriteAllText($reviewStatusPath, 'FAIL: ' + $_.Exception.Message)
  exit 1
}
