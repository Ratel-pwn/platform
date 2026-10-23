$ErrorActionPreference = 'Stop'
$release = 'RELEASE.2025-09-07T16-13-09Z'
$asset = "minio.linux-amd64.$release"
$directory = Join-Path $PSScriptRoot 'minio'
$baseUrl = "https://github.com/minio/minio/releases/download/$release"
New-Item -ItemType Directory -Path $directory -Force | Out-Null
& curl.exe --fail --location --silent --show-error --connect-timeout 20 --max-time 60 --output "$directory/minio.sha256sum" "$baseUrl/$asset.sha256sum"
if ($LASTEXITCODE -ne 0) { throw 'Official MinIO checksum download failed' }
& curl.exe --fail --location --silent --show-error --connect-timeout 20 --max-time 600 --retry 2 --continue-at - --output "$directory/minio" "$baseUrl/$asset"
if ($LASTEXITCODE -ne 0) { throw 'Official MinIO binary download failed; rerun to resume' }
$expected = ((Get-Content "$directory/minio.sha256sum" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash "$directory/minio" -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expected -notmatch '^[a-f0-9]{64}$' -or $actual -ne $expected) { throw 'MinIO SHA-256 mismatch; do not build this binary' }
@{ release = $release; url = "$baseUrl/$asset"; sha256 = $actual; size = (Get-Item "$directory/minio").Length; license = 'AGPL-3.0' } | ConvertTo-Json | Set-Content -Encoding utf8 "$directory/release.local.json"
Write-Output "PASS: official MinIO release downloaded and SHA-256 verified ($release)"
